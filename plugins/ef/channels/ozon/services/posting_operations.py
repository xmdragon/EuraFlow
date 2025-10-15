"""
打包发货操作服务
处理备货、更新业务信息、填写国内单号等操作
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Any, Optional
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.orders import OzonPosting, OzonOrder
from ..models.ozon_shops import OzonShop
from ..api.client import OzonAPIClient
from .kuajing84_sync import create_kuajing84_sync_service

logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class PostingOperationsService:
    """打包发货操作服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def prepare_stock(
        self,
        posting_number: str,
        purchase_price: Decimal,
        source_platform: Optional[str] = None,
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        备货操作：保存业务信息 + 调用 OZON ship API（v4）

        Args:
            posting_number: 货件编号
            purchase_price: 进货价格（必填）
            source_platform: 采购平台（可选：1688/拼多多/咸鱼/淘宝）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始备货操作，posting_number: {posting_number}, purchase_price: {purchase_price}, source_platform: {source_platform}")

        # 1. 查询 posting 和关联的 shop
        result = await self.db.execute(
            select(OzonPosting, OzonShop)
            .join(OzonShop, OzonPosting.shop_id == OzonShop.id)
            .where(OzonPosting.posting_number == posting_number)
        )
        row = result.first()

        if not row:
            logger.error(f"货件不存在: {posting_number}")
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        posting, shop = row

        logger.info(f"找到货件，当前状态: {posting.operation_status}, shop_id: {posting.shop_id}")

        # 2. 幂等性检查：如果状态已 >= allocating，禁止重复操作
        if posting.operation_status in ["allocating", "allocated", "tracking_confirmed"]:
            logger.warning(f"货件已完成备货操作，当前状态：{posting.operation_status}")
            return {
                "success": False,
                "message": f"该货件已完成备货操作，当前状态：{posting.operation_status}"
            }

        # 3. 保存业务信息
        posting.purchase_price = purchase_price
        posting.purchase_price_updated_at = utcnow()
        if source_platform:
            posting.source_platform = source_platform
        if order_notes:
            posting.order_notes = order_notes
        posting.operation_time = utcnow()

        # 立即更新操作状态为"分配中"（在 API 调用前）
        posting.operation_status = "allocating"

        # 4. 调用 OZON ship API（v4）告诉 OZON 订单已组装完成
        try:
            packages = self._build_packages_for_ship(posting)

            # 创建 API 客户端
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 调用 v4 ship API
            logger.info(f"调用 OZON ship API (v4)，posting_number: {posting_number}, packages: {packages}")
            ship_result = await api_client.ship_posting_v4(
                posting_number=posting_number,
                packages=packages
            )
            await api_client.close()

            logger.info(f"OZON ship API 调用成功，posting_number: {posting_number}, result: {ship_result}")

        except Exception as e:
            logger.error(f"调用 OZON ship API 失败，posting_number: {posting_number}, error: {str(e)}")
            # OZON API 调用失败不回滚数据库事务，因为业务信息已保存且状态已更新
            # 返回部分成功的结果
            await self.db.commit()
            await self.db.refresh(posting)
            return {
                "success": False,
                "message": f"业务信息已保存，状态已更新为分配中，但 OZON API 调用失败：{str(e)}",
                "data": {
                    "posting_number": posting.posting_number,
                    "operation_status": posting.operation_status,
                    "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
                }
            }

        # 5. 提交数据库事务
        await self.db.commit()
        await self.db.refresh(posting)

        logger.info(f"备货操作成功，posting_number: {posting_number}, operation_status: {posting.operation_status}")

        return {
            "success": True,
            "message": "备货成功",
            "data": {
                "posting_number": posting.posting_number,
                "operation_status": posting.operation_status,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
            }
        }

    async def update_business_info(
        self,
        posting_number: str,
        purchase_price: Optional[Decimal] = None,
        source_platform: Optional[str] = None,
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        更新业务信息（不改变操作状态）

        Args:
            posting_number: 货件编号
            purchase_price: 进货价格（可选）
            source_platform: 采购平台（可选）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始更新业务信息，posting_number: {posting_number}")

        # 1. 查询 posting
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        # 2. 更新业务字段
        if purchase_price is not None:
            posting.purchase_price = purchase_price
            posting.purchase_price_updated_at = utcnow()
        if source_platform is not None:
            posting.source_platform = source_platform
        if order_notes is not None:
            posting.order_notes = order_notes

        posting.operation_time = utcnow()

        # 3. 提交数据库事务
        await self.db.commit()
        await self.db.refresh(posting)

        logger.info(f"业务信息更新成功，posting_number: {posting_number}")

        return {
            "success": True,
            "message": "更新成功",
            "data": {
                "posting_number": posting.posting_number,
                "purchase_price": str(posting.purchase_price) if posting.purchase_price else None,
                "source_platform": posting.source_platform,
                "order_notes": posting.order_notes,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
            }
        }

    async def submit_domestic_tracking(
        self,
        posting_number: str,
        domestic_tracking_number: str,
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        填写国内物流单号 + 同步跨境巴士

        Args:
            posting_number: 货件编号
            domestic_tracking_number: 国内物流单号（必填）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始填写国内单号，posting_number: {posting_number}, domestic_tracking_number: {domestic_tracking_number}")

        # 1. 查询 posting
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        # 2. 幂等性检查：如果状态已是 tracking_confirmed，禁止重复操作
        if posting.operation_status == "tracking_confirmed":
            return {
                "success": False,
                "message": "该货件已完成国内单号填写操作"
            }

        # 3. 保存国内单号和备注
        posting.domestic_tracking_number = domestic_tracking_number
        posting.domestic_tracking_updated_at = utcnow()
        if order_notes is not None:
            posting.order_notes = order_notes
        posting.operation_time = utcnow()

        # 4. 查询关联的订单（用于跨境巴士同步）
        order_result = await self.db.execute(
            select(OzonOrder).where(OzonOrder.id == posting.order_id)
        )
        order = order_result.scalar_one_or_none()

        if not order:
            return {
                "success": False,
                "message": f"订单不存在: {posting.order_id}"
            }

        # 5. 同步到跨境巴士
        kuajing84_service = create_kuajing84_sync_service(self.db)
        sync_result = await kuajing84_service.sync_logistics_order(
            ozon_order_id=order.id,
            posting_number=posting_number,
            logistics_order=domestic_tracking_number
        )

        if not sync_result["success"]:
            logger.warning(f"跨境巴士同步失败（不影响状态更新）: {sync_result['message']}")
            # 注意：跨境巴士同步失败不影响状态更新，因为已经保存了国内单号

        # 6. 更新操作状态为"单号确认"
        posting.operation_status = "tracking_confirmed"

        # 7. 提交数据库事务
        await self.db.commit()
        await self.db.refresh(posting)

        logger.info(f"国内单号填写成功，posting_number: {posting_number}, operation_status: {posting.operation_status}")

        return {
            "success": True,
            "message": "国内单号提交成功" + (f"，跨境巴士同步：{'成功' if sync_result['success'] else '失败'}" if sync_result else ""),
            "data": {
                "posting_number": posting.posting_number,
                "domestic_tracking_number": posting.domestic_tracking_number,
                "operation_status": posting.operation_status,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None,
                "kuajing84_sync": sync_result
            }
        }

    def _build_packages_for_ship(self, posting: OzonPosting) -> list:
        """
        从 posting.raw_payload 提取商品信息并构造 /v4/posting/fbs/ship API 所需的 packages 数据

        Args:
            posting: OzonPosting 实例

        Returns:
            packages 数据列表
        """
        if not posting.raw_payload or "products" not in posting.raw_payload:
            raise ValueError("无法从 posting 中提取商品信息（raw_payload.products 不存在）")

        # 构建单个包裹的 products 列表
        products = []
        for product in posting.raw_payload["products"]:
            # 提取 product_id（OZON 的商品ID，即 sku 字段）
            product_id = product.get("sku")
            if not product_id:
                logger.warning(f"商品缺少 product_id/sku: {product}")
                continue

            # 提取数量
            quantity = product.get("quantity", 1)

            products.append({
                "product_id": int(product_id),
                "quantity": quantity
            })

        if not products:
            raise ValueError("无法构造 packages 数据（没有有效的商品）")

        # 返回单个包裹（大多数订单是单包裹）
        return [{"products": products}]
