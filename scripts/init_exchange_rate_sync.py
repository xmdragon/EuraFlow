"""
初始化汇率刷新同步服务配置
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from ef_core.database import get_db_manager
from sqlalchemy import text


async def init_sync_service():
    """初始化汇率刷新同步服务"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        try:
            # 插入汇率刷新服务配置（如果不存在）
            await db.execute(text("""
                INSERT INTO sync_services (
                    service_key,
                    service_name,
                    service_type,
                    schedule_config,
                    is_enabled,
                    run_count,
                    success_count,
                    error_count,
                    created_at,
                    updated_at
                ) VALUES (
                    'exchange_rate_refresh',
                    '汇率刷新',
                    'interval',
                    '1800',
                    true,
                    0,
                    0,
                    0,
                    NOW(),
                    NOW()
                )
                ON CONFLICT (service_key) DO NOTHING
            """))

            await db.commit()
            print("✅ 汇率刷新服务配置已初始化")
            print("   - service_key: exchange_rate_refresh")
            print("   - service_type: interval")
            print("   - schedule_config: 1800 (每30分钟)")
            print("   - is_enabled: true")

        except Exception as e:
            print(f"❌ 初始化失败: {e}")
            await db.rollback()
            raise

    await db_manager.close()


if __name__ == "__main__":
    asyncio.run(init_sync_service())
