"""
批量财务费用同步任务
前端手动触发，同步最近7天内签收订单的佣金等财务数据
使用基于日期的批量查询方式，大幅提升性能
"""
import asyncio
import logging
from typing import Dict, Any
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import redis

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
from sqlalchemy import select, and_

from ..models.orders import OzonPosting
from ..models.ozon_shops import OzonShop
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)

# 创建线程池用于运行异步任务
_thread_pool = ThreadPoolExecutor(max_workers=2)

# Redis 客户端用于存储进度信息
_redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

# 同步时间范围（天）
SYNC_DAYS = 7


@celery_app.task(bind=True, name="ef.ozon.batch_finance_sync")
def batch_finance_sync_task(self):
    """
    批量财务费用同步任务（前端手动触发）
    
    查询所有已签收但 OZON 佣金为 0 的订单，调用财务交易 API 同步费用
    """
    task_id = self.request.id if self.request.id else "unknown"
    logger.info(f"Batch finance sync task started, task_id: {task_id}")

    # 初始化进度
    _update_progress(task_id, {
        "status": "running",
        "current": 0,
        "total": 0,
        "message": "正在查询需要同步的订单..."
    })

    def run_async_in_thread():
        """在新线程中运行异步代码，显式管理 event loop"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_batch_finance_sync_async(task_id))
        finally:
            loop.close()
            asyncio.set_event_loop(None)

    try:
        future = _thread_pool.submit(run_async_in_thread)
        result = future.result(timeout=7200)  # 2小时超时

        # 更新最终进度
        _update_progress(task_id, {
            "status": "completed",
            "current": result.get("updated", 0) + result.get("skipped", 0) + result.get("errors", 0),
            "total": result.get("total_found", 0),
            "message": result.get("message", "同步完成"),
            "result": result
        })

        return result
    except Exception as e:
        logger.error(f"Batch finance sync task execution error: {e}", exc_info=True)
        error_result = {
            "success": False,
            "error": str(e)
        }

        _update_progress(task_id, {
            "status": "failed",
            "message": f"同步失败: {str(e)}",
            "result": error_result
        })

        return error_result
    finally:
        # 释放 Redis 锁
        try:
            lock_key = "batch_finance_sync:lock"
            _redis_client.delete(lock_key)
            logger.info(f"Released lock: {lock_key}")
        except Exception as e:
            logger.error(f"Failed to release lock: {e}")


async def _batch_finance_sync_async(task_id: str) -> Dict[str, Any]:
    """
    批量财务同步的异步实现 - 使用基于日期的批量查询

    优化策略：
    1. 查询最近7天内签收的订单
    2. 按店铺分组，每个店铺只调用一次财务API（按日期范围）
    3. 在内存中按 posting_number 匹配
    4. 批量更新数据库

    Args:
        task_id: 任务ID

    Returns:
        同步结果统计
    """
    stats = {
        "total_found": 0,
        "processed": 0,
        "updated": 0,
        "skipped": 0,
        "errors": 0,
        "error_details": []
    }

    # 计算日期范围（最近7天）
    now = datetime.now(timezone.utc)
    date_from = now - timedelta(days=SYNC_DAYS)
    date_from_str = date_from.strftime("%Y-%m-%d")
    date_to_str = now.strftime("%Y-%m-%d")

    logger.info(f"Batch finance sync: date range {date_from_str} ~ {date_to_str}")

    # 在当前 event loop 中重新创建 db_manager（避免 loop 冲突）
    from ef_core.database import DatabaseManager
    db_manager = DatabaseManager()

    async with db_manager.get_session() as session:
        # 1. 查询最近7天内签收且未同步财务的订单
        postings_result = await session.execute(
            select(OzonPosting)
            .where(OzonPosting.status == 'delivered')
            .where(OzonPosting.delivered_at >= date_from)
            .where(OzonPosting.finance_synced_at == None)  # 只处理未同步的
            .where(OzonPosting.posting_number != None)
            .where(OzonPosting.posting_number != '')
            .order_by(OzonPosting.delivered_at.desc())
        )
        postings = postings_result.scalars().all()
        stats["total_found"] = len(postings)

        if not postings:
            logger.info(f"No postings need finance sync in the last {SYNC_DAYS} days")
            return {
                **stats,
                "success": True,
                "message": f"最近{SYNC_DAYS}天内没有需要同步的订单（已全部同步）"
            }

        logger.info(f"Found {len(postings)} postings delivered in the last {SYNC_DAYS} days")

        # 更新进度
        _update_progress(task_id, {
            "status": "running",
            "current": 0,
            "total": len(postings),
            "message": f"找到 {len(postings)} 个订单，正在批量查询财务数据..."
        })

        # 2. 按店铺分组
        postings_by_shop = defaultdict(list)
        for posting in postings:
            postings_by_shop[posting.shop_id].append(posting)

        logger.info(f"Grouped into {len(postings_by_shop)} shop(s)")

        # 3. 遍历每个店铺
        shop_index = 0
        for shop_id, shop_postings in postings_by_shop.items():
            shop_index += 1

            # 获取店铺配置
            shop_result = await session.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop_orm = shop_result.scalar_one_or_none()

            if not shop_orm:
                logger.error(f"Shop {shop_id} not found, skipping {len(shop_postings)} postings")
                stats["errors"] += len(shop_postings)
                for posting in shop_postings:
                    stats["error_details"].append({
                        "posting_number": posting.posting_number,
                        "error": f"店铺{shop_id}不存在"
                    })
                continue

            shop_name = shop_orm.shop_name
            client_id = shop_orm.client_id
            api_key_enc = shop_orm.api_key_enc

            logger.info(f"Processing shop {shop_index}/{len(postings_by_shop)}: {shop_name} ({len(shop_postings)} postings)")

            # 更新进度
            _update_progress(task_id, {
                "status": "running",
                "current": stats["processed"],
                "total": stats["total_found"],
                "message": f"正在查询店铺 {shop_name} 的财务数据..."
            })

            try:
                # 4. 创建 API 客户端
                async with OzonAPIClient(client_id, api_key_enc, shop_id=shop_id) as client:
                    # 5. 批量查询财务交易（按日期范围，一次性获取所有）
                    all_operations = []
                    page = 1
                    max_pages = 20  # 安全限制

                    while page <= max_pages:
                        logger.info(f"Fetching finance transactions page {page} for shop {shop_name}")
                        response = await client.get_finance_transaction_list(
                            date_from=date_from_str,
                            date_to=date_to_str,
                            transaction_type="all",
                            page=page,
                            page_size=1000
                        )

                        result = response.get("result", {})
                        operations = result.get("operations", [])
                        page_count = result.get("page_count", 1)

                        all_operations.extend(operations)
                        logger.info(f"Page {page}/{page_count}: fetched {len(operations)} operations, total: {len(all_operations)}")

                        if page >= page_count:
                            break
                        page += 1
                        await asyncio.sleep(1)  # 页间间隔1秒

                    logger.info(f"Total operations fetched for shop {shop_name}: {len(all_operations)}")

                    # 6. 按 posting_number 建立索引
                    operations_by_posting = defaultdict(list)
                    for op in all_operations:
                        pn = op.get("posting", {}).get("posting_number")
                        if pn:
                            operations_by_posting[pn].append(op)

                    logger.info(f"Indexed {len(operations_by_posting)} unique posting_numbers")

                    # 7. 匹配并更新每个 posting
                    for posting in shop_postings:
                        stats["processed"] += 1
                        posting_number = posting.posting_number

                        # 更新进度
                        _update_progress(task_id, {
                            "status": "running",
                            "current": stats["processed"],
                            "total": stats["total_found"],
                            "message": f"正在处理 {posting_number}..."
                        })

                        # 查找该 posting 的财务操作
                        operations = operations_by_posting.get(posting_number, [])

                        if not operations:
                            logger.debug(f"No finance transactions for {posting_number}")
                            stats["skipped"] += 1
                            continue

                        # 计算汇率
                        exchange_rate = _calculate_exchange_rate(posting, operations)

                        if exchange_rate is None or exchange_rate <= 0:
                            logger.debug(f"Invalid exchange rate for {posting_number}")
                            stats["skipped"] += 1
                            continue

                        # 提取并转换费用
                        fees = _extract_and_convert_fees(operations, exchange_rate)

                        # 更新 posting 记录
                        posting.last_mile_delivery_fee_cny = fees["last_mile_delivery"]

                        # 国际物流费用保护逻辑
                        if posting.international_logistics_fee_cny and posting.international_logistics_fee_cny != 0:
                            if fees["international_logistics"] == 0:
                                pass  # 保护现有值
                            else:
                                posting.international_logistics_fee_cny = fees["international_logistics"]
                        else:
                            posting.international_logistics_fee_cny = fees["international_logistics"]

                        # OZON 佣金（关键字段）
                        posting.ozon_commission_cny = fees["ozon_commission"]
                        posting.finance_synced_at = datetime.now(timezone.utc)

                        # 计算利润
                        _calculate_profit(posting)

                        stats["updated"] += 1

                    # 8. 批量提交该店铺的所有更新
                    await session.commit()
                    logger.info(f"Shop {shop_name}: committed updates")

            except Exception as e:
                logger.error(f"Error processing shop {shop_id}: {e}", exc_info=True)
                stats["errors"] += len(shop_postings)
                stats["error_details"].append({
                    "shop_id": shop_id,
                    "shop_name": shop_name,
                    "error": str(e)
                })
                await session.rollback()
                continue

            # 店铺间间隔2秒
            if shop_index < len(postings_by_shop):
                await asyncio.sleep(2)

    logger.info(f"Batch finance sync completed: {stats}")
    return {
        **stats,
        "success": True,
        "message": f"同步完成：处理 {stats['processed']} 个订单，更新 {stats['updated']} 个，跳过 {stats['skipped']} 个，错误 {stats['errors']} 个"
    }


def _calculate_exchange_rate(posting: OzonPosting, operations: list) -> float:
    """计算历史汇率（RUB -> CNY）- 不依赖 OzonOrder"""
    from decimal import Decimal, InvalidOperation

    # 方法1: 从 accruals_for_sale 提取汇率（首选）
    for op in operations:
        if op.get("operation_type") == "OperationAgentDeliveredToCustomer":
            services = op.get("services", [])
            for service in services:
                if service.get("name") == "MarketplaceServiceItemFulfillment":
                    price_rub = Decimal(str(service.get("price", 0)))
                    price_cny = Decimal(str(service.get("price_cny", 0)))
                    if price_rub > 0 and price_cny > 0:
                        return float(price_cny / price_rub)

    # 方法2: 默认汇率（order.total_price 实际为0，无法用于推算）
    return 0.073  # 默认汇率


def _extract_and_convert_fees(operations: list, exchange_rate: float) -> Dict[str, Decimal]:
    """提取并转换费用（RUB -> CNY）"""
    from decimal import Decimal

    fees = {
        "ozon_commission": Decimal('0'),
        "last_mile_delivery": Decimal('0'),
        "international_logistics": Decimal('0')
    }

    for op in operations:
        services = op.get("services", [])

        for service in services:
            service_name = service.get("name", "")
            price_rub = Decimal(str(service.get("price", 0)))

            # Ozon 佣金
            if service_name in ["MarketplaceServiceItemFulfillment", "MarketplaceServiceItemPickup"]:
                fees["ozon_commission"] += price_rub * Decimal(str(exchange_rate))

            # 尾程派送
            elif service_name in ["MarketplaceServiceItemDeliveryToCustomer"]:
                fees["last_mile_delivery"] += price_rub * Decimal(str(exchange_rate))

            # 国际物流
            elif service_name in ["MarketplaceServiceItemDirectFlowTrans"]:
                fees["international_logistics"] += price_rub * Decimal(str(exchange_rate))

    # 取绝对值（费用都是正数）
    for key in fees:
        fees[key] = abs(fees[key])

    return fees


def _calculate_profit(posting: OzonPosting) -> None:
    """计算利润 - 使用 posting.order_total_price，不依赖 OzonOrder"""
    from decimal import Decimal

    # 订单金额（取消订单不计销售额）- 使用 posting.order_total_price
    if posting.status == 'cancelled':
        order_amount = Decimal('0')
    else:
        order_amount = Decimal(str(posting.order_total_price or '0'))

    # 成本汇总
    purchase_price = posting.purchase_price or Decimal('0')
    ozon_commission = posting.ozon_commission_cny or Decimal('0')
    intl_logistics = posting.international_logistics_fee_cny or Decimal('0')
    last_mile = posting.last_mile_delivery_fee_cny or Decimal('0')
    material_cost = posting.material_cost or Decimal('0')

    # 利润
    profit = order_amount - (purchase_price + ozon_commission + intl_logistics + last_mile + material_cost)
    posting.profit = profit

    # 利润率
    if posting.status == 'cancelled':
        posting.profit_rate = Decimal('0')
    else:
        posting.profit_rate = (profit / order_amount * 100) if order_amount > 0 else Decimal('0')


def _update_progress(task_id: str, progress: Dict[str, Any]):
    """更新任务进度到 Redis"""
    try:
        key = f"batch_finance_sync:{task_id}"
        _redis_client.setex(key, 3600, str(progress))  # 1小时过期
    except Exception as e:
        logger.error(f"Failed to update progress: {e}")
