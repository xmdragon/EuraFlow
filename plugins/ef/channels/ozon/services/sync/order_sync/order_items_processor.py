"""
订单商品明细处理器

负责同步订单中的商品明细。
"""

from decimal import Decimal
from typing import Dict, List, Any
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....models import OzonOrder, OzonOrderItem
from ..utils import safe_decimal_conversion

logger = logging.getLogger(__name__)


class OrderItemsProcessor:
    """订单商品明细处理器"""

    async def sync_order_items(
        self,
        db: AsyncSession,
        order: OzonOrder,
        products_data: List[Dict[str, Any]]
    ) -> None:
        """
        同步订单商品明细

        Args:
            db: 数据库会话
            order: 订单对象
            products_data: API 返回的商品数组
        """
        if not products_data:
            return

        # 获取现有明细
        existing_items_result = await db.execute(
            select(OzonOrderItem).where(OzonOrderItem.order_id == order.id)
        )
        existing_items = {item.offer_id: item for item in existing_items_result.scalars().all()}

        synced_offer_ids = set()

        # 遍历 API 返回的商品
        for product in products_data:
            # offer_id 可能是整数，转换为字符串
            offer_id = str(product.get("offer_id", "")) if product.get("offer_id") else ""
            if not offer_id:
                logger.warning(f"Product without offer_id in order {order.order_id}: {product}")
                continue

            synced_offer_ids.add(offer_id)

            # 解析商品数据
            quantity = product.get("quantity", 1)
            price = safe_decimal_conversion(product.get("price", 0)) or Decimal("0")

            # OZON 平台 SKU
            ozon_sku = product.get("sku")
            # 商品名称限制为 500 字符
            name = (product.get("name", "") or "")[:500]

            # 计算总价
            total_amount = price * quantity

            # 检查是否已存在
            if offer_id in existing_items:
                # 更新现有明细
                item = existing_items[offer_id]
                item.quantity = quantity
                item.price = price
                item.total_amount = total_amount
                item.name = name
                item.ozon_sku = ozon_sku
                item.status = order.status
            else:
                # 创建新明细
                item = OzonOrderItem(
                    order_id=order.id,
                    offer_id=offer_id,
                    ozon_sku=ozon_sku,
                    name=name,
                    quantity=quantity,
                    price=price,
                    discount=Decimal("0"),
                    total_amount=total_amount,
                    status=order.status,
                )
                db.add(item)

        # 删除不再存在的明细
        for offer_id, item in existing_items.items():
            if offer_id not in synced_offer_ids:
                await db.delete(item)

        logger.info(
            f"Synced {len(synced_offer_ids)} items for order {order.order_id}",
            extra={"order_id": order.order_id, "items_count": len(synced_offer_ids)}
        )
