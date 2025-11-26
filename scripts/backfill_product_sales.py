#!/usr/bin/env python3
"""
回填商品销量数据脚本

遍历所有订单（非取消），统计每个商品的销量和最后销售时间
"""
import asyncio
import sys
import os
from collections import defaultdict
from datetime import datetime

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonPosting, OzonProduct


async def backfill_sales():
    """回填商品销量数据"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        print("开始回填商品销量数据...")

        # 1. 查询所有非取消的 posting
        # 使用 raw_payload 中的 products 数据
        result = await db.execute(
            select(OzonPosting)
            .where(
                and_(
                    OzonPosting.is_cancelled == False,
                    OzonPosting.raw_payload.isnot(None)
                )
            )
        )
        postings = result.scalars().all()

        print(f"找到 {len(postings)} 个有效订单")

        # 2. 统计每个商品的销量和最后销售时间
        # key: (shop_id, ozon_sku), value: {"count": int, "last_sale_at": datetime}
        sales_data = defaultdict(lambda: {"count": 0, "last_sale_at": None})

        for posting in postings:
            shop_id = posting.shop_id
            products = posting.raw_payload.get("products", []) if posting.raw_payload else []
            order_time = posting.in_process_at or posting.shipment_date

            for product in products:
                ozon_sku = product.get("sku")
                if not ozon_sku:
                    continue

                quantity = product.get("quantity", 1)
                key = (shop_id, int(ozon_sku))

                # 累加销量
                sales_data[key]["count"] += quantity

                # 更新最后销售时间（取最晚的时间）
                if order_time:
                    current_last = sales_data[key]["last_sale_at"]
                    if not current_last or order_time > current_last:
                        sales_data[key]["last_sale_at"] = order_time

        print(f"统计到 {len(sales_data)} 个商品的销量数据")

        # 3. 批量更新商品数据
        updated_count = 0
        batch_size = 100
        keys_list = list(sales_data.keys())

        for i in range(0, len(keys_list), batch_size):
            batch_keys = keys_list[i:i + batch_size]

            # 查询这批商品
            ozon_skus = [k[1] for k in batch_keys]
            shop_ids = list(set(k[0] for k in batch_keys))

            products_result = await db.execute(
                select(OzonProduct).where(
                    OzonProduct.ozon_sku.in_(ozon_skus)
                )
            )
            products = products_result.scalars().all()

            # 创建查找映射
            product_map = {(p.shop_id, p.ozon_sku): p for p in products}

            # 更新商品
            for key in batch_keys:
                product = product_map.get(key)
                if product:
                    data = sales_data[key]
                    product.sales_count = data["count"]
                    product.last_sale_at = data["last_sale_at"]
                    updated_count += 1

            # 每批次提交
            await db.flush()
            print(f"已更新 {updated_count} 个商品...")

        # 最终提交
        await db.commit()

        print(f"\n回填完成！共更新 {updated_count} 个商品的销量数据")

        # 4. 显示销量统计摘要
        print("\n销量统计摘要（前10名）:")
        top_sales = sorted(sales_data.items(), key=lambda x: x[1]["count"], reverse=True)[:10]
        for (shop_id, sku), data in top_sales:
            last_sale = data["last_sale_at"].strftime("%Y-%m-%d") if data["last_sale_at"] else "N/A"
            print(f"  店铺 {shop_id}, SKU {sku}: 销量 {data['count']}, 最后销售 {last_sale}")


if __name__ == "__main__":
    asyncio.run(backfill_sales())
