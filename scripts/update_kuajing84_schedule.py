#!/usr/bin/env python3
"""
更新跨境巴士物料成本同步服务的调度配置
从 interval 模式改为 cron 模式，每小时第15分钟执行
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.sync_service import SyncService
from sqlalchemy import select


async def update_service_config():
    """更新服务配置"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 查询服务
        result = await session.execute(
            select(SyncService).where(SyncService.service_key == "kuajing84_material_cost")
        )
        service = result.scalar_one_or_none()

        if not service:
            print("❌ 未找到服务: kuajing84_material_cost")
            return

        print("📋 当前配置:")
        print(f"  - 服务类型: {service.service_type}")
        print(f"  - 调度配置: {service.schedule_config}")
        print(f"  - 启用状态: {service.is_enabled}")
        print(f"  - 描述: {service.service_description}")

        # 更新配置
        service.service_type = "cron"
        service.schedule_config = "15 * * * *"
        service.service_description = (
            '自动从跨境巴士查询并更新"已打包"订单的物料成本和国内物流单号'
            '（单线程模式：每小时第15分钟执行，每次处理1个订单，处理间隔5秒）'
        )
        service.is_enabled = True

        await session.commit()

        print("\n✅ 更新完成:")
        print(f"  - 服务类型: {service.service_type}")
        print(f"  - 调度配置: {service.schedule_config}")
        print(f"  - 启用状态: {service.is_enabled}")
        print(f"  - 描述: {service.service_description}")
        print("\n💡 请重启服务以应用配置: ./restart.sh")


if __name__ == "__main__":
    asyncio.run(update_service_config())
