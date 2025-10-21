"""
OZON财务交易历史数据导入脚本

功能：
- 从数据库最早订单日期开始，逐天导入财务交易数据
- 支持断点续传（通过水位线表记录进度）
- 错误处理和重试机制
- 进度显示

使用方式：
python scripts/import_finance_transactions.py --shop-id 1 --start-date auto
python scripts/import_finance_transactions.py --shop-id 1 --start-date 2024-01-01 --end-date 2024-12-31
"""
import asyncio
import argparse
import sys
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# 必须在导入其他模块之前设置环境变量
os.environ.setdefault('EF__DATABASE__URL', 'postgresql+asyncpg://euraflow_dev:euraflow_dev@localhost:5432/euraflow_dev')

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonShop, OzonOrder
from plugins.ef.channels.ozon.models.finance import OzonFinanceSyncWatermark
from plugins.ef.channels.ozon.services.finance_transactions_sync_service import get_finance_transactions_sync_service
from sqlalchemy import select, func


async def get_earliest_order_date(db, shop_id: int) -> datetime:
    """获取最早订单日期"""
    result = await db.execute(
        select(func.min(OzonOrder.ordered_at))
        .where(OzonOrder.shop_id == shop_id)
    )
    earliest_date = result.scalar()

    if not earliest_date:
        raise ValueError(f"店铺 {shop_id} 没有任何订单数据")

    return earliest_date


async def get_watermark(db, shop_id: int) -> OzonFinanceSyncWatermark:
    """获取水位线"""
    result = await db.execute(
        select(OzonFinanceSyncWatermark)
        .where(OzonFinanceSyncWatermark.shop_id == shop_id)
    )
    return result.scalar_one_or_none()


async def main(shop_id: int, start_date: str, end_date: str):
    """主函数"""
    print("=" * 60)
    print("OZON财务交易历史数据导入工具")
    print("=" * 60)

    db_manager = get_db_manager()
    finance_service = get_finance_transactions_sync_service()

    async with db_manager.get_session() as db:
        # 1. 验证店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = result.scalar_one_or_none()

        if not shop:
            print(f"❌ 错误：店铺ID {shop_id} 不存在")
            return

        print(f"✓ 店铺: {shop.shop_name} (ID: {shop.id})")

        # 2. 确定开始日期
        if start_date == "auto":
            # 从最早订单日期开始
            earliest_order_date = await get_earliest_order_date(db, shop_id)
            start_date_obj = earliest_order_date.date()
            print(f"✓ 自动检测到最早订单日期: {start_date_obj}")

            # 检查水位线是否存在
            watermark = await get_watermark(db, shop_id)
            if watermark and watermark.last_sync_date:
                last_sync_date = watermark.last_sync_date.date()
                print(f"✓ 检测到上次同步日期: {last_sync_date}")
                # 从上次同步日期的下一天开始
                start_date_obj = last_sync_date + timedelta(days=1)
                print(f"✓ 断点续传：从 {start_date_obj} 开始")
        else:
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()
            print(f"✓ 手动指定开始日期: {start_date_obj}")

        # 3. 确定结束日期
        if end_date:
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            # 默认到昨天
            end_date_obj = (datetime.now(timezone.utc) - timedelta(days=1)).date()

        print(f"✓ 结束日期: {end_date_obj}")

        # 4. 计算总天数
        total_days = (end_date_obj - start_date_obj).days + 1

        if total_days <= 0:
            print(f"❌ 错误：开始日期 {start_date_obj} 晚于结束日期 {end_date_obj}")
            return

        print(f"✓ 总计需要同步: {total_days} 天")
        print("=" * 60)

        # 5. 逐天导入
        current_date = start_date_obj
        success_count = 0
        fail_count = 0
        total_transactions = 0

        while current_date <= end_date_obj:
            day_index = (current_date - start_date_obj).days + 1
            print(f"\n[{day_index}/{total_days}] 正在同步 {current_date}...")

            try:
                # 调用同步服务
                result = await finance_service.sync_transactions({
                    "target_date": current_date.isoformat(),
                    "shop_id": shop_id
                })

                synced_count = result.get("records_updated", 0)
                total_transactions += synced_count

                if synced_count > 0:
                    print(f"  ✓ 成功同步 {synced_count} 条交易记录")
                else:
                    print(f"  - 该日期无交易数据")

                success_count += 1

            except Exception as e:
                print(f"  ❌ 同步失败: {e}")
                fail_count += 1

                # 错误后是否继续
                if fail_count >= 5:
                    print("\n❌ 连续失败次数过多，停止导入")
                    break

            # 移动到下一天
            current_date += timedelta(days=1)

            # 避免API限流，稍微延迟
            await asyncio.sleep(0.5)

        # 6. 总结
        print("\n" + "=" * 60)
        print("导入完成！")
        print(f"成功: {success_count} 天")
        print(f"失败: {fail_count} 天")
        print(f"总交易记录: {total_transactions} 条")
        print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OZON财务交易历史数据导入工具")
    parser.add_argument("--shop-id", type=int, required=True, help="店铺ID")
    parser.add_argument(
        "--start-date",
        type=str,
        default="auto",
        help="开始日期（YYYY-MM-DD格式，或使用'auto'自动检测）"
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="结束日期（YYYY-MM-DD格式，不指定则默认到昨天）"
    )

    args = parser.parse_args()

    try:
        asyncio.run(main(
            shop_id=args.shop_id,
            start_date=args.start_date,
            end_date=args.end_date
        ))
    except KeyboardInterrupt:
        print("\n\n⚠️ 用户中断导入")
    except Exception as e:
        print(f"\n\n❌ 导入失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
