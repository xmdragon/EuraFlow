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
        备货操作：保存业务信息 + 调用 OZON exemplar set API

        Args:
            posting_number: 货件编号
            purchase_price: 进货价格（必填）
            source_platform: 采购平台（可选：1688/拼多多/咸鱼/淘宝）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始备货操作，posting_number: {posting_number}, purchase_price: {purchase_price}, source_platform: {source_platform}")

        # 1. 查询 posting
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            logger.error(f"货件不存在: {posting_number}")
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

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

        # 4. 更新操作状态为"分配中"
        # 注意：暂时跳过 OZON exemplar API 调用
        # exemplar API 主要用于"诚信标志"系统合规，不是所有商品都需要
        # 如果后续需要，可以根据商品类型或其他条件选择性调用
        posting.operation_status = "allocating"

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

    async def _build_exemplar_products(self, posting: OzonPosting) -> list:
        """
        从 posting.raw_payload 提取商品信息并构造 OZON exemplar API 所需的 products 数据

        Args:
            posting: OzonPosting 实例

        Returns:
            products 数据列表
        """
        if not posting.raw_payload or "products" not in posting.raw_payload:
            raise ValueError("无法从 posting 中提取商品信息（raw_payload.products 不存在）")

        products_data = []
        for product in posting.raw_payload["products"]:
            # 提取 product_id（OZON 的商品ID，不是 offer_id）
            # 注意：raw_payload 中的 product 可能包含 sku 字段（即 OZON product_id）
            product_id = product.get("sku")
            if not product_id:
                # 如果没有 sku，尝试从其他字段获取
                logger.warning(f"商品缺少 product_id/sku: {product}")
                continue

            # 提取数量
            quantity = product.get("quantity", 1)

            # 为每个数量创建一个 exemplar（OZON API 要求）
            exemplars = []
            for _ in range(quantity):
                exemplars.append({
                    "is_gtd_absent": True,   # 无海关申报单号
                    "is_rnpt_absent": True,  # 无 RNPT 编号
                    "marks": []              # 无标记
                })

            products_data.append({
                "product_id": int(product_id),  # 必须是整数
                "exemplars": exemplars
            })

        if not products_data:
            raise ValueError("无法构造 exemplar products 数据（没有有效的商品）")

        return products_data
