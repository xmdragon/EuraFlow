"""
OZON财务交易历史数据批量同步脚本（增强版）

功能：
- 自动同步所有活跃店铺的财务交易历史数据
- 从每个店铺的第一个订单日期开始，到昨天
- 以10天为单位进行批量同步（避免单次数据量过大）
- 支持断点续传（通过水位线表记录进度）
- 错误处理和重试机制
- 详细的进度显示

使用方式：
python scripts/sync_all_finance_history.py
python scripts/sync_all_finance_history.py --shop-id 1  # 仅同步指定店铺
python scripts/sync_all_finance_history.py --batch-days 7  # 自定义批次天数
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
    """获取店铺最早订单日期"""
    result = await db.execute(
        select(func.min(OzonOrder.ordered_at))
        .where(OzonOrder.shop_id == shop_id)
    )
    earliest_date = result.scalar()

    if not earliest_date:
        raise ValueError(f"店铺 {shop_id} 没有任何订单数据")

    return earliest_date


async def get_watermark(db, shop_id: int) -> OzonFinanceSyncWatermark:
    """获取水位线（上次同步到哪一天）"""
    result = await db.execute(
        select(OzonFinanceSyncWatermark)
        .where(OzonFinanceSyncWatermark.shop_id == shop_id)
    )
    return result.scalar_one_or_none()


async def sync_shop_history(
    shop: OzonShop,
    batch_days: int = 10,
    force_from_start: bool = False
):
    """
    同步单个店铺的历史财务数据

    Args:
        shop: 店铺对象
        batch_days: 每批次同步的天数（默认10天）
        force_from_start: 是否强制从头开始（忽略水位线）
    """
    print(f"\n{'='*80}")
    print(f"开始同步店铺: {shop.shop_name} (ID: {shop.id})")
    print(f"{'='*80}")

    db_manager = get_db_manager()
    finance_service = get_finance_transactions_sync_service()

    async with db_manager.get_session() as db:
        # 1. 确定开始日期
        try:
            earliest_order_date = await get_earliest_order_date(db, shop.id)
            start_date = earliest_order_date.date()
            print(f"✓ 最早订单日期: {start_date}")
        except ValueError as e:
            print(f"⚠️  {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "status": "skipped",
                "reason": "no_orders"
            }

        # 2. 检查水位线（断点续传）
        if not force_from_start:
            watermark = await get_watermark(db, shop.id)
            if watermark and watermark.last_sync_date:
                last_sync_date = watermark.last_sync_date.date()
                print(f"✓ 检测到上次同步日期: {last_sync_date}")
                # 从上次同步日期的下一天开始
                start_date = last_sync_date + timedelta(days=1)
                print(f"✓ 断点续传：从 {start_date} 开始")

        # 3. 确定结束日期（昨天）
        end_date = (datetime.now(timezone.utc) - timedelta(days=1)).date()
        print(f"✓ 结束日期: {end_date}")

        # 4. 计算总天数和批次数
        total_days = (end_date - start_date).days + 1

        if total_days <= 0:
            print(f"✓ 所有数据已同步完成")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "status": "completed",
                "reason": "already_synced"
            }

        total_batches = (total_days + batch_days - 1) // batch_days  # 向上取整
        print(f"✓ 需要同步: {total_days} 天，分为 {total_batches} 个批次（每批次 {batch_days} 天）")
        print(f"{'='*80}\n")

        # 5. 分批同步
        current_date = start_date
        batch_num = 0
        total_transactions = 0
        success_batches = 0
        failed_batches = 0
        failed_batch_details = []

        while current_date <= end_date:
            batch_num += 1
            batch_end_date = min(current_date + timedelta(days=batch_days - 1), end_date)
            batch_days_count = (batch_end_date - current_date).days + 1

            print(f"[批次 {batch_num}/{total_batches}] 同步 {current_date} ~ {batch_end_date} ({batch_days_count}天)")

            try:
                # 逐天同步（批次内）
                batch_transactions = 0
                batch_success = True

                for day_offset in range(batch_days_count):
                    sync_date = current_date + timedelta(days=day_offset)

                    try:
                        # 调用同步服务
                        result = await finance_service.sync_transactions({
                            "target_date": sync_date.isoformat(),
                            "shop_id": shop.id
                        })

                        synced_count = result.get("records_updated", 0)
                        batch_transactions += synced_count

                        if synced_count > 0:
                            print(f"  {sync_date}: ✓ {synced_count} 条")
                        else:
                            print(f"  {sync_date}: - 无数据")

                    except Exception as e:
                        print(f"  {sync_date}: ✗ 失败 - {e}")
                        batch_success = False
                        failed_batch_details.append({
                            "date": sync_date,
                            "error": str(e)
                        })

                    # 避免API限流
                    await asyncio.sleep(0.3)

                if batch_success:
                    success_batches += 1
                    total_transactions += batch_transactions
                    print(f"  ✓ 批次完成，同步 {batch_transactions} 条记录\n")
                else:
                    failed_batches += 1
                    print(f"  ⚠️  批次部分失败\n")

            except Exception as e:
                print(f"  ✗ 批次失败: {e}\n")
                failed_batches += 1
                failed_batch_details.append({
                    "batch": batch_num,
                    "date_range": f"{current_date} ~ {batch_end_date}",
                    "error": str(e)
                })

            # 移动到下一个批次
            current_date = batch_end_date + timedelta(days=1)

            # 批次间稍长延迟
            await asyncio.sleep(1)

        # 6. 总结
        print(f"{'='*80}")
        print(f"店铺同步完成: {shop.shop_name}")
        print(f"成功批次: {success_batches}/{total_batches}")
        print(f"失败批次: {failed_batches}/{total_batches}")
        print(f"总交易记录: {total_transactions} 条")
        if failed_batch_details:
            print(f"\n失败详情:")
            for detail in failed_batch_details[:5]:  # 只显示前5个
                print(f"  - {detail}")
        print(f"{'='*80}\n")

        return {
            "shop_id": shop.id,
            "shop_name": shop.shop_name,
            "status": "completed" if failed_batches == 0 else "partial",
            "total_batches": total_batches,
            "success_batches": success_batches,
            "failed_batches": failed_batches,
            "total_transactions": total_transactions,
            "failed_details": failed_batch_details
        }


async def main(shop_id: int = None, batch_days: int = 10, force_from_start: bool = False):
    """主函数"""
    print("=" * 80)
    print("OZON财务交易历史数据批量同步工具（增强版）")
    print("=" * 80)
    print(f"批次大小: 每 {batch_days} 天")
    print(f"断点续传: {'禁用（从头开始）' if force_from_start else '启用'}")
    print("=" * 80)

    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 查询要同步的店铺
        if shop_id:
            result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shops = [result.scalar_one_or_none()]
            if not shops[0]:
                print(f"❌ 错误：店铺ID {shop_id} 不存在")
                return
        else:
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops = result.scalars().all()

        if not shops:
            print("❌ 错误：没有找到活跃店铺")
            return

        print(f"✓ 找到 {len(shops)} 个店铺需要同步\n")

        # 同步所有店铺
        all_results = []
        for idx, shop in enumerate(shops, 1):
            print(f"\n进度: [{idx}/{len(shops)}]")
            result = await sync_shop_history(
                shop=shop,
                batch_days=batch_days,
                force_from_start=force_from_start
            )
            all_results.append(result)

            # 店铺之间休息一下
            if idx < len(shops):
                await asyncio.sleep(2)

        # 最终总结
        print("\n" + "=" * 80)
        print("所有店铺同步完成！")
        print("=" * 80)

        total_transactions_all = 0
        completed_shops = 0
        partial_shops = 0
        skipped_shops = 0

        for result in all_results:
            if result["status"] == "completed":
                if result.get("failed_batches", 0) == 0:
                    completed_shops += 1
                else:
                    partial_shops += 1
                total_transactions_all += result.get("total_transactions", 0)
            elif result["status"] == "partial":
                partial_shops += 1
                total_transactions_all += result.get("total_transactions", 0)
            elif result["status"] == "skipped":
                skipped_shops += 1

        print(f"总店铺数: {len(shops)}")
        print(f"  - 完全成功: {completed_shops}")
        print(f"  - 部分成功: {partial_shops}")
        print(f"  - 跳过: {skipped_shops}")
        print(f"总交易记录: {total_transactions_all} 条")
        print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OZON财务交易历史数据批量同步工具")
    parser.add_argument(
        "--shop-id",
        type=int,
        default=None,
        help="指定店铺ID（不指定则同步所有活跃店铺）"
    )
    parser.add_argument(
        "--batch-days",
        type=int,
        default=10,
        help="每批次同步的天数（默认10天）"
    )
    parser.add_argument(
        "--force-from-start",
        action="store_true",
        help="强制从头开始同步（忽略水位线）"
    )

    args = parser.parse_args()

    try:
        asyncio.run(main(
            shop_id=args.shop_id,
            batch_days=args.batch_days,
            force_from_start=args.force_from_start
        ))
    except KeyboardInterrupt:
        print("\n\n⚠️ 用户中断同步")
    except Exception as e:
        print(f"\n\n❌ 同步失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
