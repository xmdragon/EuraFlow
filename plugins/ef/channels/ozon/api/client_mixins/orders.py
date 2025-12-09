"""
Ozon API 订单/发货相关方法
"""

import base64
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from ef_core.utils.external_api_timing import log_external_api_timing
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class OrdersMixin:
    """订单/发货相关 API 方法"""

    async def get_orders(
        self, date_from: datetime, date_to: datetime, status: Optional[str] = None, limit: int = 100, offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取订单列表

        Args:
            date_from: 开始时间
            date_to: 结束时间
            status: 订单状态筛选
            limit: 每页数量
            offset: 偏移量
        """
        # 将timezone-aware datetime转换为ISO格式（移除tzinfo后添加Z）
        since_str = date_from.replace(tzinfo=None).isoformat() + "Z"
        to_str = date_to.replace(tzinfo=None).isoformat() + "Z"

        data = {
            "dir": "desc",  # 降序：从新到旧
            "filter": {"since": since_str, "to": to_str},
            "limit": limit,
            "offset": offset,
            "with": {"analytics_data": True, "financial_data": True},
        }

        if status:
            data["filter"]["status"] = status

        return await self._request("POST", "/v3/posting/fbs/list", data=data, resource_type="orders")

    async def get_posting_details(
        self,
        posting_number: str,
        with_analytics_data: bool = False,
        with_barcodes: bool = False,
        with_financial_data: bool = False,
        with_legal_info: bool = False,
        with_product_exemplars: bool = False,
        with_related_postings: bool = False,
        with_translit: bool = False
    ) -> Dict[str, Any]:
        """
        获取发货单详情
        使用 /v3/posting/fbs/get 接口

        Args:
            posting_number: 货件ID（必需）
            with_analytics_data: 添加分析数据
            with_barcodes: 添加条形码
            with_financial_data: 添加财务数据（包含商品级别的佣金、配送费等明细）
            with_legal_info: 添加法律信息
            with_product_exemplars: 添加产品及份数数据
            with_related_postings: 添加相关货件数量
            with_translit: 完成返回值的拼写转换

        Returns:
            发货单详情
        """
        data = {
            "posting_number": posting_number
        }

        # 构建 with 参数对象
        with_params = {}
        if with_analytics_data:
            with_params["analytics_data"] = True
        if with_barcodes:
            with_params["barcodes"] = True
        if with_financial_data:
            with_params["financial_data"] = True
        if with_legal_info:
            with_params["legal_info"] = True
        if with_product_exemplars:
            with_params["product_exemplars"] = True
        if with_related_postings:
            with_params["related_postings"] = True
        if with_translit:
            with_params["translit"] = True

        # 如果有任何 with 参数，添加到请求数据中
        if with_params:
            data["with"] = with_params

        return await self._request(
            "POST", "/v3/posting/fbs/get", data=data, resource_type="postings"
        )

    async def ship_posting(
        self, posting_number: str, tracking_number: str, shipping_provider_id: int, items: List[Dict]
    ) -> Dict[str, Any]:
        """
        发货操作

        Args:
            posting_number: 发货单号
            tracking_number: 物流单号
            shipping_provider_id: 物流商ID
            items: 发货商品列表
        """
        data = {
            "posting_number": posting_number,
            "tracking_number": tracking_number,
            "shipping_provider_id": shipping_provider_id,
            "items": items,
        }

        return await self._request("POST", "/v2/posting/fbs/ship", data=data, resource_type="postings")

    async def ship_posting_v4(
        self, posting_number: str, packages: List[Dict], with_additional_data: bool = True
    ) -> Dict[str, Any]:
        """
        搜集订单（备货操作）- 告诉 OZON 订单已经组装完成
        使用 /v4/posting/fbs/ship 接口

        此操作会将订单状态从 awaiting_packaging 改为 awaiting_deliver

        Args:
            posting_number: 发货单号
            packages: 包裹列表
                [{
                    "products": [
                        {"product_id": 商品ID, "quantity": 数量}
                    ]
                }]
            with_additional_data: 是否返回额外数据（默认True）

        Returns:
            操作结果
        """
        data = {
            "posting_number": posting_number,
            "packages": packages,
            "with": {
                "additional_data": with_additional_data
            }
        }

        return await self._request("POST", "/v4/posting/fbs/ship", data=data, resource_type="postings")

    async def cancel_posting(
        self, posting_number: str, cancel_reason_id: int, cancel_reason_message: str = ""
    ) -> Dict[str, Any]:
        """取消发货单"""
        data = {
            "posting_number": posting_number,
            "cancel_reason_id": cancel_reason_id,
            "cancel_reason_message": cancel_reason_message,
        }

        return await self._request("POST", "/v2/posting/fbs/cancel", data=data, resource_type="postings")

    async def split_posting(
        self, posting_number: str, postings: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        将货件拆分为多个不带备货的货件

        使用 /v1/posting/fbs/split 接口

        Args:
            posting_number: 原始货件编号
            postings: 拆分后的货件列表，每个包含 products 数组
                [{
                    "products": [
                        {"product_id": 商品ID, "quantity": 数量}
                    ]
                }]

        Returns:
            {
                "parent_posting": {
                    "posting_number": "原始货件号",
                    "products": [{"product_id": 0, "quantity": 0}]
                },
                "postings": [
                    {
                        "posting_number": "新货件号",
                        "products": [{"product_id": 0, "quantity": 0}]
                    }
                ]
            }
        """
        data = {
            "posting_number": posting_number,
            "postings": postings
        }

        return await self._request("POST", "/v1/posting/fbs/split", data=data, resource_type="postings")

    async def get_package_labels(
        self, posting_numbers: List[str]
    ) -> Dict[str, Any]:
        """
        批量获取快递面单PDF（最多20个）

        OZON API 端点: POST /v2/posting/fbs/package-label
        标签格式: 70mm宽 × 125mm高（竖向Portrait）

        注意：
        - 建议在订单装配后45-60秒内请求标签
        - 如果至少有一个货件发生错误，则不会为请求中的所有货件准备标签
        - OZON API 直接返回 PDF 二进制数据（非 JSON 格式）

        Args:
            posting_numbers: 货件编号列表（最多20个）

        Returns:
            {
                "file_content": "base64编码的PDF",
                "file_name": "labels.pdf",
                "content_type": "application/pdf"
            }

        Raises:
            ValueError: 超过20个货件
            httpx.HTTPStatusError: OZON API错误
        """
        if len(posting_numbers) > 20:
            raise ValueError("最多支持20个货件")

        if not posting_numbers:
            raise ValueError("posting_numbers不能为空")

        payload = {"posting_number": posting_numbers}

        # 限流检查
        await self.rate_limiter.acquire("postings")

        # 生成请求ID
        request_id = str(uuid.uuid4())

        # 构建请求
        headers = {"X-Request-Id": request_id}
        if self.correlation_id:
            headers["X-Correlation-Id"] = self.correlation_id

        api_start = time.perf_counter()

        try:
            logger.info(
                "Ozon API request: POST /v2/posting/fbs/package-label",
                extra={"request_id": request_id, "shop_id": self.shop_id}
            )

            response = await self.client.request(
                method="POST",
                url="/v2/posting/fbs/package-label",
                json=payload,
                headers=headers
            )

            # 记录外部 API 调用耗时
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000

            response.raise_for_status()

            # OZON API 直接返回 PDF 二进制数据
            pdf_base64 = base64.b64encode(response.content).decode('utf-8')

            logger.info(
                "Ozon API success: POST /v2/posting/fbs/package-label",
                extra={"request_id": request_id, "pdf_size": len(response.content)}
            )

            # 写入外部 API 计时日志
            log_external_api_timing(
                "OZON", "POST", "/v2/posting/fbs/package-label", api_elapsed_ms,
                f"shop={self.shop_id} | pdf_size={len(response.content)}"
            )

            return {
                "file_content": pdf_base64,
                "file_name": "labels.pdf",
                "content_type": "application/pdf"
            }

        except httpx.HTTPStatusError as e:
            # 记录外部 API 耗时
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000

            # 安全地获取响应内容（避免二进制PDF解码错误）
            try:
                response_content = e.response.text
            except UnicodeDecodeError:
                response_content = f"<binary content, type={e.response.headers.get('content-type')}, size={len(e.response.content)} bytes>"
            except Exception:
                response_content = "<unable to decode response>"

            logger.error(
                f"Ozon API error: {e.response.status_code}",
                extra={"request_id": request_id, "response": response_content},
            )

            # 写入外部 API 计时日志（错误情况）
            log_external_api_timing(
                "OZON", "POST", "/v2/posting/fbs/package-label", api_elapsed_ms,
                f"shop={self.shop_id} | ERROR={e.response.status_code}"
            )
            raise
        except Exception as e:
            # 记录外部 API 耗时（如果已经开始计时）
            api_elapsed_ms = (time.perf_counter() - api_start) * 1000
            log_external_api_timing(
                "OZON", "POST", "/v2/posting/fbs/package-label", api_elapsed_ms,
                f"shop={self.shop_id} | EXCEPTION={type(e).__name__}"
            )
            logger.error(f"获取标签失败: {e}", extra={"request_id": request_id})
            raise

    # ========== FBS备货相关 API（Exemplar） ==========

    async def set_exemplar(
        self, posting_number: str, products: List[Dict[str, Any]], multi_box_qty: int = 0
    ) -> Dict[str, Any]:
        """
        设置发货单的商品样件信息（用于俄罗斯"诚信标志"系统）
        使用 /v6/fbs/posting/product/exemplar/set 接口

        Args:
            posting_number: 发货单号
            products: 商品样件信息列表
            multi_box_qty: 多箱数量（默认0）

        Returns:
            设置结果
        """
        data = {
            "posting_number": posting_number,
            "products": products,
            "multi_box_qty": multi_box_qty
        }

        return await self._request("POST", "/v6/fbs/posting/product/exemplar/set", data=data, resource_type="postings")

    async def validate_exemplar(self, posting_number: str, products: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        验证发货单的样件信息是否有效
        使用 /v5/fbs/posting/product/exemplar/validate 接口

        Args:
            posting_number: 发货单号
            products: 商品样件信息（与set_exemplar格式相同）

        Returns:
            验证结果
        """
        data = {
            "posting_number": posting_number,
            "products": products
        }

        return await self._request(
            "POST", "/v5/fbs/posting/product/exemplar/validate", data=data, resource_type="postings"
        )

    async def get_exemplar_status(self, posting_number: str) -> Dict[str, Any]:
        """
        获取发货单的备货状态（样件验证状态）
        使用 /v4/fbs/posting/product/exemplar/status 接口

        Args:
            posting_number: 发货单号

        Returns:
            备货状态信息，包含：
            - status: ship_available（可以备货）| ship_not_available（无法备货）| validation_in_process（验证中）
            - products: 商品列表及其样件信息
        """
        data = {
            "posting_number": posting_number
        }

        return await self._request(
            "POST", "/v4/fbs/posting/product/exemplar/status", data=data, resource_type="postings"
        )
