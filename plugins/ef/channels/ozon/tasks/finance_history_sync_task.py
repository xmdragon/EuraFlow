"""
财务交易历史数据同步任务
前端手动触发，按月份范围同步历史财务交易数据
"""
import asyncio
import logging
import json
from typing import Dict, Any
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import redis

from ef_core.tasks.celery_app import celery_app
from ef_core.database import DatabaseManager
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..models.orders import OzonPosting
from ..models.ozon_shops import OzonShop
from ..models.finance import OzonFinanceTransaction, OzonFinanceSyncWatermark
from ..api.client import OzonAPIClient
from ..services.finance_translations import translate_operation_type_name

logger = logging.getLogger(__name__)

# 创建线程池用于运行异步任务
_thread_pool = ThreadPoolExecutor(max_workers=2)

# Redis 客户端用于存储进度信息
_redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)


@celery_app.task(bind=True, name="ef.ozon.finance_history_sync")
def finance_history_sync_task(self, date_from: str, date_to: str, shop_id: int = None):
    """
    财务交易历史数据同步任务（前端手动触发）

    Args:
        date_from: 开始日期 (YYYY-MM-DD)
        date_to: 结束日期 (YYYY-MM-DD)
        shop_id: 店铺ID（可选，不传时同步所有店铺）
    """
    task_id = self.request.id if self.request.id else "unknown"
    logger.info(f"Finance history sync task started, task_id: {task_id}, range: {date_from} ~ {date_to}")

    # 初始化进度
    _update_progress(task_id, {
        "status": "running",
        "current": 0,
        "total": 0,
        "message": "正在初始化同步任务...",
        "date_from": date_from,
        "date_to": date_to
    })

    def run_async_in_thread():
        """在新线程中运行异步代码"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                _finance_history_sync_async(task_id, date_from, date_to, shop_id)
            )
        finally:
            loop.close()
            asyncio.set_event_loop(None)

    try:
        future = _thread_pool.submit(run_async_in_thread)
        result = future.result(timeout=7200)  # 2小时超时

        # 更新最终进度
        _update_progress(task_id, {
            "status": "completed",
            "current": result.get("synced", 0),
            "total": result.get("synced", 0),
            "message": result.get("message", "同步完成"),
            "result": result
        })

        return result
    except Exception as e:
        logger.error(f"Finance history sync task execution error: {e}", exc_info=True)
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


async def _finance_history_sync_async(
    task_id: str,
    date_from: str,
    date_to: str,
    shop_id: int = None
) -> Dict[str, Any]:
    """
    历史财务同步的异步实现

    Args:
        task_id: 任务ID
        date_from: 开始日期 (YYYY-MM-DD)
        date_to: 结束日期 (YYYY-MM-DD)
        shop_id: 店铺ID（可选）

    Returns:
        同步结果统计
    """
    stats = {
        "total_days": 0,
        "processed_days": 0,
        "synced": 0,
        "skipped": 0,
        "errors": 0,
        "shops_processed": []
    }

    # 解析日期范围
    try:
        start_date = datetime.strptime(date_from, "%Y-%m-%d").date()
        end_date = datetime.strptime(date_to, "%Y-%m-%d").date()
    except ValueError as e:
        return {"success": False, "error": f"日期格式错误: {e}"}

    # 计算总天数
    total_days = (end_date - start_date).days + 1
    stats["total_days"] = total_days

    logger.info(f"Finance history sync: {date_from} ~ {date_to}, total {total_days} days")

    # 更新进度
    _update_progress(task_id, {
        "status": "running",
        "current": 0,
        "total": total_days,
        "message": f"准备同步 {total_days} 天的数据..."
    })

    # 创建数据库管理器
    db_manager = DatabaseManager()

    async with db_manager.get_session() as session:
        # 获取要同步的店铺列表
        if shop_id:
            result = await session.execute(
                select(OzonShop).where(
                    OzonShop.id == shop_id,
                    OzonShop.status == "active"
                )
            )
            shops = result.scalars().all()
        else:
            result = await session.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops = result.scalars().all()

        if not shops:
            return {"success": False, "error": "没有找到可用的店铺"}

        logger.info(f"Found {len(shops)} shop(s) to sync")

        # 遍历每个店铺
        for shop_idx, shop in enumerate(shops):
            shop_stats = {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "synced": 0,
                "errors": 0
            }

            logger.info(f"Processing shop {shop_idx + 1}/{len(shops)}: {shop.shop_name}")

            try:
                # 创建 API 客户端
                client = OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc,
                    shop_id=shop.id
                )

                try:
                    # 按日期逐天同步
                    current_date = start_date

                    while current_date <= end_date:
                        stats["processed_days"] += 1
                        date_str = current_date.strftime("%Y-%m-%d")

                        # 更新进度
                        _update_progress(task_id, {
                            "status": "running",
                            "current": stats["processed_days"],
                            "total": total_days * len(shops),
                            "message": f"正在同步 {shop.shop_name} - {date_str}...",
                            "progress": round(stats["processed_days"] / (total_days * len(shops)) * 100, 1)
                        })

                        try:
                            # 同步该日期的数据
                            day_synced = await _sync_date_transactions(
                                session, client, shop.id, current_date
                            )
                            stats["synced"] += day_synced
                            shop_stats["synced"] += day_synced

                            logger.debug(f"Synced {date_str} for {shop.shop_name}: {day_synced} records")

                        except Exception as e:
                            logger.error(f"Error syncing {date_str} for {shop.shop_name}: {e}")
                            stats["errors"] += 1
                            shop_stats["errors"] += 1

                        current_date += timedelta(days=1)

                        # 每天之间稍微间隔，避免 API 限流
                        await asyncio.sleep(0.5)

                finally:
                    await client.close()

            except Exception as e:
                logger.error(f"Error processing shop {shop.shop_name}: {e}", exc_info=True)
                shop_stats["errors"] += 1
                stats["errors"] += 1

            stats["shops_processed"].append(shop_stats)

            # 店铺间间隔
            if shop_idx < len(shops) - 1:
                await asyncio.sleep(1)

    # 生成汇总消息
    message = f"同步完成: {len(shops)} 个店铺, {total_days} 天, 共 {stats['synced']} 条记录"
    if stats["errors"] > 0:
        message += f", {stats['errors']} 个错误"

    logger.info(f"Finance history sync completed: {stats}")

    return {
        **stats,
        "success": True,
        "message": message,
        "date_from": date_from,
        "date_to": date_to
    }


async def _sync_date_transactions(
    session,
    client: OzonAPIClient,
    shop_id: int,
    target_date: datetime
) -> int:
    """
    同步指定日期的财务交易数据

    Args:
        session: 数据库会话
        client: OZON API 客户端
        shop_id: 店铺ID
        target_date: 目标日期

    Returns:
        新增的记录数
    """
    # 构建日期范围
    date_from = f"{target_date.isoformat()}T00:00:00Z"
    date_to = f"{target_date.isoformat()}T23:59:59Z"

    # 分页获取所有交易数据
    page = 1
    total_synced = 0

    while True:
        # 调用 OZON API
        result = await client.get_finance_transaction_list(
            date_from=date_from,
            date_to=date_to,
            transaction_type="all",
            page=page,
            page_size=1000
        )

        operations = result.get("result", {}).get("operations", [])

        if not operations:
            break

        # 扁平化并保存交易记录
        flattened = _flatten_operations(operations, shop_id)
        synced_count = await _save_transactions(session, flattened)

        total_synced += synced_count

        # 检查是否还有下一页
        page_count = result.get("result", {}).get("page_count", 0)
        if page >= page_count:
            break

        page += 1
        await asyncio.sleep(0.3)  # 页间间隔

    return total_synced


def _flatten_operations(operations: list, shop_id: int) -> list:
    """将 OZON 返回的 operations 数组扁平化为数据库记录"""
    flattened = []

    for op in operations:
        operation_id = op.get("operation_id")
        operation_type = op.get("operation_type", "")
        operation_type_name = op.get("operation_type_name", "")
        operation_date_str = op.get("operation_date", "")
        transaction_type = op.get("type", "all")

        # 解析操作日期
        try:
            operation_date = datetime.fromisoformat(operation_date_str.replace("Z", "+00:00"))
        except:
            operation_date = datetime.now(timezone.utc)

        # 提取 posting 信息
        posting = op.get("posting", {})

        if isinstance(posting, str):
            posting_number = posting
            posting_delivery_schema = None
            posting_warehouse_name = None
        elif isinstance(posting, dict):
            posting_number = posting.get("posting_number")
            posting_delivery_schema = posting.get("delivery_schema", {}).get("name") if isinstance(posting.get("delivery_schema"), dict) else None
            posting_warehouse_name = posting.get("warehouse_name")
        else:
            posting_number = None
            posting_delivery_schema = None
            posting_warehouse_name = None

        # 提取金额字段
        accruals_for_sale = Decimal(str(op.get("accruals_for_sale", 0)))
        amount = Decimal(str(op.get("amount", 0)))
        delivery_charge = Decimal(str(op.get("delivery_charge", 0)))
        return_delivery_charge = Decimal(str(op.get("return_delivery_charge", 0)))
        sale_commission = Decimal(str(op.get("sale_commission", 0)))

        # 提取 items 和 services
        items = op.get("items", [])
        services = op.get("services", [])

        if items:
            for item in items:
                record = {
                    "shop_id": shop_id,
                    "operation_id": operation_id,
                    "operation_type": operation_type,
                    "operation_type_name": translate_operation_type_name(operation_type_name),
                    "transaction_type": transaction_type,
                    "posting_number": posting_number,
                    "operation_date": operation_date,
                    "accruals_for_sale": accruals_for_sale,
                    "amount": amount,
                    "delivery_charge": delivery_charge,
                    "return_delivery_charge": return_delivery_charge,
                    "sale_commission": sale_commission,
                    "ozon_sku": str(item.get("sku")) if item.get("sku") is not None else None,
                    "item_name": item.get("name"),
                    "item_quantity": item.get("quantity"),
                    "item_price": Decimal(str(item.get("price", 0))) if item.get("price") else None,
                    "posting_delivery_schema": posting_delivery_schema,
                    "posting_warehouse_name": posting_warehouse_name,
                    "services_json": services,
                    "raw_data": op,
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                }
                flattened.append(record)
        else:
            record = {
                "shop_id": shop_id,
                "operation_id": operation_id,
                "operation_type": operation_type,
                "operation_type_name": translate_operation_type_name(operation_type_name),
                "transaction_type": transaction_type,
                "posting_number": posting_number,
                "operation_date": operation_date,
                "accruals_for_sale": accruals_for_sale,
                "amount": amount,
                "delivery_charge": delivery_charge,
                "return_delivery_charge": return_delivery_charge,
                "sale_commission": sale_commission,
                "ozon_sku": None,
                "item_name": None,
                "item_quantity": None,
                "item_price": None,
                "posting_delivery_schema": posting_delivery_schema,
                "posting_warehouse_name": posting_warehouse_name,
                "services_json": services,
                "raw_data": op,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            flattened.append(record)

    return flattened


async def _save_transactions(session, records: list) -> int:
    """批量保存交易记录（去重）"""
    saved_count = 0

    for record in records:
        try:
            # 检查是否已存在
            existing = await session.execute(
                select(OzonFinanceTransaction).where(
                    OzonFinanceTransaction.shop_id == record["shop_id"],
                    OzonFinanceTransaction.operation_id == record["operation_id"],
                    OzonFinanceTransaction.ozon_sku == record.get("ozon_sku")
                )
            )

            if existing.scalar_one_or_none():
                continue

            # 创建新记录
            transaction = OzonFinanceTransaction(**record)
            session.add(transaction)
            await session.commit()
            saved_count += 1

        except IntegrityError:
            await session.rollback()
            continue
        except Exception as e:
            logger.error(f"保存交易记录失败: {e}")
            await session.rollback()
            continue

    return saved_count


def _update_progress(task_id: str, progress: Dict[str, Any]):
    """更新任务进度到 Redis"""
    try:
        key = f"finance_history_sync:{task_id}"
        _redis_client.setex(key, 3600, json.dumps(progress, default=str))
    except Exception as e:
        logger.error(f"Failed to update progress: {e}")


def get_task_progress(task_id: str) -> Dict[str, Any]:
    """获取任务进度"""
    try:
        key = f"finance_history_sync:{task_id}"
        data = _redis_client.get(key)
        if data:
            return json.loads(data)
        return {"status": "unknown", "message": "任务不存在或已过期"}
    except Exception as e:
        logger.error(f"Failed to get progress: {e}")
        return {"status": "error", "message": str(e)}
