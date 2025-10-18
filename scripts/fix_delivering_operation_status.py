#!/usr/bin/env python3
"""
临时脚本：修复OZON状态为"运输中"的订单的operation_status
- 有追踪号 → allocated（已分配）
- 没有追踪号 → allocating（分配中）
"""
import sys
import os
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting, OzonShipmentPackage


async def has_tracking_number(posting: OzonPosting, session: AsyncSession) -> tuple[bool, str]:
    """
    检查posting是否有追踪号码

    返回: (是否有追踪号, 追踪号码或None)
    """
    tracking_number = None

    # 方法1: 从packages表获取
    stmt = select(OzonShipmentPackage).where(OzonShipmentPackage.posting_id == posting.id)
    result = await session.execute(stmt)
    packages = result.scalars().all()

    for package in packages:
        if package.tracking_number:
            # 验证不是错误的posting_number
            if package.tracking_number != posting.posting_number:
                tracking_number = package.tracking_number
                break

    # 方法2: 从raw_payload获取(fallback)
    if not tracking_number and posting.raw_payload:
        raw_tn = posting.raw_payload.get("tracking_number")
        # 验证不是错误的posting_number
        if raw_tn and raw_tn != posting.posting_number:
            tracking_number = raw_tn

    return (bool(tracking_number), tracking_number)


async def fix_delivering_operation_status():
    """修复运输中订单的operation_status"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 统计需要修复的数据
        print("=" * 60)
        print("开始统计OZON状态为'运输中'的订单...")
        print("=" * 60)

        # 查询所有OZON状态为delivering的posting
        stmt = select(OzonPosting).where(OzonPosting.status == 'delivering')
        result = await session.execute(stmt)
        delivering_postings = result.scalars().all()

        print(f"\n总共找到 {len(delivering_postings)} 个'运输中'的订单")

        # 分类统计
        has_tracking_list = []  # 有追踪号的
        no_tracking_list = []   # 没有追踪号的

        for posting in delivering_postings:
            has_tn, tracking_num = await has_tracking_number(posting, session)
            if has_tn:
                has_tracking_list.append((posting, tracking_num))
            else:
                no_tracking_list.append(posting)

        print(f"\n分类统计:")
        print(f"  - 有追踪号: {len(has_tracking_list)} 个")
        print(f"  - 无追踪号: {len(no_tracking_list)} 个")

        # 显示示例
        if has_tracking_list[:3]:
            print(f"\n有追踪号示例:")
            for posting, tn in has_tracking_list[:3]:
                print(f"  posting: {posting.posting_number}, tracking: {tn}, current_status: {posting.operation_status}")

        if no_tracking_list[:3]:
            print(f"\n无追踪号示例:")
            for posting in no_tracking_list[:3]:
                print(f"  posting: {posting.posting_number}, current_status: {posting.operation_status}")

        # 统计需要修复的数量
        need_fix_to_allocated = 0
        need_fix_to_allocating = 0

        for posting, _ in has_tracking_list:
            if posting.operation_status != 'allocated':
                need_fix_to_allocated += 1

        for posting in no_tracking_list:
            if posting.operation_status != 'allocating':
                need_fix_to_allocating += 1

        print("\n" + "=" * 60)
        print("需要修复的数量:")
        print(f"  - 有追踪号但状态不是'allocated': {need_fix_to_allocated} 个")
        print(f"  - 无追踪号但状态不是'allocating': {need_fix_to_allocating} 个")
        print("=" * 60)

        if need_fix_to_allocated == 0 and need_fix_to_allocating == 0:
            print("\n✓ 所有数据都正确，无需修复!")
            return

        # 开始修复
        print("\n开始修复...")

        fixed_to_allocated = 0
        fixed_to_allocating = 0

        # 修复有追踪号的 → allocated
        for posting, tracking_num in has_tracking_list:
            if posting.operation_status != 'allocated':
                old_status = posting.operation_status
                posting.operation_status = 'allocated'
                fixed_to_allocated += 1
                if fixed_to_allocated <= 5:
                    print(f"  {posting.posting_number}: {old_status} → allocated (tracking: {tracking_num})")

        # 修复无追踪号的 → allocating
        for posting in no_tracking_list:
            if posting.operation_status != 'allocating':
                old_status = posting.operation_status
                posting.operation_status = 'allocating'
                fixed_to_allocating += 1
                if fixed_to_allocating <= 5:
                    print(f"  {posting.posting_number}: {old_status} → allocating (no tracking)")

        if fixed_to_allocated > 5:
            print(f"  ... 还有 {fixed_to_allocated - 5} 个修复为allocated")
        if fixed_to_allocating > 5:
            print(f"  ... 还有 {fixed_to_allocating - 5} 个修复为allocating")

        print(f"\n✓ 已修复 {fixed_to_allocated} 个为'allocated'")
        print(f"✓ 已修复 {fixed_to_allocating} 个为'allocating'")

        # 提交事务
        await session.commit()

        # 验证修复结果
        print("\n" + "=" * 60)
        print("验证修复结果...")
        print("=" * 60)

        # 重新查询统计
        stmt = select(OzonPosting).where(OzonPosting.status == 'delivering')
        result = await session.execute(stmt)
        all_delivering = result.scalars().all()

        allocated_count = 0
        allocating_count = 0
        other_count = 0
        other_examples = []

        for posting in all_delivering:
            if posting.operation_status == 'allocated':
                allocated_count += 1
            elif posting.operation_status == 'allocating':
                allocating_count += 1
            else:
                other_count += 1
                if len(other_examples) < 3:
                    other_examples.append((posting.posting_number, posting.operation_status))

        print(f"\n当前'运输中'订单的operation_status分布:")
        print(f"  - allocated (已分配): {allocated_count} 个")
        print(f"  - allocating (分配中): {allocating_count} 个")
        print(f"  - 其他状态: {other_count} 个")

        if other_examples:
            print(f"\n其他状态示例:")
            for posting_num, status in other_examples:
                print(f"  {posting_num}: {status}")

        print("\n" + "=" * 60)
        print("✓ 修复完成!")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(fix_delivering_operation_status())
