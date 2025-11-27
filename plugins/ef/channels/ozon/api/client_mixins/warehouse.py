"""
Ozon API 仓库/促销/退货/Webhook相关方法
"""

import hashlib
import hmac
from typing import Any, Dict, List, Optional


class WarehouseMixin:
    """仓库/促销/退货/Webhook相关 API 方法"""

    async def get_warehouses(self) -> Dict[str, Any]:
        """
        获取仓库列表（FBS/rFBS）
        使用 /v1/warehouse/list 接口

        Returns:
            仓库列表数据，包含：
            - result: 仓库列表
                [{
                    "warehouse_id": 仓库ID,
                    "name": 仓库名称,
                    "is_rfbs": 是否rFBS,
                    "status": 状态（new/created/disabled等）,
                    "has_entrusted_acceptance": 是否启用受信任接受,
                    "postings_limit": 订单限额（-1=无限制）,
                    "min_postings_limit": 单次供货最小订单数,
                    "has_postings_limit": 是否有订单数限制,
                    "min_working_days": 最少工作天数,
                    "working_days": 工作日列表,
                    "can_print_act_in_advance": 是否可提前打印收发证书,
                    "is_karantin": 是否隔离停运,
                    "is_kgt": 是否接受大宗商品,
                    "is_timetable_editable": 是否可修改时间表,
                    "first_mile_type": 第一英里类型
                }]
        """
        return await self._request(
            "POST",
            "/v1/warehouse/list",
            data={},  # 空body
            resource_type="default"
        )

    # ========== 促销活动相关 API ==========

    async def get_actions(self) -> Dict[str, Any]:
        """
        获取促销活动清单
        使用 /v1/actions 接口

        Returns:
            活动列表数据，包含：
            - result: 活动列表
        """
        return await self._request(
            "GET",
            "/v1/actions",
            resource_type="actions"
        )

    async def get_action_candidates(
        self,
        action_id: int,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取可参加促销的商品列表（候选商品）
        使用 /v1/actions/candidates 接口

        Args:
            action_id: 活动ID
            limit: 每页数量
            offset: 偏移量

        Returns:
            候选商品列表数据
        """
        data = {
            "action_id": action_id,
            "limit": limit,
            "offset": offset
        }

        return await self._request(
            "POST",
            "/v1/actions/candidates",
            data=data,
            resource_type="actions"
        )

    async def get_action_products(
        self,
        action_id: int,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        获取参与活动的商品列表
        使用 /v1/actions/products 接口

        Args:
            action_id: 活动ID
            limit: 每页数量
            offset: 偏移量

        Returns:
            参与商品列表数据
        """
        data = {
            "action_id": action_id,
            "limit": limit,
            "offset": offset
        }

        return await self._request(
            "POST",
            "/v1/actions/products",
            data=data,
            resource_type="actions"
        )

    async def activate_action_products(
        self,
        action_id: int,
        products: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        添加商品到促销活动
        使用 /v1/actions/products/activate 接口

        Args:
            action_id: 活动ID
            products: 商品列表，每个包含：
                - product_id: 商品ID
                - action_price: 促销价格
                - stock: 促销库存

        Returns:
            操作结果
        """
        data = {
            "action_id": action_id,
            "products": products
        }

        return await self._request(
            "POST",
            "/v1/actions/products/activate",
            data=data,
            resource_type="actions"
        )

    async def deactivate_action_products(
        self,
        action_id: int,
        product_ids: List[int]
    ) -> Dict[str, Any]:
        """
        从促销活动中移除商品
        使用 /v1/actions/products/deactivate 接口

        Args:
            action_id: 活动ID
            product_ids: 商品ID列表

        Returns:
            操作结果
        """
        data = {
            "action_id": action_id,
            "product_id": product_ids
        }

        return await self._request(
            "POST",
            "/v1/actions/products/deactivate",
            data=data,
            resource_type="actions"
        )

    # ========== 取消申请相关 API ==========

    async def get_conditional_cancellation_list(
        self,
        last_id: int = 0,
        limit: int = 1000,
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        获取取消申请列表
        使用 /v2/conditional-cancellation/list 接口

        Args:
            last_id: 上次查询的最后一个ID（用于分页）
            limit: 每页数量（默认1000，最大500）
            filters: 过滤条件（例如：{"state": "ALL"} 获取所有状态）

        Returns:
            取消申请列表数据
        """
        data = {
            "last_id": last_id,
            "limit": limit
        }

        # 添加过滤条件（OZON API要求必须传递filters才能返回数据）
        if filters:
            data["filters"] = filters

        return await self._request(
            "POST",
            "/v2/conditional-cancellation/list",
            data=data,
            resource_type="orders"
        )

    # ========== 退货相关 API ==========

    async def get_returns_rfbs_list(
        self,
        last_id: int = 0,
        limit: int = 1000,
        filters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        获取退货申请列表（rFBS）
        使用 /v2/returns/rfbs/list 接口

        Args:
            last_id: 上次查询的最后一个ID（用于分页）
            limit: 每页数量（默认1000，最大500）
            filters: 过滤条件（例如：{"state": "ALL"} 获取所有状态）

        Returns:
            退货申请列表数据
        """
        data = {
            "last_id": last_id,
            "limit": limit
        }

        # 注意：退货API使用 "filter"（单数），不是 "filters"（复数）
        if filters:
            data["filter"] = filters

        return await self._request(
            "POST",
            "/v2/returns/rfbs/list",
            data=data,
            resource_type="orders"
        )

    async def get_return_rfbs_info(
        self,
        return_id: int
    ) -> Dict[str, Any]:
        """
        获取退货申请详情（rFBS）
        使用 /v2/returns/rfbs/get 接口

        Args:
            return_id: 退货申请ID

        Returns:
            退货申请详情数据
        """
        data = {
            "return_id": return_id
        }

        return await self._request(
            "POST",
            "/v2/returns/rfbs/get",
            data=data,
            resource_type="orders"
        )

    # ========== Webhook 相关 ==========

    def verify_webhook_signature(self, payload: bytes, signature: str, secret: str) -> bool:
        """
        验证 Webhook 签名

        Args:
            payload: 请求体原始数据
            signature: 请求头中的签名
            secret: Webhook 密钥

        Returns:
            签名是否有效
        """
        expected_signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

        return hmac.compare_digest(signature, expected_signature)
