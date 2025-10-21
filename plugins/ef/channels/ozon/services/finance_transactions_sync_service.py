"""
OZON 财务交易数据同步服务
"""
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ef_core.database import get_db_manager
from ..models import OzonShop
from ..models.finance import OzonFinanceTransaction, OzonFinanceSyncWatermark
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)


class FinanceTransactionsSyncService:
    """财务交易数据同步服务"""

    def __init__(self):
        self.db_manager = get_db_manager()

    async def sync_transactions(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步财务交易数据（定时任务处理函数）

        Args:
            config: 配置参数
                - target_date: 目标日期（可选，默认为昨天）
                - shop_id: 店铺ID（可选，默认所有活跃店铺）

        Returns:
            同步结果
        """
        # 获取目标日期（默认为昨天）
        target_date_str = config.get("target_date")
        if target_date_str:
            target_date = datetime.fromisoformat(target_date_str).date()
        else:
            # 默认同步昨天的数据
            target_date = (datetime.now(timezone.utc) - timedelta(days=1)).date()

        logger.info(f"开始同步财务交易数据，目标日期：{target_date}")

        total_processed = 0
        total_synced = 0
        shops_synced = []

        async with self.db_manager.get_session() as db:
            # 获取要同步的店铺列表
            shop_id = config.get("shop_id")
            if shop_id:
                # 同步指定店铺
                result = await db.execute(
                    select(OzonShop).where(
                        OzonShop.id == shop_id,
                        OzonShop.status == "active"
                    )
                )
                shops = result.scalars().all()
            else:
                # 同步所有活跃店铺
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()

            for shop in shops:
                try:
                    shop_synced_count = await self._sync_shop_transactions(
                        db=db,
                        shop=shop,
                        target_date=target_date
                    )

                    total_synced += shop_synced_count
                    shops_synced.append({
                        "shop_id": shop.id,
                        "shop_name": shop.shop_name,
                        "synced_count": shop_synced_count
                    })

                    logger.info(f"店铺 {shop.shop_name} 同步完成，新增 {shop_synced_count} 条交易记录")

                except Exception as e:
                    logger.error(f"店铺 {shop.shop_name} 同步失败: {e}", exc_info=True)
                    # 更新水位线错误状态
                    await self._update_watermark_error(db, shop.id, str(e))
                    continue

        return {
            "records_processed": total_processed,
            "records_updated": total_synced,
            "message": f"同步完成：{len(shops_synced)}个店铺，共{total_synced}条交易记录",
            "target_date": target_date.isoformat(),
            "shops": shops_synced
        }

    async def _sync_shop_transactions(
        self,
        db: AsyncSession,
        shop: OzonShop,
        target_date: datetime
    ) -> int:
        """
        同步单个店铺的财务交易数据

        Args:
            db: 数据库会话
            shop: 店铺对象
            target_date: 目标日期

        Returns:
            新增的交易记录数
        """
        # 创建API客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        )

        try:
            # 构建日期范围（整天）
            date_from = f"{target_date.isoformat()}T00:00:00Z"
            date_to = f"{target_date.isoformat()}T23:59:59Z"

            logger.info(f"店铺 {shop.shop_name} 开始拉取财务交易数据: {date_from} ~ {date_to}")

            # 分页获取所有交易数据
            page = 1
            total_synced = 0

            while True:
                # 调用OZON API
                result = await client.get_finance_transaction_list(
                    date_from=date_from,
                    date_to=date_to,
                    transaction_type="all",  # 获取所有类型的交易
                    page=page,
                    page_size=1000  # API上限
                )

                operations = result.get("result", {}).get("operations", [])

                if not operations:
                    logger.info(f"店铺 {shop.shop_name} 第{page}页无数据，同步结束")
                    break

                logger.info(f"店铺 {shop.shop_name} 第{page}页获取到 {len(operations)} 条交易记录")

                # DEBUG: 打印第一条交易记录的结构
                if operations and len(operations) > 0:
                    import json
                    logger.info(f"DEBUG - 第一条交易记录示例: {json.dumps(operations[0], ensure_ascii=False, default=str)[:500]}")

                # 扁平化并保存交易记录
                flattened = self._flatten_operations(operations, shop.id)
                synced_count = await self._save_transactions(db, flattened)

                total_synced += synced_count

                # 检查是否还有下一页
                page_count = result.get("result", {}).get("page_count", 0)
                if page >= page_count:
                    logger.info(f"店铺 {shop.shop_name} 已到达最后一页（共{page_count}页）")
                    break

                page += 1

            # 更新水位线
            await self._update_watermark_success(db, shop.id, target_date, total_synced)

            return total_synced

        finally:
            await client.close()

    def _flatten_operations(
        self,
        operations: List[Dict],
        shop_id: int
    ) -> List[Dict]:
        """
        将OZON返回的operations数组扁平化为数据库记录

        每个operation可能包含多个items，需要展开成多条记录

        Args:
            operations: OZON API返回的operations数组
            shop_id: 店铺ID

        Returns:
            扁平化后的记录列表
        """
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

            # 提取posting信息
            posting = op.get("posting", {})

            # posting字段可能是字符串(posting_number)或字典(详细信息)
            if isinstance(posting, str):
                # 如果是字符串，则为posting_number
                posting_number = posting
                posting_delivery_schema = None
                posting_warehouse_name = None
            elif isinstance(posting, dict):
                # 如果是字典，提取详细信息
                posting_number = posting.get("posting_number")
                posting_delivery_schema = posting.get("delivery_schema", {}).get("name") if isinstance(posting.get("delivery_schema"), dict) else None
                posting_warehouse_name = posting.get("warehouse_name")
            else:
                # 其他情况，设为None
                posting_number = None
                posting_delivery_schema = None
                posting_warehouse_name = None

            # 提取金额字段
            accruals_for_sale = Decimal(str(op.get("accruals_for_sale", 0)))
            amount = Decimal(str(op.get("amount", 0)))
            delivery_charge = Decimal(str(op.get("delivery_charge", 0)))
            return_delivery_charge = Decimal(str(op.get("return_delivery_charge", 0)))
            sale_commission = Decimal(str(op.get("sale_commission", 0)))

            # 提取items（商品明细）
            items = op.get("items", [])

            # 提取services（服务费用）
            services = op.get("services", [])

            if items:
                # 如果有items，为每个item创建一条记录
                for item in items:
                    record = {
                        "shop_id": shop_id,
                        "operation_id": operation_id,
                        "operation_type": operation_type,
                        "operation_type_name": operation_type_name,
                        "transaction_type": transaction_type,
                        "posting_number": posting_number,
                        "operation_date": operation_date,
                        "accruals_for_sale": accruals_for_sale,
                        "amount": amount,
                        "delivery_charge": delivery_charge,
                        "return_delivery_charge": return_delivery_charge,
                        "sale_commission": sale_commission,
                        # 商品明细
                        "item_sku": str(item.get("sku")) if item.get("sku") is not None else None,
                        "item_name": item.get("name"),
                        "item_quantity": item.get("quantity"),
                        "item_price": Decimal(str(item.get("price", 0))) if item.get("price") else None,
                        # posting信息
                        "posting_delivery_schema": posting_delivery_schema,
                        "posting_warehouse_name": posting_warehouse_name,
                        # JSON字段
                        "services_json": services,
                        "raw_data": op,
                        "created_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                    flattened.append(record)
            else:
                # 如果没有items，创建一条没有商品明细的记录
                record = {
                    "shop_id": shop_id,
                    "operation_id": operation_id,
                    "operation_type": operation_type,
                    "operation_type_name": operation_type_name,
                    "transaction_type": transaction_type,
                    "posting_number": posting_number,
                    "operation_date": operation_date,
                    "accruals_for_sale": accruals_for_sale,
                    "amount": amount,
                    "delivery_charge": delivery_charge,
                    "return_delivery_charge": return_delivery_charge,
                    "sale_commission": sale_commission,
                    # 商品明细为空
                    "item_sku": None,
                    "item_name": None,
                    "item_quantity": None,
                    "item_price": None,
                    # posting信息
                    "posting_delivery_schema": posting_delivery_schema,
                    "posting_warehouse_name": posting_warehouse_name,
                    # JSON字段
                    "services_json": services,
                    "raw_data": op,
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                }
                flattened.append(record)

        return flattened

    async def _save_transactions(
        self,
        db: AsyncSession,
        records: List[Dict]
    ) -> int:
        """
        批量保存交易记录（去重）

        Args:
            db: 数据库会话
            records: 扁平化后的记录列表

        Returns:
            成功保存的记录数
        """
        saved_count = 0

        for record in records:
            try:
                # 检查是否已存在（基于唯一约束：shop_id + operation_id + item_sku）
                existing = await db.execute(
                    select(OzonFinanceTransaction).where(
                        OzonFinanceTransaction.shop_id == record["shop_id"],
                        OzonFinanceTransaction.operation_id == record["operation_id"],
                        OzonFinanceTransaction.item_sku == record.get("item_sku")
                    )
                )

                if existing.scalar_one_or_none():
                    # 已存在，跳过
                    continue

                # 创建新记录
                transaction = OzonFinanceTransaction(**record)
                db.add(transaction)
                saved_count += 1

            except IntegrityError:
                # 唯一约束冲突，回滚并继续
                await db.rollback()
                continue
            except Exception as e:
                logger.error(f"保存交易记录失败: {e}", exc_info=True)
                await db.rollback()
                continue

        # 提交事务
        await db.commit()

        return saved_count

    async def _update_watermark_success(
        self,
        db: AsyncSession,
        shop_id: int,
        sync_date: datetime,
        synced_count: int
    ):
        """更新水位线（成功）"""
        result = await db.execute(
            select(OzonFinanceSyncWatermark).where(
                OzonFinanceSyncWatermark.shop_id == shop_id
            )
        )
        watermark = result.scalar_one_or_none()

        if watermark:
            watermark.last_sync_date = datetime.combine(sync_date, datetime.min.time()).replace(tzinfo=timezone.utc)
            watermark.sync_status = "idle"
            watermark.sync_error = None
            watermark.last_sync_count = synced_count
            watermark.total_synced_count += synced_count
            watermark.updated_at = datetime.now(timezone.utc)
        else:
            watermark = OzonFinanceSyncWatermark(
                shop_id=shop_id,
                last_sync_date=datetime.combine(sync_date, datetime.min.time()).replace(tzinfo=timezone.utc),
                sync_status="idle",
                last_sync_count=synced_count,
                total_synced_count=synced_count,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(watermark)

        await db.commit()

    async def _update_watermark_error(
        self,
        db: AsyncSession,
        shop_id: int,
        error_message: str
    ):
        """更新水位线（失败）"""
        result = await db.execute(
            select(OzonFinanceSyncWatermark).where(
                OzonFinanceSyncWatermark.shop_id == shop_id
            )
        )
        watermark = result.scalar_one_or_none()

        if watermark:
            watermark.sync_status = "failed"
            watermark.sync_error = error_message
            watermark.updated_at = datetime.now(timezone.utc)
        else:
            watermark = OzonFinanceSyncWatermark(
                shop_id=shop_id,
                sync_status="failed",
                sync_error=error_message,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(watermark)

        await db.commit()


# 单例模式
_finance_sync_service = None


def get_finance_transactions_sync_service() -> FinanceTransactionsSyncService:
    """获取财务交易同步服务单例"""
    global _finance_sync_service
    if _finance_sync_service is None:
        _finance_sync_service = FinanceTransactionsSyncService()
    return _finance_sync_service
