"""
销量更新器

负责更新商品销量统计。
"""

from datetime import datetime
from typing import List, Dict, Optional
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....models import OzonProduct

logger = logging.getLogger(__name__)


class SalesUpdater:
    """销量更新器"""

    async def update_product_sales(
        self,
        db: AsyncSession,
        shop_id: int,
        products_data: List[Dict],
        delta: int,
        order_time: Optional[datetime] = None
    ) -> None:
        """
        更新商品销量统计

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            products_data: 订单商品列表 [{"sku": ..., "offer_id": ..., "quantity": ...}, ...]
            delta: 销量变化量（+1 新订单, -1 取消订单）
            order_time: 订单时间（仅在 delta>0 时更新 last_sale_at）
        """
        if not products_data:
            return

        # 收集所有 ozon_sku
        sku_quantity_map = {}
        for product in products_data:
            ozon_sku = product.get("sku")
            if ozon_sku:
                quantity = product.get("quantity", 1)
                sku_quantity_map[int(ozon_sku)] = sku_quantity_map.get(int(ozon_sku), 0) + quantity

        if not sku_quantity_map:
            return

        # 批量查询商品
        result = await db.execute(
            select(OzonProduct).where(
                OzonProduct.shop_id == shop_id,
                OzonProduct.ozon_sku.in_(list(sku_quantity_map.keys()))
            )
        )
        products = result.scalars().all()

        # 更新销量
        for product in products:
            quantity = sku_quantity_map.get(product.ozon_sku, 1)
            sales_delta = delta * quantity

            # 更新销量（确保不为负）
            new_sales = (product.sales_count or 0) + sales_delta
            product.sales_count = max(0, new_sales)

            # 只有新订单(delta>0)才更新最后销售时间
            if delta > 0 and order_time:
                if not product.last_sale_at or order_time > product.last_sale_at:
                    product.last_sale_at = order_time

        logger.debug(
            f"Updated sales for {len(products)} products (delta={delta})",
            extra={"shop_id": shop_id, "sku_count": len(sku_quantity_map)}
        )
