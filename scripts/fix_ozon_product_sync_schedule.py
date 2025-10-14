#!/usr/bin/env python3
"""
修复OZON商品增量同步服务的调度配置
将调度间隔从5分钟（300秒）改为1小时（3600秒）
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.sync_service import SyncService
from sqlalchemy import select


async def fix_schedule():
    """修复调度配置"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 查询 ozon_product_sync 服务
        result = await session.execute(
            select(SyncService).where(SyncService.service_key == 'ozon_product_sync')
        )
        service = result.scalar_one_or_none()

        if not service:
            print("❌ 服务 'ozon_product_sync' 不存在")
            return False

        print("当前配置：")
        print(f"  服务名称: {service.service_name}")
        print(f"  服务描述: {service.service_description}")
        print(f"  调度类型: {service.service_type}")
        print(f"  调度配置: {service.schedule_config} 秒")

        if service.service_type == 'interval':
            minutes = int(service.schedule_config) / 60
            print(f"  → 当前频率: 每 {int(minutes)} 分钟")

        # 检查是否需要修改
        if service.schedule_config == '3600':
            print("\n✅ 配置已经正确（每小时），无需修改")
            return True

        print("\n正在更新配置...")

        # 更新调度配置
        service.schedule_config = '3600'

        # 更新描述
        service.service_description = "每小时自动同步一次OZON商品数据，包括价格、库存、状态等信息"

        await session.commit()

        print("✅ 配置已更新：")
        print(f"  调度配置: {service.schedule_config} 秒 (每 60 分钟)")
        print(f"  服务描述: {service.service_description}")
        print("\n⚠️  请重启服务使配置生效：./restart.sh")

        return True


if __name__ == '__main__':
    try:
        success = asyncio.run(fix_schedule())
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"❌ 执行失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
