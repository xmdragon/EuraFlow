#!/usr/bin/env python3
"""
搜索特定订单号
"""
import asyncio
import sys
from datetime import datetime, timedelta

sys.path.insert(0, '/home/grom/EuraFlow')

from plugins.ef.channels.ozon.api.client import OzonAPIClient
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonShop
from sqlalchemy import select


async def find_order(target_posting: str = "59476180-0106-1"):
    """搜索订单"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        result = await session.execute(select(OzonShop).limit(1))
        shop = result.scalar_one_or_none()

        if not shop:
            print("❌ 未找到店铺")
            return

        print(f"✓ 找到店铺: {shop.shop_name}")
        print(f"✓ 搜索目标: {target_posting}\n")

        client = OzonAPIClient(shop.client_id, shop.api_key_enc)

        # 时间范围：最近30天（扩大范围）
        date_from = datetime.utcnow() - timedelta(days=30)
        date_to = datetime.utcnow()

        print(f"时间范围: 最近30天\n")

        # 遍历所有页
        offset = 0
        page = 1
        total_orders = 0
        found = False

        while True:
            print(f"正在检查第 {page} 页 (offset={offset})...")

            try:
                response = await client.get_orders(
                    date_from=date_from,
                    date_to=date_to,
                    limit=100,
                    offset=offset
                )

                result_data = response.get("result", {})
                items = result_data.get("postings", [])
                has_next = result_data.get("has_next", False)

                if not items:
                    print("没有更多订单")
                    break

                total_orders += len(items)
                print(f"  返回 {len(items)} 个订单，总计 {total_orders} 个")

                # 搜索目标订单
                for item in items:
                    posting_number = item.get("posting_number")
                    if posting_number == target_posting:
                        print(f"\n🎉 找到目标订单！")
                        print(f"  posting_number: {posting_number}")
                        print(f"  order_id: {item.get('order_id')}")
                        print(f"  status: {item.get('status')}")
                        print(f"  in_process_at: {item.get('in_process_at')}")
                        print(f"  位置: 第 {page} 页，第 {items.index(item) + 1} 个订单")
                        found = True
                        break

                if found:
                    break

                # 检查是否有下一页
                if not has_next or len(items) < 100:
                    print(f"\n已检查所有订单，未找到 {target_posting}")
                    break

                offset += 100
                page += 1

            except Exception as e:
                print(f"❌ 错误: {e}")
                break

        await client.close()

        print(f"\n总结:")
        print(f"  检查了 {page} 页，共 {total_orders} 个订单")
        print(f"  目标订单: {'✓ 找到' if found else '✗ 未找到'}")


if __name__ == "__main__":
    asyncio.run(find_order())
