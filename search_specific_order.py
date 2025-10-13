#!/usr/bin/env python3
"""
直接通过 OZON API 搜索特定订单号
"""
import asyncio
import sys
from datetime import datetime, timedelta

sys.path.insert(0, '/home/grom/EuraFlow')

from plugins.ef.channels.ozon.api.client import OzonAPIClient
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonShop
from sqlalchemy import select


async def search_order(target_posting: str = "59476180-0106-1"):
    """在所有店铺中搜索特定订单号"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 获取所有店铺
        result = await session.execute(select(OzonShop))
        shops = result.scalars().all()

        print(f"🔍 在 {len(shops)} 个店铺中搜索订单: {target_posting}\n")

        for shop in shops:
            print(f"检查店铺: {shop.shop_name} (ID: {shop.id})")

            try:
                client = OzonAPIClient(shop.client_id, shop.api_key_enc)

                # 扩大时间范围到30天
                date_from = datetime.utcnow() - timedelta(days=30)
                date_to = datetime.utcnow()

                # 不使用状态过滤，获取所有订单
                response = await client.get_orders(
                    date_from=date_from,
                    date_to=date_to,
                    limit=1000,
                    offset=0
                )

                result_data = response.get("result", {})
                items = result_data.get("postings", [])

                print(f"  返回 {len(items)} 个订单")

                # 搜索目标订单
                found = False
                for item in items:
                    if item.get("posting_number") == target_posting:
                        print(f"\n✅ 找到订单！所属店铺: {shop.shop_name}")
                        print(f"\n订单详情:")
                        print(f"  posting_number: {item.get('posting_number')}")
                        print(f"  order_id: {item.get('order_id')}")
                        print(f"  order_number: {item.get('order_number')}")
                        print(f"  status: {item.get('status')}")
                        print(f"  in_process_at: {item.get('in_process_at')}")
                        print(f"  shipment_date: {item.get('shipment_date')}")
                        print(f"  delivery_method: {item.get('delivery_method', {}).get('name')}")

                        # 显示商品信息
                        products = item.get('products', [])
                        if products:
                            print(f"\n  商品列表 ({len(products)}个):")
                            for idx, prod in enumerate(products[:3], 1):
                                print(f"    {idx}. {prod.get('name')} x {prod.get('quantity')}")

                        found = True
                        break

                if not found:
                    print(f"  ❌ 未找到\n")
                else:
                    break

                await client.close()

            except Exception as e:
                print(f"  ⚠️ 错误: {e}\n")


if __name__ == "__main__":
    asyncio.run(search_order())
