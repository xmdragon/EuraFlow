#!/usr/bin/env python3
"""
合并重复的订单
将旧的 webhook 订单的 posting 和 returns 迁移到真实订单，然后删除旧订单
"""
import asyncio
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, update
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonOrder, OzonPosting, OzonOrderItem


async def merge_duplicate_orders():
    """合并重复订单"""
    db_manager = get_db_manager()

    # 查找所有重复的 order_id (包括刚才更新的9个)
    old_webhook_ids = [2853, 2860, 2862, 2874, 2888, 2891, 2900, 2908, 3861]

    total = len(old_webhook_ids)
    print(f"开始处理 {total} 个重复订单...\n")

    merged_count = 0
    deleted_count = 0
    failed_count = 0

    for idx, old_order_id in enumerate(old_webhook_ids, 1):
        try:
            async with db_manager.get_session() as session:
                # 获取旧订单
                old_order = await session.get(OzonOrder, old_order_id)
                if not old_order:
                    print(f"[{idx}/{total}] ✗ 未找到订单 ID {old_order_id}")
                    failed_count += 1
                    continue

                ozon_order_id = old_order.ozon_order_id
                shop_id = old_order.shop_id

                print(f"[{idx}/{total}] 处理订单 {ozon_order_id} (旧ID: {old_order_id})...")

                # 查找真实订单（同样的 ozon_order_id，但 ID 更大）
                stmt = select(OzonOrder).where(
                    OzonOrder.shop_id == shop_id,
                    OzonOrder.ozon_order_id == ozon_order_id,
                    OzonOrder.id > old_order_id  # ID 更大的是真实订单
                )
                real_order = await session.scalar(stmt)

                if not real_order:
                    print(f"  ✗ 未找到真实订单")
                    failed_count += 1
                    continue

                print(f"  找到真实订单 ID: {real_order.id}")

                # 迁移 postings
                stmt = update(OzonPosting).where(
                    OzonPosting.order_id == old_order_id
                ).values(order_id=real_order.id)
                await session.execute(stmt)

                # 迁移 returns（直接使用 SQL）
                from sqlalchemy import text
                await session.execute(
                    text("UPDATE ozon_returns SET order_id = :new_id WHERE order_id = :old_id"),
                    {"new_id": real_order.id, "old_id": old_order_id}
                )

                # 删除旧订单的商品
                stmt = select(OzonOrderItem).where(OzonOrderItem.order_id == old_order_id)
                old_items = await session.scalars(stmt)
                for item in old_items:
                    await session.delete(item)

                # 删除旧订单
                await session.delete(old_order)

                await session.commit()

                merged_count += 1
                deleted_count += 1
                print(f"  ✓ 已合并并删除旧订单")

        except Exception as e:
            print(f"  ✗ 处理失败: {e}")
            import traceback
            traceback.print_exc()
            failed_count += 1

    print("\n" + "="*60)
    print(f"合并完成！")
    print(f"总计: {total} 个订单")
    print(f"成功合并: {merged_count} 个")
    print(f"成功删除: {deleted_count} 个")
    print(f"失败: {failed_count} 个")


if __name__ == "__main__":
    print("开始合并重复订单...")
    asyncio.run(merge_duplicate_orders())
    print("\n脚本执行完成。")
