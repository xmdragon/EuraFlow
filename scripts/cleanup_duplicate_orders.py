#!/usr/bin/env python3
"""
清理重复的订单记录

对于每个 (shop_id, ozon_order_id) 组合，保留最新的记录（id最大），删除其他重复记录
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from ef_core.database import get_async_session
from plugins.ef.channels.ozon.models import OzonOrder


async def cleanup_duplicates():
    """清理重复的订单记录"""
    async for session in get_async_session():
        # 1. 找出所有重复的 (shop_id, ozon_order_id)
        duplicate_query = select(
            OzonOrder.shop_id,
            OzonOrder.ozon_order_id,
            func.count(OzonOrder.id).label('count'),
            func.array_agg(OzonOrder.id).label('ids')
        ).group_by(
            OzonOrder.shop_id,
            OzonOrder.ozon_order_id
        ).having(func.count(OzonOrder.id) > 1)

        result = await session.execute(duplicate_query)
        duplicates = result.all()

        if not duplicates:
            print("✓ No duplicate orders found")
            return

        print(f"Found {len(duplicates)} duplicate order groups")
        print("\nDuplicate orders:")
        for row in duplicates:
            print(f"  shop_id={row.shop_id}, ozon_order_id={row.ozon_order_id}, count={row.count}, ids={row.ids}")

        # 2. 对每个重复组，保留最新的记录（id最大），删除其他
        total_deleted = 0
        for row in duplicates:
            ids = row.ids
            # 保留最大的ID（最新的记录）
            ids_to_keep = max(ids)
            ids_to_delete = [id for id in ids if id != ids_to_keep]

            if ids_to_delete:
                # 删除旧的重复记录
                delete_stmt = delete(OzonOrder).where(OzonOrder.id.in_(ids_to_delete))
                result = await session.execute(delete_stmt)
                deleted_count = result.rowcount
                total_deleted += deleted_count

                print(f"\nDeleted {deleted_count} duplicates for shop_id={row.shop_id}, ozon_order_id={row.ozon_order_id}")
                print(f"  Kept ID: {ids_to_keep}")
                print(f"  Deleted IDs: {ids_to_delete}")

        # 3. 提交删除
        await session.commit()

        print(f"\n✓ Cleanup completed! Total deleted: {total_deleted} duplicate orders")

        # 4. 验证清理结果
        verify_query = select(
            func.count().label('duplicate_groups')
        ).select_from(
            select(
                OzonOrder.shop_id,
                OzonOrder.ozon_order_id,
                func.count(OzonOrder.id).label('count')
            ).group_by(
                OzonOrder.shop_id,
                OzonOrder.ozon_order_id
            ).having(func.count(OzonOrder.id) > 1).subquery()
        )

        verify_result = await session.execute(verify_query)
        remaining = verify_result.scalar()

        if remaining == 0:
            print("\n✓ Verification passed: No more duplicates")
        else:
            print(f"\n⚠ Warning: Still {remaining} duplicate groups remaining")

        break


if __name__ == "__main__":
    print("=" * 60)
    print("Cleaning up duplicate OZON orders...")
    print("=" * 60)
    asyncio.run(cleanup_duplicates())
