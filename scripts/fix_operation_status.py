#!/usr/bin/env python3
"""
临时脚本：修复 posting 的 operation_status
- 运输中/已签收 → shipping
- 已取消/已废弃 → cancelled
"""
import asyncio
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting


async def fix_operation_status():
    """修复 operation_status"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 1. 统计需要修复的数据
        print("=" * 60)
        print("📊 统计需要修复的数据...")
        print("=" * 60)

        # 1.1 查询 operation_status 为 NULL 的记录
        result = await session.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.operation_status.is_(None))
        )
        null_count = result.scalar()

        print(f"\n【类型1】operation_status 为 NULL 的记录: {null_count}")

        if null_count > 0:
            print("\n按OZON状态分布:")
            for status in ["awaiting_packaging", "awaiting_deliver", "delivering", "delivered", "cancelled"]:
                result = await session.execute(
                    select(func.count(OzonPosting.id))
                    .where(OzonPosting.operation_status.is_(None))
                    .where(OzonPosting.status == status)
                )
                count = result.scalar()
                if count > 0:
                    print(f"  - {status}: {count}")

        # 1.2 查询 status=delivering 且 operation_status=allocated 且有国内单号的记录
        result = await session.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status == "delivering")
            .where(OzonPosting.operation_status == "allocated")
            .where(OzonPosting.domestic_tracking_number.isnot(None))
            .where(OzonPosting.domestic_tracking_number != "")
        )
        allocated_delivering_count = result.scalar()

        print(f"\n【类型2】OZON状态为运输中、有国内单号、但operation_status为已分配的记录: {allocated_delivering_count}")

        total_need_fix = null_count + allocated_delivering_count

        if total_need_fix == 0:
            print("\n✅ 没有需要修复的数据")
            return

        # 2. 确认是否继续
        print(f"\n将修复共 {total_need_fix} 条记录:")
        print(f"  - NULL → 对应状态: {null_count} 条")
        print(f"  - allocated → shipping (运输中且有国内单号): {allocated_delivering_count} 条")
        print(f"\n注意：运输中但没有国内单号的订单将保持 allocated 状态")
        confirm = input("\n是否继续？(y/n): ")
        if confirm.lower() != 'y':
            print("❌ 已取消")
            return

        # 3. 执行修复
        print("\n" + "=" * 60)
        print("开始执行更新...")
        print("=" * 60)

        # 重要：只修复 operation_status 为 NULL 的记录

        # 修复: awaiting_packaging, awaiting_deliver → awaiting_stock
        result = await session.execute(
            update(OzonPosting)
            .where(OzonPosting.operation_status.is_(None))
            .where(OzonPosting.status.in_(["awaiting_packaging", "awaiting_deliver"]))
            .values(operation_status="awaiting_stock")
        )
        awaiting_stock_count = result.rowcount
        print(f"\n✓ 设置 awaiting_stock (等待备货): {awaiting_stock_count} 条")

        # 修复: delivering → shipping
        result = await session.execute(
            update(OzonPosting)
            .where(OzonPosting.operation_status.is_(None))
            .where(OzonPosting.status == "delivering")
            .values(operation_status="shipping")
        )
        shipping_count = result.rowcount
        print(f"✓ 设置 shipping (运输中): {shipping_count} 条")

        # 修复: delivered → delivered
        result = await session.execute(
            update(OzonPosting)
            .where(OzonPosting.operation_status.is_(None))
            .where(OzonPosting.status == "delivered")
            .values(operation_status="delivered")
        )
        delivered_count = result.rowcount
        print(f"✓ 设置 delivered (已签收): {delivered_count} 条")

        # 修复: cancelled → cancelled
        result = await session.execute(
            update(OzonPosting)
            .where(OzonPosting.operation_status.is_(None))
            .where(OzonPosting.status == "cancelled")
            .values(operation_status="cancelled")
        )
        cancelled_count = result.rowcount
        print(f"✓ 设置 cancelled (已取消): {cancelled_count} 条")

        # 其他未知状态，默认设置为 awaiting_stock
        result = await session.execute(
            update(OzonPosting)
            .where(OzonPosting.operation_status.is_(None))
            .values(operation_status="awaiting_stock")
        )
        other_count = result.rowcount
        if other_count > 0:
            print(f"✓ 设置其他状态为 awaiting_stock (默认): {other_count} 条")

        # 【新增】修复: status=delivering 且 operation_status=allocated 且有国内单号 → shipping
        # 注意：没有国内单号的运输中订单保持 allocated 状态
        result = await session.execute(
            update(OzonPosting)
            .where(OzonPosting.status == "delivering")
            .where(OzonPosting.operation_status == "allocated")
            .where(OzonPosting.domestic_tracking_number.isnot(None))
            .where(OzonPosting.domestic_tracking_number != "")
            .values(operation_status="shipping")
        )
        allocated_to_shipping_count = result.rowcount
        print(f"✓ 修复 allocated → shipping (运输中且有国内单号): {allocated_to_shipping_count} 条")

        total_fixed = awaiting_stock_count + shipping_count + delivered_count + cancelled_count + other_count + allocated_to_shipping_count
        print(f"\n✅ 共修复 {total_fixed} 条记录")

        # 4. 提交事务
        await session.commit()

        # 5. 验证修复结果
        print("\n" + "=" * 60)
        print("📊 验证修复结果...")
        print("=" * 60)

        # 再次检查 operation_status 为 NULL 的记录
        result = await session.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.operation_status.is_(None))
        )
        remaining_null = result.scalar()

        if remaining_null > 0:
            print(f"⚠️  仍有 {remaining_null} 条记录的 operation_status 为 NULL")
        else:
            print("✅ 所有记录的 operation_status 已设置")

        # 按 operation_status 统计
        print("\n当前 operation_status 分布:")
        for op_status in ["awaiting_stock", "allocating", "allocated", "tracking_confirmed", "shipping", "delivered", "cancelled"]:
            result = await session.execute(
                select(func.count(OzonPosting.id))
                .where(OzonPosting.operation_status == op_status)
            )
            count = result.scalar()
            if count > 0:
                print(f"  - {op_status}: {count}")

        print("\n" + "=" * 60)
        print("✓ 操作完成！")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(fix_operation_status())
