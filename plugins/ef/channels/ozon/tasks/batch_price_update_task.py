"""
批量更新商品价格的后台任务
"""
import asyncio
import json
from typing import List, Dict, Any
import redis
from datetime import datetime
from decimal import Decimal

from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# Redis客户端用于存储进度信息
_redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)


@celery_app.task(bind=True, name="ef.ozon.batch_update_prices")
def batch_update_prices_task(
    self,
    shop_id: int,
    updates: List[Dict[str, Any]]
):
    """
    批量更新商品价格（后台异步任务）

    Args:
        shop_id: 店铺ID
        updates: 更新列表，每项包含 {offer_id, price, old_price}
    """
    task_id = self.request.id if self.request.id else "unknown"
    logger.info(f"批量价格更新任务启动 - Task ID: {task_id}, shop_id: {shop_id}, 更新数量: {len(updates)}")

    try:
        # 直接运行异步代码（与其他任务保持一致）
        result = asyncio.run(
            _batch_update_prices_async(
                task_id,
                shop_id,
                updates
            )
        )
        return result
    except Exception as e:
        logger.error(f"批量价格更新任务执行错误: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


async def _batch_update_prices_async(
    task_id: str,
    shop_id: int,
    updates: List[Dict[str, Any]]
):
    """异步批量更新价格（内部实现）"""
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
                    'total': len(updates),
                    'errors': [],
                    'current': '准备中...',
                    'percent': 0
                })
            )

            # 获取汇率服务用于折扣验证
            from ef_core.services.exchange_rate_service import ExchangeRateService
            exchange_service = ExchangeRateService()

            try:
                cny_to_rub_rate = await exchange_service.get_rate(db, "CNY", "RUB")
            except Exception as e:
                logger.warning(f"无法获取汇率: {e}")
                cny_to_rub_rate = None

            # 逐个处理商品（价格更新不支持批量API）
            for idx, update in enumerate(updates):
                offer_id = update.get("offer_id")
                new_price = update.get("price")
                old_price = update.get("old_price")

                # 更新进度
                _redis_client.setex(
                    progress_key,
                    3600,
                    json.dumps({
                        'status': 'syncing',
                        'updated': updated_count,
                        'total': len(updates),
                        'errors': errors[:10],
                        'current': f'正在更新商品 {idx + 1}/{len(updates)}...',
                        'percent': int(((idx + 1) / len(updates)) * 100)
                    })
                )

                if not offer_id or new_price is None:
                    errors.append(f"商品货号 {offer_id}: 缺少必要字段")
                    continue

                try:
                    # 查找本地商品
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

                    # 使用商品本身的货币代码
                    currency_code = product.currency_code or "CNY"

                    # 转换价格为Decimal
                    new_price_decimal = Decimal(str(new_price))
                    old_price_decimal = Decimal(str(old_price)) if old_price else None

                    # OZON折扣规则验证（仅当old_price>0时）
                    if cny_to_rub_rate and old_price_decimal and old_price_decimal > 0 and new_price_decimal:
                        price_rub = new_price_decimal * cny_to_rub_rate
                        old_price_rub = old_price_decimal * cny_to_rub_rate
                        discount_amount_rub = old_price_rub - price_rub

                        # 规则1: price < 400 RUB → 差额至少20 RUB
                        if price_rub < 400:
                            if discount_amount_rub < 20:
                                discount_amount_cny = old_price_decimal - new_price_decimal
                                min_discount_cny = Decimal("20") / cny_to_rub_rate
                                errors.append(
                                    f"商品货号 {offer_id}: 价格低于400₽时，折扣差额必须≥20₽（约{min_discount_cny:.2f}￥）"
                                    f"（当前差额：{discount_amount_cny:.2f}￥）"
                                )
                                continue
                        # 规则2: 400 <= price <= 10000 RUB → 折扣至少5%
                        elif price_rub <= 10000:
                            discount_percent = (discount_amount_rub / old_price_rub) * 100
                            if discount_percent < 5:
                                errors.append(
                                    f"商品货号 {offer_id}: 价格在400-10000₽时，折扣必须≥5%"
                                    f"（当前折扣：{discount_percent:.1f}%）"
                                )
                                continue
                        # 规则3: price > 10000 RUB → 差额至少500 RUB
                        else:
                            if discount_amount_rub < 500:
                                discount_amount_cny = old_price_decimal - new_price_decimal
                                min_discount_cny = Decimal("500") / cny_to_rub_rate
                                errors.append(
                                    f"商品货号 {offer_id}: 价格高于10000₽时，折扣差额必须≥500₽（约{min_discount_cny:.2f}￥）"
                                    f"（当前差额：{discount_amount_cny:.2f}￥）"
                                )
                                continue

                    # 调用Ozon API更新价格
                    price_item = {
                        "offer_id": product.offer_id,
                        "product_id": product.ozon_product_id,
                        "price": str(new_price),
                        "currency_code": currency_code,
                        "auto_action_enabled": "DISABLED",
                        "price_strategy_enabled": "DISABLED"
                    }

                    if old_price:
                        price_item["old_price"] = str(old_price)

                    # 调用API（传递列表）
                    api_result = await client.update_prices([price_item])

                    logger.info(f"OZON API价格更新响应 - 商品货号: {offer_id}, 响应: {api_result}")

                    # 检查API返回结果
                    if api_result.get("result") and len(api_result["result"]) > 0:
                        result_item = api_result["result"][0]

                        if result_item.get("updated") is True:
                            # 更新本地数据库
                            product.price = Decimal(str(new_price))
                            if old_price:
                                product.old_price = Decimal(str(old_price))
                            product.updated_at = datetime.now()
                            updated_count += 1
                        else:
                            # 提取错误信息
                            error_msgs = []
                            if result_item.get("errors"):
                                for err in result_item["errors"]:
                                    error_msgs.append(f"{err.get('code', 'UNKNOWN')}: {err.get('message', '未知错误')}")
                            error_detail = "; ".join(error_msgs) if error_msgs else "更新失败"
                            errors.append(f"商品货号 {offer_id}: {error_detail}")
                    else:
                        errors.append(f"商品货号 {offer_id}: API返回结果为空")

                except Exception as e:
                    logger.error(f"价格更新失败 - 商品货号 {offer_id}, 错误: {str(e)}")
                    errors.append(f"商品货号 {offer_id}: {str(e)}")

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
                    'total': len(updates),
                    'errors': errors[:20],
                    'current': '完成',
                    'percent': 100
                })
            )

            result = {
                "success": success,
                "message": f"成功更新 {updated_count} 个商品价格",
                "updated_count": updated_count
            }

            if len(errors) > 0:
                result["errors"] = errors[:20]
                result["total_errors"] = len(errors)

            logger.info(f"批量价格更新任务完成: {result}")
            return result

    except Exception as e:
        logger.error(f"批量价格更新任务失败: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }
