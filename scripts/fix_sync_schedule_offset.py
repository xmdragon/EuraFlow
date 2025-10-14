#!/usr/bin/env python3
"""
优化OZON同步任务调度，避免资源竞争

调整策略：
1. 商品同步：每小时整点执行（0 * * * *）
2. 订单同步：每小时30分执行（30 * * * *）
3. 两个任务错开30分钟，避免同时运行导致资源竞争
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.sync_service import SyncService
from sqlalchemy import select


async def optimize_schedule():
    """优化同步任务调度"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        print("="*80)
        print("优化 OZON 同步任务调度")
        print("="*80)

        # 1. 更新商品同步服务
        result = await session.execute(
            select(SyncService).where(SyncService.service_key == 'ozon_product_sync')
        )
        product_sync = result.scalar_one_or_none()

        if not product_sync:
            print("❌ 商品同步服务不存在")
            return False

        print("\n【商品同步服务】")
        print(f"当前配置: {product_sync.service_type} - {product_sync.schedule_config}")

        # 改为cron表达式：每小时整点执行
        product_sync.service_type = 'cron'
        product_sync.schedule_config = '0 * * * *'
        product_sync.service_description = '每小时整点同步OZON商品数据（价格、库存、状态等）'

        print(f"新配置: {product_sync.service_type} - {product_sync.schedule_config}")
        print(f"执行时间: 每小时整点（如：10:00, 11:00, 12:00...）")

        # 2. 更新订单同步服务
        result = await session.execute(
            select(SyncService).where(SyncService.service_key == 'ozon_sync_incremental')
        )
        order_sync = result.scalar_one_or_none()

        if not order_sync:
            print("\n❌ 订单同步服务不存在")
            return False

        print("\n【订单同步服务】")
        print(f"当前配置: {order_sync.service_type} - {order_sync.schedule_config}")

        # 改为cron表达式：每小时30分执行
        order_sync.service_type = 'cron'
        order_sync.schedule_config = '30 * * * *'
        order_sync.service_description = '每小时30分同步OZON订单数据（增量模式，最近48小时变更）'

        print(f"新配置: {order_sync.service_type} - {order_sync.schedule_config}")
        print(f"执行时间: 每小时30分（如：10:30, 11:30, 12:30...）")

        # 提交更改
        await session.commit()

        print("\n" + "="*80)
        print("✅ 调度优化完成")
        print("="*80)
        print("\n调度策略：")
        print("  10:00 → 商品同步")
        print("  10:30 → 订单同步（错开30分钟）")
        print("  11:00 → 商品同步")
        print("  11:30 → 订单同步（错开30分钟）")
        print("  ...")
        print("\n⚠️  请重启服务使配置生效：./restart.sh")

        return True


if __name__ == '__main__':
    try:
        success = asyncio.run(optimize_schedule())
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"❌ 执行失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
