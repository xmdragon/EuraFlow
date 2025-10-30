"""
OZON财务费用自动同步服务
每小时15分运行一次，同步已签收订单（7天前-3个月内）
每5秒处理一个订单，避免API限流
"""
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ..models.orders import OzonPosting, OzonOrder
from ..models.ozon_shops import OzonShop
from ..models.sync_service import SyncServiceLog
from ..api.client import OzonAPIClient
import uuid

logger = logging.getLogger(__name__)


class OzonFinanceSyncService:
    """OZON财务费用自动同步服务"""

    def __init__(self):
        """初始化服务"""
        self.batch_size = 10  # 每次处理的订单数量

    async def sync_finance_costs(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步财务费用主流程

        Args:
            config: 服务配置
                - batch_size: 批次大小（默认10）

        Returns:
            同步结果统计
        """
        batch_size = config.get("batch_size", self.batch_size)

        logger.info(f"Starting finance cost sync, batch_size={batch_size}")

        stats = {
            "records_processed": 0,
            "records_updated": 0,
            "records_skipped": 0,
            "errors": [],
            "posting_numbers": []
        }

        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            # 1. 计算时间范围（7天前 - 3个月前）
            now = datetime.now(timezone.utc)
            three_months_ago = now - timedelta(days=90)
            seven_days_ago = now - timedelta(days=7)

            logger.info(f"Time range filter: {three_months_ago.isoformat()} ~ {seven_days_ago.isoformat()}")

            # 2. 查询需要同步的货件（已签收且未同步财务，时间范围：7天前-3个月内）
            postings_result = await session.execute(
                select(OzonPosting)
                .join(OzonOrder, OzonPosting.order_id == OzonOrder.id)
                .where(OzonPosting.status == 'delivered')
                .where(OzonPosting.finance_synced_at == None)
                .where(OzonPosting.posting_number != None)
                .where(OzonPosting.posting_number != '')
                .where(OzonOrder.ordered_at > three_months_ago)  # 3个月内
                .where(OzonOrder.ordered_at <= seven_days_ago)   # 7天前
                .order_by(OzonPosting.delivered_at.desc())
                # 移除 limit(batch_size) - 一次性获取所有符合条件的订单
            )
            postings = postings_result.scalars().all()

            if not postings:
                logger.info("No postings need finance sync in time range (7 days ago ~ 3 months ago)")
                return {
                    **stats,
                    "message": "没有需要同步财务费用的货件（时间范围：7天前-3个月内）"
                }

            logger.info(f"Found {len(postings)} postings to process (status=delivered, finance_synced_at IS NULL, time range OK)")

            # 立即提取所有posting信息到字典，避免懒加载
            postings_data = []
            for posting in postings:
                postings_data.append({
                    'id': posting.id,
                    'shop_id': posting.shop_id,
                    'posting_number': posting.posting_number
                })

            # 2. 按店铺分组postings
            from collections import defaultdict
            postings_by_shop = defaultdict(list)
            for posting_data in postings_data:
                postings_by_shop[posting_data['shop_id']].append(posting_data)

            logger.info(f"Postings grouped by {len(postings_by_shop)} shop(s)")

            # 3. 遍历每个店铺
            for shop_id, shop_postings in postings_by_shop.items():
                # 获取店铺配置
                shop_result = await session.execute(
                    select(OzonShop).where(OzonShop.id == shop_id)
                )
                shop_orm = shop_result.scalar_one_or_none()

                if not shop_orm:
                    logger.error(f"Shop {shop_id} not found, skipping {len(shop_postings)} postings")
                    for posting_data in shop_postings:
                        stats["errors"].append({
                            "posting_id": posting_data['id'],
                            "posting_number": posting_data['posting_number'],
                            "error": f"店铺{shop_id}不存在"
                        })
                    continue

                # 立即提取shop属性，避免懒加载
                shop_name = shop_orm.shop_name
                client_id = shop_orm.client_id
                api_key_enc = shop_orm.api_key_enc

                logger.info(f"Processing {len(shop_postings)} postings for shop: {shop_name} (ID: {shop_id})")

                # 4. 创建API客户端
                async with OzonAPIClient(client_id, api_key_enc, shop_id=shop_id) as client:
                    # 5. 循环处理该店铺的每个货件（每5秒处理一个）
                    for idx, posting_data in enumerate(shop_postings):
                        posting_id = posting_data['id']
                        posting_number = posting_data['posting_number']
                        logger.info(f"Processing posting {posting_id} ({idx+1}/{len(shop_postings)}) with posting_number: {posting_number}")
                        stats["records_processed"] += 1
                        stats["posting_numbers"].append(posting_number)

                        # 记录开始时间
                        started_at = datetime.now(timezone.utc)
                        run_id = f"ozon_finance_sync_{uuid.uuid4().hex[:12]}"

                        # 重新查询posting对象（因为需要更新它的属性）
                        posting_result = await session.execute(
                            select(OzonPosting).where(OzonPosting.id == posting_id)
                        )
                        posting = posting_result.scalar_one_or_none()

                        if not posting:
                            logger.error(f"Posting {posting_id} not found, skipping")
                            stats["records_skipped"] += 1
                            continue

                        try:
                            # 5. 调用财务交易API
                            logger.info(f"Fetching finance transactions for {posting_number}")
                            response = await client.get_finance_transaction_list(
                                posting_number=posting_number,
                                transaction_type="all",
                                page=1,
                                page_size=1000
                            )

                            result = response.get("result", {})
                            operations = result.get("operations", [])

                            if not operations:
                                logger.warning(f"No finance transactions found for {posting_number}")
                                stats["records_skipped"] += 1
                                await self._create_log(
                                    session, run_id, posting_number, posting_id,
                                    started_at, "skipped", "无财务交易记录"
                                )
                                continue

                            # 6. 计算历史汇率
                            exchange_rate = await self._calculate_exchange_rate(posting, operations)

                            if exchange_rate is None or exchange_rate <= 0:
                                logger.warning(f"Invalid exchange rate for {posting_number}, skipping")
                                stats["records_skipped"] += 1
                                await self._create_log(
                                    session, run_id, posting_number, posting_id,
                                    started_at, "skipped", "无法计算汇率"
                                )
                                continue

                            logger.info(f"Calculated exchange rate for {posting_number}: {exchange_rate:.6f}")

                            # 7. 提取并转换费用
                            fees = await self._extract_and_convert_fees(operations, exchange_rate)

                            # 8. 更新posting记录
                            posting.last_mile_delivery_fee_cny = fees["last_mile_delivery"]

                            # 国际物流费用：保护逻辑（如果数据库已有非0值，且新数据为0，则不更新）
                            if posting.international_logistics_fee_cny and posting.international_logistics_fee_cny != 0:
                                if fees["international_logistics"] == 0:
                                    logger.info(
                                        f"Skipping international_logistics_fee update for posting {posting.id}, "
                                        f"existing value {posting.international_logistics_fee_cny} is non-zero, new value is 0"
                                    )
                                else:
                                    posting.international_logistics_fee_cny = fees["international_logistics"]
                            else:
                                posting.international_logistics_fee_cny = fees["international_logistics"]

                            posting.ozon_commission_cny = fees["ozon_commission"]
                            posting.finance_synced_at = datetime.now(timezone.utc)

                            # 9. 计算并更新利润
                            from .profit_calculator import calculate_and_update_profit
                            await calculate_and_update_profit(session, posting)

                            await session.commit()

                            logger.info(
                                f"Updated finance costs for posting {posting_id}, "
                                f"posting_number={posting_number}, "
                                f"last_mile={fees['last_mile_delivery']}, "
                                f"intl_logistics={fees['international_logistics']}, "
                                f"commission={fees['ozon_commission']}"
                            )

                            stats["records_updated"] += 1
                            await self._create_log(
                                session, run_id, posting_number, posting_id,
                                started_at, "success", None
                            )

                        except Exception as e:
                            logger.error(f"Error syncing finance for posting {posting_id}: {e}", exc_info=True)

                            # 简化异常信息
                            error_str = str(e)
                            if "timeout" in error_str.lower():
                                error_message = "请求超时"
                            elif "connection" in error_str.lower():
                                error_message = "连接失败"
                            else:
                                error_message = error_str[:50]

                            stats["errors"].append({
                                "posting_id": posting_id,
                                "posting_number": posting_number,
                                "error": error_message
                            })

                            await self._create_log(
                                session, run_id, posting_number, posting_id,
                                started_at, "failed", error_message
                            )

                        # 每5秒处理一个（避免API限流）
                        # 如果不是最后一个，则等待5秒
                        if idx < len(shop_postings) - 1:
                            logger.info(f"Waiting 5 seconds before processing next posting...")
                            await asyncio.sleep(5)

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
        posting_id: int,
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
