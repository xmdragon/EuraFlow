#!/usr/bin/env python3
"""
紧急修复脚本：批量修复被错误标记为已取消的订单
- 检查所有 is_cancelled=True 的订单
- 如果 raw_payload.cancellation 没有真实取消信息，设置为 False
- 保留真正取消的订单（有 cancel_reason_id/cancel_reason/cancellation_type）
"""
import sys
import os
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import asyncio
from sqlalchemy import select, update, func

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting


async def fix_all_cancelled_status():
    """批量修复订单取消状态"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        print('='*80)
        print('【批量修复订单取消状态】')
        print('='*80)

        # 1. 统计需要修复的数据
        print('\n统计数据...')

        # 总订单数
        stmt = select(func.count(OzonPosting.id))
        total = (await session.execute(stmt)).scalar()
        print(f'  总 posting 数量: {total}')

        # 被标记为取消的订单
        stmt = select(func.count(OzonPosting.id)).where(
            OzonPosting.is_cancelled == True
        )
        marked_cancelled = (await session.execute(stmt)).scalar()
        print(f'  标记为已取消: {marked_cancelled} ({marked_cancelled/total*100:.1f}%)')

        # 2. 分析哪些订单需要修复
        print('\n分析订单...')

        stmt = select(OzonPosting).where(OzonPosting.is_cancelled == True)
        result = await session.execute(stmt)
        all_cancelled = result.scalars().all()

        need_fix_ids = []  # 需要修复的订单ID
        keep_cancelled_ids = []  # 保持取消状态的订单ID

        for posting in all_cancelled:
            # 检查 raw_payload 中是否有真实取消信息
            has_real_cancellation = False

            if posting.raw_payload:
                cancellation = posting.raw_payload.get('cancellation', {})
                # 检查是否有实际的取消信息
                if (cancellation.get('cancel_reason_id') or
                    cancellation.get('cancel_reason') or
                    cancellation.get('cancellation_type')):
                    has_real_cancellation = True

            if has_real_cancellation:
                keep_cancelled_ids.append(posting.id)
            else:
                need_fix_ids.append(posting.id)

        print(f'  真正取消的订单: {len(keep_cancelled_ids)} 个（保持不变）')
        print(f'  错误标记的订单: {len(need_fix_ids)} 个（需要修复）')

        if len(need_fix_ids) == 0:
            print('\n✅ 没有需要修复的数据')
            return

        # 3. 按状态分组显示需要修复的订单
        print(f'\n需要修复的订单按状态分布:')
        status_counts = {}
        for posting in all_cancelled:
            if posting.id in need_fix_ids:
                status = posting.status
                status_counts[status] = status_counts.get(status, 0) + 1

        for status, count in sorted(status_counts.items()):
            print(f'  {status}: {count}')

        # 4. 确认执行
        print(f'\n准备修复 {len(need_fix_ids)} 个订单')
        print(f'这些订单将从 is_cancelled=True 改为 is_cancelled=False')

        # 5. 执行批量更新
        print('\n开始执行批量更新...')

        # 使用批量更新提升性能
        stmt = (
            update(OzonPosting)
            .where(OzonPosting.id.in_(need_fix_ids))
            .values(is_cancelled=False)
        )
        result = await session.execute(stmt)

        print(f'✅ 已更新 {result.rowcount} 条记录')

        # 6. 提交事务
        await session.commit()
        print('✅ 事务已提交')

        # 7. 验证修复结果
        print('\n' + '='*80)
        print('【验证修复结果】')
        print('='*80)

        # 重新统计
        stmt = select(func.count(OzonPosting.id)).where(
            OzonPosting.is_cancelled == True
        )
        remaining_cancelled = (await session.execute(stmt)).scalar()

        print(f'\n当前标记为已取消的订单: {remaining_cancelled} 个')
        print(f'预期应该是: {len(keep_cancelled_ids)} 个')

        if remaining_cancelled == len(keep_cancelled_ids):
            print('\n✅ 验证通过！所有数据已正确修复')
        else:
            print(f'\n⚠️  警告：实际数量 ({remaining_cancelled}) 与预期 ({len(keep_cancelled_ids)}) 不符')

        # 按状态统计最终结果
        print('\n最终按状态分布（is_cancelled=True）:')
        for status in ['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled']:
            stmt = select(func.count(OzonPosting.id)).where(
                OzonPosting.is_cancelled == True,
                OzonPosting.status == status
            )
            count = (await session.execute(stmt)).scalar()
            if count > 0:
                print(f'  {status}: {count}')

        # 抽查几个已修复的订单
        print('\n抽查已修复的订单（前5个）:')
        if need_fix_ids[:5]:
            stmt = select(OzonPosting).where(OzonPosting.id.in_(need_fix_ids[:5]))
            result = await session.execute(stmt)
            samples = result.scalars().all()

            for p in samples:
                print(f'  {p.posting_number}: status={p.status}, is_cancelled={p.is_cancelled}')

        print('\n' + '='*80)
        print('✓ 修复完成！')
        print('='*80)


if __name__ == "__main__":
    asyncio.run(fix_all_cancelled_status())
