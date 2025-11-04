#!/usr/bin/env python3
"""
修正ozon_orders表中order_id字段的映射错误

问题：
- order_id 字段错误地存储了 posting_number（发货单号）
- 但一个订单可以有多个posting（部分发货）
- order_id 应该存储 OZON 的 order_id（订单级别唯一标识）

解决方案：
- 将 order_id 字段更新为 ozon_order_id 的值
"""
import asyncio
import sys
sys.path.insert(0, '/home/grom/EuraFlow')

from ef_core.database import get_db_manager
from sqlalchemy import text


async def fix_order_id_mapping():
    """修正order_id字段映射"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        print("开始修正 ozon_orders.order_id 字段映射...")
        print()

        # 1. 检查需要修正的数据量
        result = await session.execute(text("""
            SELECT COUNT(*)
            FROM ozon_orders
            WHERE order_id != ozon_order_id
        """))
        count = result.scalar()

        print(f"✓ 发现 {count} 条需要修正的记录")

        if count == 0:
            print("✓ 所有数据已经正确，无需修正")
            return

        # 2. 显示示例数据（修正前）
        result = await session.execute(text("""
            SELECT id, order_id, ozon_order_id, ozon_order_number
            FROM ozon_orders
            WHERE order_id != ozon_order_id
            LIMIT 3
        """))

        rows = result.fetchall()
        if rows:
            print()
            print("修正前示例数据：")
            for row in rows:
                print(f"  ID: {row[0]}")
                print(f"    order_id (错误): {row[1]}")
                print(f"    ozon_order_id (正确): {row[2]}")
                print(f"    ozon_order_number: {row[3]}")
                print()

        # 3. 执行修正
        print(f"正在修正 {count} 条记录...")
        result = await session.execute(text("""
            UPDATE ozon_orders
            SET order_id = ozon_order_id,
                updated_at = NOW()
            WHERE order_id != ozon_order_id
        """))

        await session.commit()

        updated_count = result.rowcount
        print(f"✓ 成功修正 {updated_count} 条记录")

        # 4. 验证修正结果
        result = await session.execute(text("""
            SELECT COUNT(*)
            FROM ozon_orders
            WHERE order_id != ozon_order_id
        """))
        remaining = result.scalar()

        if remaining == 0:
            print("✓ 验证通过：所有记录已正确修正")
        else:
            print(f"⚠️ 仍有 {remaining} 条记录未修正")

        # 5. 显示修正后的示例数据
        result = await session.execute(text("""
            SELECT id, order_id, ozon_order_id, ozon_order_number
            FROM ozon_orders
            ORDER BY updated_at DESC
            LIMIT 3
        """))

        rows = result.fetchall()
        if rows:
            print()
            print("修正后示例数据（最近更新的3条）：")
            for row in rows:
                print(f"  ID: {row[0]}")
                print(f"    order_id: {row[1]}")
                print(f"    ozon_order_id: {row[2]}")
                print(f"    ozon_order_number: {row[3]}")
                status = "✓" if row[1] == row[2] else "✗"
                print(f"    状态: {status}")
                print()

        # 6. 统计修正后的数据分布
        result = await session.execute(text("""
            SELECT
                shop_id,
                COUNT(*) as total_orders,
                COUNT(DISTINCT order_id) as unique_orders,
                COUNT(*) - COUNT(DISTINCT order_id) as duplicate_order_ids
            FROM ozon_orders
            GROUP BY shop_id
            ORDER BY shop_id
        """))

        rows = result.fetchall()
        print()
        print("各店铺订单统计：")
        for row in rows:
            print(f"  Shop {row[0]}: {row[1]} 条订单记录, {row[2]} 个唯一order_id")
            if row[3] > 0:
                print(f"    ⚠️ 有 {row[3]} 条重复的order_id（这是正常的，因为一个订单可以有多个posting）")

        print()
        print("✓ 修正完成！")


if __name__ == "__main__":
    asyncio.run(fix_order_id_mapping())
