"""
批量更新商品库存的后台任务
"""
import asyncio
import json
from typing import List, Dict, Any
import redis
from datetime import datetime

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# Redis客户端用于存储进度信息
_redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)


@celery_app.task(bind=True, name="ef.ozon.batch_update_stocks")
def batch_update_stocks_task(
    self,
    shop_id: int,
    updates: List[Dict[str, Any]]
):
    """
    批量更新商品库存（后台异步任务）

    Args:
        shop_id: 店铺ID
        updates: 更新列表，每项包含 {offer_id, stock, warehouse_id} 或 {apply_to_all, stock, warehouse_id}
    """
    task_id = self.request.id if self.request.id else "unknown"
    logger.info(f"批量库存更新任务启动 - Task ID: {task_id}, shop_id: {shop_id}, 更新数量: {len(updates)}")

    try:
        # 直接运行异步代码（与其他任务保持一致）
        result = asyncio.run(
            _batch_update_stocks_async(
                task_id,
                shop_id,
                updates
            )
        )
        return result
    except Exception as e:
        logger.error(f"批量库存更新任务执行错误: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


async def _batch_update_stocks_async(
    task_id: str,
    shop_id: int,
    updates: List[Dict[str, Any]]
):
    """异步批量更新库存（内部实现）"""
    from ..models.ozon_shops import OzonShop
    from ..models.products import OzonProduct
    from ..api.client import OzonAPIClient
    from sqlalchemy import select
    from fastapi import HTTPException

    try:
        # 使用全局数据库管理器的会话
        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.error(f"店铺 {shop_id} 不存在")
                return {
                    "success": False,
                    "error": f"店铺 {shop_id} 不存在"
                }

            updated_count = 0
            errors = []

            # 创建Ozon API客户端
            client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc
            )

            # Redis 进度 key
            progress_key = f"celery-task-progress:{task_id}"

            # 初始化进度
            _redis_client.setex(
                progress_key,
                3600,  # 1小时过期
                json.dumps({
                    'status': 'starting',
                    'updated': 0,
                    'total': 0,
                    'errors': [],
                    'current': '准备中...'
                })
            )

            # 检查是否需要对全部商品操作
            if len(updates) > 0 and updates[0].get("apply_to_all"):
                # 提取库存和仓库信息
                stock_value = updates[0].get("stock")
                warehouse_id_value = updates[0].get("warehouse_id")

                if stock_value is None or not warehouse_id_value:
                    return {
                        "success": False,
                        "error": "缺少库存数量或仓库ID"
                    }

                # 查询所有在售商品（必须有 offer_id 和 ozon_product_id）
                products_result = await db.execute(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.status == "on_sale",
                        OzonProduct.offer_id.isnot(None),
                        OzonProduct.ozon_product_id.isnot(None)
                    )
                )
                all_products = products_result.scalars().all()

                if not all_products:
                    return {
                        "success": False,
                        "error": "没有找到符合条件的在售商品（需要有货号和OZON产品ID）"
                    }

                # 重新构建 updates 数组
                updates = [
                    {
                        "offer_id": product.offer_id,
                        "stock": stock_value,
                        "warehouse_id": warehouse_id_value
                    }
                    for product in all_products
                ]

                logger.info(f"批量更新全部商品库存 - 店铺ID: {shop_id}, 商品数量: {len(updates)}, 目标库存: {stock_value}, 仓库ID: {warehouse_id_value}")

            # 更新总数
            _redis_client.setex(
                progress_key,
                3600,
                json.dumps({
                    'status': 'syncing',
                    'updated': 0,
                    'total': len(updates),
                    'errors': [],
                    'current': '开始更新...',
                    'percent': 0
                })
            )

            # 构建批量更新列表
            stock_items = []
            offer_id_to_product = {}  # 用于后续更新本地数据库

            for update in updates:
                offer_id = update.get("offer_id")
                stock = update.get("stock")
                warehouse_id = update.get("warehouse_id")

                # 明确验证：stock可以为0，但不能为None
                if not offer_id or stock is None or not warehouse_id:
                    errors.append(f"商品货号 {offer_id}: 缺少必要字段")
                    continue

                try:
                    # 查找本地商品（使用 offer_id）
                    product_result = await db.execute(
                        select(OzonProduct).where(
                            OzonProduct.shop_id == shop_id,
                            OzonProduct.offer_id == offer_id
                        )
                    )
                    product = product_result.scalar_one_or_none()

                    if not product:
                        errors.append(f"商品货号 {offer_id}: 商品不存在")
                        continue

                    # 检查必需字段
                    if not product.ozon_product_id:
                        errors.append(f"商品货号 {offer_id}: 缺少 OZON product_id，请先同步商品数据")
                        continue

                    # 添加到批量更新列表
                    stock_item = {
                        "offer_id": product.offer_id,
                        "product_id": product.ozon_product_id,
                        "stock": int(stock),
                        "warehouse_id": warehouse_id
                    }
                    stock_items.append(stock_item)
                    offer_id_to_product[offer_id] = (product, int(stock))

                except Exception as e:
                    errors.append(f"商品货号 {offer_id}: 准备数据失败 - {str(e)}")

            # 分批调用 OZON API（每批最多100个）
            BATCH_SIZE = 100
            total_batches = (len(stock_items) + BATCH_SIZE - 1) // BATCH_SIZE

            for batch_idx in range(0, len(stock_items), BATCH_SIZE):
                batch = stock_items[batch_idx:batch_idx + BATCH_SIZE]
                current_batch_num = (batch_idx // BATCH_SIZE) + 1

                # 更新进度
                _redis_client.setex(
                    progress_key,
                    3600,
                    json.dumps({
                        'status': 'syncing',
                        'updated': updated_count,
                        'total': len(stock_items),
                        'errors': errors[:10],  # 只保留前10个错误
                        'current': f'正在更新第 {current_batch_num}/{total_batches} 批...',
                        'percent': int((batch_idx / len(stock_items)) * 100) if len(stock_items) > 0 else 0
                    })
                )

                try:
                    # 批量调用 OZON API
                    api_result = await client.update_stocks(batch)

                    # 记录批量更新日志
                    logger.info(f"OZON API批量库存更新 - 批次 {current_batch_num}/{total_batches}, 大小: {len(batch)}")

                    # 处理批量响应结果
                    if api_result.get("result"):
                        for result_item in api_result["result"]:
                            item_offer_id = result_item.get("offer_id")

                            if not item_offer_id:
                                continue

                            # 检查 updated 字段确认是否成功
                            if result_item.get("updated") is True:
                                # 更新本地数据库
                                if item_offer_id in offer_id_to_product:
                                    product, stock_value = offer_id_to_product[item_offer_id]
                                    product.stock = stock_value
                                    product.available = stock_value
                                    product.updated_at = datetime.now()
                                    updated_count += 1
                            else:
                                # 提取错误信息
                                error_msgs = []
                                if result_item.get("errors"):
                                    for err in result_item["errors"]:
                                        error_msgs.append(f"{err.get('code', 'UNKNOWN')}: {err.get('message', '未知错误')}")
                                error_detail = "; ".join(error_msgs) if error_msgs else "更新失败"
                                errors.append(f"商品货号 {item_offer_id}: {error_detail}")
                    else:
                        errors.append(f"批次 {current_batch_num} 更新失败: API返回结果为空")

                except Exception as e:
                    logger.error(f"批量库存更新失败 - 批次 {current_batch_num}, 错误: {str(e)}")
                    errors.append(f"批次 {current_batch_num} 更新异常: {str(e)}")

            # 提交数据库事务
            await db.commit()

            # 关闭API客户端
            await client.close()

            # 判断整体成功标志
            success = updated_count > 0 or len(errors) == 0

            # 更新最终进度
            _redis_client.setex(
                progress_key,
                3600,
                json.dumps({
                    'status': 'completed' if success else 'failed',
                    'updated': updated_count,
                    'total': len(stock_items),
                    'errors': errors[:20],  # 最多保留20个错误
                    'current': '完成',
                    'percent': 100
                })
            )

            result = {
                "success": success,
                "message": f"成功更新 {updated_count} 个商品库存",
                "updated_count": updated_count
            }

            if len(errors) > 0:
                result["errors"] = errors[:20]  # 最多返回20个错误
                result["total_errors"] = len(errors)

            logger.info(f"批量库存更新任务完成: {result}")
            return result

    except Exception as e:
        logger.error(f"批量库存更新任务失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }
