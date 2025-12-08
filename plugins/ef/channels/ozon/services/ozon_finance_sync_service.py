"""
OZON财务费用自动同步服务
每小时运行一次，同步最近7天内签收的订单
使用基于日期的批量查询方式，大幅提升性能
"""
import logging
import asyncio
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_task_db_manager
from ..models.orders import OzonPosting
from ..models.ozon_shops import OzonShop
from ..models.sync_service import SyncServiceLog
from ..api.client import OzonAPIClient
import uuid

logger = logging.getLogger(__name__)

# 同步时间范围（天）
SYNC_DAYS = 7


class OzonFinanceSyncService:
    """OZON财务费用自动同步服务"""

    def __init__(self):
        """初始化服务"""
        self.batch_size = 10  # 每次处理的订单数量

    async def sync_finance_costs(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步财务费用主流程 - 使用基于日期的批量查询

        优化策略：
        1. 查询最近7天内签收的订单
        2. 按店铺分组，每个店铺只调用一次财务API（按日期范围）
        3. 在内存中按 posting_number 匹配
        4. 批量更新数据库

        Args:
            config: 服务配置

        Returns:
            同步结果统计
        """
        logger.info("Starting finance cost sync with batch query mode")

        stats = {
            "records_processed": 0,
            "records_updated": 0,
            "records_skipped": 0,
            "errors": [],
            "posting_numbers": []
        }

        # 计算日期范围（最近7天）
        now = datetime.now(timezone.utc)
        date_from = now - timedelta(days=SYNC_DAYS)
        date_from_str = date_from.strftime("%Y-%m-%d")
        date_to_str = now.strftime("%Y-%m-%d")

        logger.info(f"Finance sync: date range {date_from_str} ~ {date_to_str}")

        db_manager = get_task_db_manager()
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

            if not postings:
                logger.info(f"No postings need finance sync in the last {SYNC_DAYS} days")
                return {
                    **stats,
                    "message": f"最近{SYNC_DAYS}天内没有需要同步的订单（已全部同步）"
                }

            logger.info(f"Found {len(postings)} postings delivered in the last {SYNC_DAYS} days")

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
                    for posting in shop_postings:
                        stats["errors"].append({
                            "posting_id": posting.id,
                            "posting_number": posting.posting_number,
                            "error": f"店铺{shop_id}不存在"
                        })
                    continue

                shop_name = shop_orm.shop_name
                client_id = shop_orm.client_id
                api_key_enc = shop_orm.api_key_enc

                logger.info(f"Processing shop {shop_index}/{len(postings_by_shop)}: {shop_name} ({len(shop_postings)} postings)")

                # 记录开始时间
                started_at = datetime.now(timezone.utc)
                run_id = f"ozon_finance_sync_{uuid.uuid4().hex[:12]}"

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
                            stats["records_processed"] += 1
                            posting_number = posting.posting_number
                            stats["posting_numbers"].append(posting_number)

                            # 查找该 posting 的财务操作
                            operations = operations_by_posting.get(posting_number, [])

                            if not operations:
                                logger.debug(f"No finance transactions for {posting_number}")
                                stats["records_skipped"] += 1
                                continue

                            # 计算汇率
                            exchange_rate = await self._calculate_exchange_rate(posting, operations)

                            if exchange_rate is None or exchange_rate <= 0:
                                logger.debug(f"Invalid exchange rate for {posting_number}")
                                stats["records_skipped"] += 1
                                continue

                            # 提取并转换费用
                            fees = await self._extract_and_convert_fees(operations, exchange_rate)

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

                            # OZON 佣金
                            posting.ozon_commission_cny = fees["ozon_commission"]
                            posting.finance_synced_at = datetime.now(timezone.utc)

                            # 计算利润
                            from .profit_calculator import calculate_and_update_profit
                            calculate_and_update_profit(posting)

                            stats["records_updated"] += 1

                        # 8. 批量提交该店铺的所有更新
                        await session.commit()
                        logger.info(f"Shop {shop_name}: committed {stats['records_updated']} updates")

                        # 记录成功日志
                        await self._create_log(
                            session, run_id, f"shop_{shop_id}", None,
                            started_at, "success", None
                        )

                except Exception as e:
                    logger.error(f"Error processing shop {shop_id}: {e}", exc_info=True)

                    error_str = str(e)
                    if "timeout" in error_str.lower():
                        error_message = "请求超时"
                    elif "connection" in error_str.lower():
                        error_message = "连接失败"
                    else:
                        error_message = error_str[:50]

                    for posting in shop_postings:
                        stats["errors"].append({
                            "posting_id": posting.id,
                            "posting_number": posting.posting_number,
                            "error": error_message
                        })

                    await self._create_log(
                        session, run_id, f"shop_{shop_id}", None,
                        started_at, "failed", error_message
                    )
                    continue

                # 店铺间间隔2秒
                if shop_index < len(postings_by_shop):
                    await asyncio.sleep(2)

        logger.info(
            f"Finance cost sync completed: "
            f"processed={stats['records_processed']}, "
            f"updated={stats['records_updated']}, "
            f"skipped={stats['records_skipped']}, "
            f"errors={len(stats['errors'])}"
        )

        # 生成结果消息
        if stats["records_updated"] > 0:
            message = f"成功更新{stats['records_updated']}条订单财务费用"
        elif stats["records_skipped"] > 0:
            message = f"处理了{stats['records_processed']}条订单，但没有更新（无财务数据或无法计算汇率）"
        elif len(stats["errors"]) > 0:
            message = f"处理失败，共{len(stats['errors'])}个错误"
        else:
            message = "没有需要同步的订单"

        return {
            **stats,
            "message": message
        }

    async def _calculate_exchange_rate(
        self,
        posting: OzonPosting,
        operations: list
    ) -> Decimal | None:
        """
        计算历史汇率 = 商品总价(CNY) / 商品成本(RUB)

        Args:
            posting: 货件对象
            operations: 财务交易操作列表

        Returns:
            汇率（Decimal），如果无法计算则返回None
        """
        try:
            # 1. 从 raw_payload 获取商品总价（CNY）
            if not posting.raw_payload or 'products' not in posting.raw_payload:
                logger.warning(f"Posting {posting.id} has no product data in raw_payload")
                return None

            products = posting.raw_payload.get('products', [])
            if not products:
                logger.warning(f"Posting {posting.id} has empty products list")
                return None

            total_price_cny = Decimal('0')
            for product in products:
                price = Decimal(str(product.get('price', '0')))
                quantity = product.get('quantity', 0)
                total_price_cny += price * quantity

            if total_price_cny <= 0:
                logger.warning(f"Posting {posting.id} has zero or negative total price CNY: {total_price_cny}")
                return None

            # 2. 从财务API获取商品成本（RUB）
            total_cost_rub = Decimal('0')
            for op in operations:
                accruals = op.get('accruals_for_sale', 0)
                if accruals and accruals > 0:
                    total_cost_rub += Decimal(str(accruals))

            if total_cost_rub <= 0:
                logger.warning(f"Posting {posting.id} has zero or negative total cost RUB: {total_cost_rub}")
                return None

            # 3. 计算汇率
            exchange_rate = total_price_cny / total_cost_rub
            return exchange_rate

        except (InvalidOperation, ValueError, ZeroDivisionError) as e:
            logger.error(f"Error calculating exchange rate for posting {posting.id}: {e}")
            return None

    async def _extract_and_convert_fees(
        self,
        operations: list,
        exchange_rate: Decimal
    ) -> Dict[str, Decimal]:
        """
        提取财务费用并转换为CNY

        Args:
            operations: 财务交易操作列表
            exchange_rate: 汇率

        Returns:
            费用字典：
            {
                "last_mile_delivery": Decimal,  # 尾程派送费(CNY)
                "international_logistics": Decimal,  # 国际物流费(CNY)
                "ozon_commission": Decimal  # Ozon佣金(CNY)
            }
        """
        fees = {
            "last_mile_delivery": Decimal('0'),
            "international_logistics": Decimal('0'),
            "ozon_commission": Decimal('0')
        }

        try:
            for op in operations:
                operation_type = op.get('operation_type', '')
                amount = Decimal(str(op.get('amount', 0)))

                # 尾程派送：国际运输代理费
                if 'AgencyFeeAggregator3PLGlobal' in operation_type or \
                   'OperationMarketplaceAgencyFeeAggregator3PLGlobal' in operation_type:
                    fee_rub = abs(amount)
                    fees["last_mile_delivery"] += fee_rub * exchange_rate

                # 国际物流：配送服务费转移
                elif 'RedistributionOfDeliveryServices' in operation_type or \
                     'MarketplaceRedistributionOfDeliveryServicesOperation' in operation_type:
                    fee_rub = abs(amount)
                    fees["international_logistics"] += fee_rub * exchange_rate

                # Ozon佣金
                sale_commission = Decimal(str(op.get('sale_commission', 0)))
                if sale_commission < 0:
                    commission_rub = abs(sale_commission)
                    fees["ozon_commission"] += commission_rub * exchange_rate

            # 保留2位小数
            fees["last_mile_delivery"] = fees["last_mile_delivery"].quantize(Decimal('0.01'))
            fees["international_logistics"] = fees["international_logistics"].quantize(Decimal('0.01'))
            fees["ozon_commission"] = fees["ozon_commission"].quantize(Decimal('0.01'))

        except (InvalidOperation, ValueError) as e:
            logger.error(f"Error extracting and converting fees: {e}")

        return fees

    async def _create_log(
        self,
        session: AsyncSession,
        run_id: str,
        posting_number: str,
        posting_id: int | None,
        started_at: datetime,
        status: str,
        error_message: str | None
    ) -> None:
        """创建同步日志记录"""
        try:
            finished_at = datetime.now(timezone.utc)
            execution_time_ms = int((finished_at - started_at).total_seconds() * 1000)

            sync_log = SyncServiceLog(
                service_key="ozon_finance_sync",
                run_id=run_id,
                started_at=started_at,
                finished_at=finished_at,
                status=status,
                records_processed=1,
                records_updated=1 if status == "success" else 0,
                execution_time_ms=execution_time_ms,
                error_message=error_message,
                extra_data={
                    "posting_number": posting_number,
                    "posting_id": posting_id
                }
            )
            session.add(sync_log)
            await session.commit()
            logger.info(f"Created log for posting_number={posting_number}, status={status}")

        except Exception as e:
            logger.error(f"Failed to create sync log: {e}")


# 全局单例
_service_instance = None


def get_ozon_finance_sync_service() -> OzonFinanceSyncService:
    """获取服务实例"""
    global _service_instance
    if _service_instance is None:
        _service_instance = OzonFinanceSyncService()
    return _service_instance
