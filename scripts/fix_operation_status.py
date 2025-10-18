#!/usr/bin/env python3
"""
临时脚本：修复 posting 的 operation_status
- 运输中/已签收 → shipping
- 已取消/已废弃 → cancelled
"""
import asyncio
from sqlalchemy import select, update, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting


async def fix_operation_status():
    """修复 operation_status"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 1. 统计需要更新的数据
        print("=" * 60)
        print("开始统计需要更新的数据...")
        print("=" * 60)

        # 统计运输中/已签收的数据
        shipping_stmt = select(OzonPosting).where(
            OzonPosting.status.in_(['delivering', 'delivered'])
        )
        shipping_result = await session.execute(shipping_stmt)
        shipping_postings = shipping_result.scalars().all()
        print(f"\n1. 运输中/已签收状态的 posting 数量: {len(shipping_postings)}")

        # 统计已取消的数据
        cancelled_stmt = select(OzonPosting).where(
            or_(
                OzonPosting.status == 'cancelled',
                OzonPosting.is_cancelled == True,
                OzonPosting.operation_status == 'cancelled'
            )
        )
        cancelled_result = await session.execute(cancelled_stmt)
        cancelled_postings = cancelled_result.scalars().all()
        print(f"2. 已取消/已废弃状态的 posting 数量: {len(cancelled_postings)}")

        # 2. 执行更新
        print("\n" + "=" * 60)
        print("开始执行更新...")
        print("=" * 60)

        # 更新运输中/已签收 → shipping
        if shipping_postings:
            shipping_update = (
                update(OzonPosting)
                .where(OzonPosting.status.in_(['delivering', 'delivered']))
                .values(operation_status='shipping')
            )
            result = await session.execute(shipping_update)
            print(f"\n✓ 已更新运输中/已签收状态: {result.rowcount} 条")
        else:
            print("\n✓ 无需更新运输中/已签收状态")

        # 更新已取消/已废弃 → cancelled
        if cancelled_postings:
            cancelled_update = (
                update(OzonPosting)
                .where(
                    or_(
                        OzonPosting.status == 'cancelled',
                        OzonPosting.is_cancelled == True,
                        OzonPosting.operation_status == 'cancelled'
                    )
                )
                .values(operation_status='cancelled')
            )
            result = await session.execute(cancelled_update)
            print(f"✓ 已更新已取消/已废弃状态: {result.rowcount} 条")
        else:
            print("✓ 无需更新已取消/已废弃状态")

        # 3. 提交事务
        await session.commit()

        # 4. 验证更新结果
        print("\n" + "=" * 60)
        print("验证更新结果...")
        print("=" * 60)

        # 统计各 operation_status 的数量
        status_counts = {}
        for status in ['awaiting_stock', 'allocating', 'allocated', 'tracking_confirmed', 'shipping', 'cancelled']:
            stmt = select(OzonPosting).where(OzonPosting.operation_status == status)
            result = await session.execute(stmt)
            count = len(result.scalars().all())
            status_counts[status] = count

        print("\n当前各 operation_status 的数量分布:")
        print(f"  - awaiting_stock (等待备货):     {status_counts.get('awaiting_stock', 0)}")
        print(f"  - allocating (分配中):            {status_counts.get('allocating', 0)}")
        print(f"  - allocated (已分配):             {status_counts.get('allocated', 0)}")
        print(f"  - tracking_confirmed (单号确认):  {status_counts.get('tracking_confirmed', 0)}")
        print(f"  - shipping (运输中):              {status_counts.get('shipping', 0)}")
        print(f"  - cancelled (已取消):             {status_counts.get('cancelled', 0)}")

        # 统计 NULL 的数量
        null_stmt = select(OzonPosting).where(OzonPosting.operation_status.is_(None))
        null_result = await session.execute(null_stmt)
        null_count = len(null_result.scalars().all())
        print(f"  - NULL (未设置):                  {null_count}")

        print("\n" + "=" * 60)
        print("✓ 操作完成！")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(fix_operation_status())
