"""
检查汇率刷新服务状态
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from ef_core.database import get_db_manager
from sqlalchemy import text
import json


async def check_service():
    """检查汇率刷新服务状态"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        try:
            print("=" * 60)
            print("检查汇率刷新服务配置")
            print("=" * 60)

            # 1. 检查 sync_services 表中的配置
            result = await db.execute(text("""
                SELECT
                    service_key,
                    service_name,
                    service_type,
                    schedule_config,
                    is_enabled,
                    run_count,
                    success_count,
                    error_count,
                    last_run_at,
                    last_run_status,
                    last_run_message,
                    created_at,
                    updated_at
                FROM sync_services
                WHERE service_key = 'exchange_rate_refresh'
            """))

            row = result.fetchone()

            if row:
                print("\n✅ 找到服务配置:")
                print(f"   - service_key: {row[0]}")
                print(f"   - service_name: {row[1]}")
                print(f"   - service_type: {row[2]}")
                print(f"   - schedule_config: {row[3]}")
                print(f"   - is_enabled: {row[4]}")
                print(f"   - run_count: {row[5]}")
                print(f"   - success_count: {row[6]}")
                print(f"   - error_count: {row[7]}")
                print(f"   - last_run_at: {row[8]}")
                print(f"   - last_run_status: {row[9]}")
                print(f"   - last_run_message: {row[10]}")
                print(f"   - created_at: {row[11]}")
                print(f"   - updated_at: {row[12]}")
            else:
                print("\n❌ 未找到服务配置！")
                print("   请运行: python scripts/init_exchange_rate_sync.py")

            print("\n" + "=" * 60)
            print("检查汇率API配置")
            print("=" * 60)

            # 2. 检查 exchange_rate_config 表（注意：单数，不是复数）
            result = await db.execute(text("""
                SELECT
                    id,
                    api_provider,
                    base_currency,
                    is_enabled,
                    created_at,
                    updated_at
                FROM exchange_rate_config
            """))

            config = result.fetchone()

            if config:
                print("\n✅ 找到汇率API配置:")
                print(f"   - id: {config[0]}")
                print(f"   - api_provider: {config[1]}")
                print(f"   - base_currency: {config[2]}")
                print(f"   - is_enabled: {config[3]}")
                print(f"   - created_at: {config[4]}")
                print(f"   - updated_at: {config[5]}")
            else:
                print("\n❌ 未找到汇率API配置！")
                print("   请通过前端页面配置汇率API密钥")

            print("\n" + "=" * 60)
            print("检查汇率历史记录")
            print("=" * 60)

            # 3. 检查 exchange_rates 表
            result = await db.execute(text("""
                SELECT
                    from_currency,
                    to_currency,
                    rate,
                    source,
                    fetched_at,
                    expires_at
                FROM exchange_rates
                ORDER BY fetched_at DESC
                LIMIT 5
            """))

            rates = result.fetchall()

            if rates:
                print(f"\n✅ 找到 {len(rates)} 条汇率记录（最近5条）:")
                for rate in rates:
                    print(f"   - {rate[0]} -> {rate[1]}: {rate[2]} (来源: {rate[3]})")
                    print(f"     获取时间: {rate[4]}, 过期时间: {rate[5]}")
            else:
                print("\n⚠️  未找到汇率历史记录")
                print("   服务尚未成功执行过")

            print("\n" + "=" * 60)
            print("检查同步日志")
            print("=" * 60)

            # 4. 检查 sync_service_logs 表
            result = await db.execute(text("""
                SELECT
                    run_id,
                    status,
                    error_message,
                    records_processed,
                    records_updated,
                    execution_time_ms,
                    started_at,
                    finished_at
                FROM sync_service_logs
                WHERE service_key = 'exchange_rate_refresh'
                ORDER BY started_at DESC
                LIMIT 5
            """))

            logs = result.fetchall()

            if logs:
                print(f"\n✅ 找到 {len(logs)} 条执行日志（最近5条）:")
                for log in logs:
                    print(f"   - run_id: {log[0]}")
                    print(f"     status: {log[1]}")
                    print(f"     error_message: {log[2]}")
                    print(f"     records_processed: {log[3]}")
                    print(f"     records_updated: {log[4]}")
                    print(f"     execution_time_ms: {log[5]}")
                    print(f"     started_at: {log[6]}")
                    print(f"     finished_at: {log[7]}")
                    print()
            else:
                print("\n⚠️  未找到执行日志")
                print("   服务可能从未执行过，或日志记录有问题")

        except Exception as e:
            print(f"\n❌ 检查失败: {e}")
            import traceback
            traceback.print_exc()
            await db.rollback()

    await db_manager.close()


if __name__ == "__main__":
    asyncio.run(check_service())
