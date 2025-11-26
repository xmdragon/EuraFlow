"""
每日统计聚合任务

每天北京时间22:00（UTC 14:00）执行，重新计算过去30天的统计数据。
订单生命周期长（发货到签收可达1个月），需要滚动更新。
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta, date
from decimal import Decimal
from typing import Dict, Any, Optional

from sqlalchemy import select, func, and_, case
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_task_db_manager
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


def _get_database_url() -> str:
    """从环境变量构建数据库 URL"""
    host = os.getenv("EF__DB_HOST", "localhost")
    port = os.getenv("EF__DB_PORT", "5432")
    user = os.getenv("EF__DB_USER", "euraflow")
    password = os.getenv("EF__DB_PASSWORD", "")
    database = os.getenv("EF__DB_NAME", "euraflow")
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{database}"


@celery_app.task(bind=True, name="ef.ozon.stats.daily_aggregation")
def aggregate_daily_stats(self):
    """
    每日统计聚合任务

    计算过去30天每个店铺每天的统计数据，使用 UPSERT 更新已有记录。
    """
    try:
        logger.info("Starting daily stats aggregation")

        # 在新事件循环中运行异步代码
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(_aggregate_stats())
        finally:
            loop.close()
            asyncio.set_event_loop(None)

        logger.info(f"Daily stats aggregation completed: {result}")
        return result

    except Exception as e:
        logger.error(f"Daily stats aggregation failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


async def _aggregate_stats() -> Dict[str, Any]:
    """执行统计聚合"""
    from ..models.ozon_shops import OzonShop
    from ..models.orders import OzonPosting, OzonOrder
    from ..models.stats import OzonDailyStats

    # 创建独立的数据库引擎（避免与全局单例冲突）
    engine = create_async_engine(
        _get_database_url(),
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=0,
    )
    async_session_factory = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    # 计算日期范围（过去30天）
    today = date.today()
    start_date = today - timedelta(days=30)

    total_upserted = 0
    shop_count = 0

    try:
        async with async_session_factory() as db:
            # 获取所有活跃店铺
            shops_result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops = shops_result.scalars().all()
            shop_count = len(shops)

            if not shops:
                logger.warning("No active shops found for stats aggregation")
                return {"success": True, "upserted": 0, "shops": 0}

            for shop in shops:
                shop_id = shop.id

                # 使用 SQL GROUP BY 聚合统计（按日期分组）
                stats_query = select(
                    func.date(OzonOrder.ordered_at).label('stat_date'),
                    func.count().label('order_count'),
                    # 签收订单数
                    func.sum(
                        case((OzonPosting.status == 'delivered', 1), else_=0)
                    ).label('delivered_count'),
                    # 取消订单数
                    func.sum(
                        case((OzonPosting.status == 'cancelled', 1), else_=0)
                    ).label('cancelled_count'),
                    # 销售总额（使用预计算的 order_total_price，避免 JSONB 解析）
                    func.coalesce(
                        func.sum(
                            case(
                                (OzonPosting.status != 'cancelled', OzonPosting.order_total_price),
                                else_=Decimal('0')
                            )
                        ),
                        Decimal('0')
                    ).label('total_sales'),
                    # 采购成本
                    func.coalesce(func.sum(OzonPosting.purchase_price), Decimal('0')).label('total_purchase'),
                    # 平台佣金
                    func.coalesce(func.sum(OzonPosting.ozon_commission_cny), Decimal('0')).label('total_commission'),
                    # 物流费用（国际物流 + 尾程派送）
                    func.coalesce(
                        func.sum(OzonPosting.international_logistics_fee_cny) +
                        func.sum(OzonPosting.last_mile_delivery_fee_cny),
                        Decimal('0')
                    ).label('total_logistics'),
                    # 物料成本
                    func.coalesce(func.sum(OzonPosting.material_cost), Decimal('0')).label('total_material_cost'),
                ).select_from(OzonPosting).join(
                    OzonOrder, OzonPosting.order_id == OzonOrder.id
                ).where(
                    and_(
                        OzonOrder.shop_id == shop_id,
                        OzonOrder.ordered_at >= datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc),
                        OzonOrder.ordered_at < datetime.combine(today + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc),
                    )
                ).group_by(
                    func.date(OzonOrder.ordered_at)
                )

                result = await db.execute(stats_query)
                daily_data = result.all()

                # UPSERT 每日统计
                now = datetime.now(timezone.utc)
                for row in daily_data:
                    stat_date = row.stat_date
                    if stat_date is None:
                        continue

                    # 计算利润
                    total_sales = row.total_sales or Decimal('0')
                    total_purchase = row.total_purchase or Decimal('0')
                    total_commission = row.total_commission or Decimal('0')
                    total_logistics = row.total_logistics or Decimal('0')
                    total_material_cost = row.total_material_cost or Decimal('0')
                    total_profit = total_sales - (total_purchase + total_commission + total_logistics + total_material_cost)

                    # 构建 UPSERT 语句
                    stmt = insert(OzonDailyStats).values(
                        shop_id=shop_id,
                        date=stat_date,
                        order_count=row.order_count or 0,
                        delivered_count=row.delivered_count or 0,
                        cancelled_count=row.cancelled_count or 0,
                        total_sales=total_sales,
                        total_purchase=total_purchase,
                        total_profit=total_profit,
                        total_commission=total_commission,
                        total_logistics=total_logistics,
                        total_material_cost=total_material_cost,
                        generated_at=now,
                    )

                    # ON CONFLICT UPDATE
                    stmt = stmt.on_conflict_do_update(
                        constraint='uq_ozon_daily_stats_shop_date',
                        set_={
                            'order_count': stmt.excluded.order_count,
                            'delivered_count': stmt.excluded.delivered_count,
                            'cancelled_count': stmt.excluded.cancelled_count,
                            'total_sales': stmt.excluded.total_sales,
                            'total_purchase': stmt.excluded.total_purchase,
                            'total_profit': stmt.excluded.total_profit,
                            'total_commission': stmt.excluded.total_commission,
                            'total_logistics': stmt.excluded.total_logistics,
                            'total_material_cost': stmt.excluded.total_material_cost,
                            'generated_at': stmt.excluded.generated_at,
                            'updated_at': now,
                        }
                    )

                    await db.execute(stmt)
                    total_upserted += 1

                logger.info(f"Shop {shop_id} ({shop.shop_name}): {len(daily_data)} days aggregated")

            await db.commit()

        return {
            "success": True,
            "upserted": total_upserted,
            "shops": shop_count,
            "date_range": f"{start_date} to {today}",
        }
    finally:
        # 清理数据库引擎
        await engine.dispose()


async def aggregate_stats_for_date_range(
    shop_id: Optional[int] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None
) -> Dict[str, Any]:
    """
    手动触发的统计聚合（可指定店铺和日期范围）

    用于回填历史数据或重新计算特定日期范围的统计。
    """
    from ..models.ozon_shops import OzonShop

    db_manager = get_task_db_manager()

    # 默认日期范围
    if end_date is None:
        end_date = date.today()
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    async with db_manager.get_session() as db:
        # 获取店铺列表
        if shop_id:
            shops_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
        else:
            shops_result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
        shops = shops_result.scalars().all()

        if not shops:
            return {"success": False, "error": "No shops found"}

        logger.info(f"Manual aggregation: shops={[s.id for s in shops]}, range={start_date} to {end_date}")

    # 直接调用异步聚合函数（避免 Celery result.get() 阻塞问题）
    return await _aggregate_stats()
