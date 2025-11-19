"""
OZON 财务交易API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, exists
from typing import List, Optional
from datetime import datetime
import logging

from ef_core.database import get_async_session
from ..models.finance import OzonFinanceTransaction
from ..models.global_settings import OzonGlobalSetting
from ..models.orders import OzonPosting, OzonOrder, OzonOrderItem
from ..utils.datetime_utils import parse_date_with_timezone, get_global_timezone
from ..services.finance_translations import translate_operation_type_name
from pydantic import BaseModel, Field

router = APIRouter(tags=["ozon-finance"])
logger = logging.getLogger(__name__)


# DTO类定义
class FinanceTransactionDTO(BaseModel):
    """财务交易记录DTO"""
    id: int
    shop_id: int
    operation_id: int
    operation_type: str
    operation_type_name: Optional[str] = None
    transaction_type: str
    posting_number: Optional[str] = None
    operation_date: str
    accruals_for_sale: str
    amount: str
    delivery_charge: str
    return_delivery_charge: str
    sale_commission: str
    ozon_sku: Optional[str] = None
    item_name: Optional[str] = None
    item_quantity: Optional[int] = None
    item_price: Optional[str] = None
    posting_delivery_schema: Optional[str] = None
    posting_warehouse_name: Optional[str] = None
    created_at: str


class FinanceTransactionsListResponse(BaseModel):
    """财务交易列表响应"""
    items: List[FinanceTransactionDTO]
    total: int
    page: int
    page_size: int
    total_pages: int


class FinanceTransactionsSummary(BaseModel):
    """财务交易汇总"""
    total_amount: str
    total_accruals_for_sale: str
    total_sale_commission: str
    total_delivery_charge: str
    total_return_delivery_charge: str
    transaction_count: int


class FinanceTransactionDailySummaryItem(BaseModel):
    """按日期汇总的财务交易记录"""
    operation_date: str
    transaction_count: int
    total_amount: str
    total_accruals_for_sale: str
    total_sale_commission: str
    total_delivery_charge: str
    total_return_delivery_charge: str


class FinanceTransactionsDailySummaryResponse(BaseModel):
    """按日期汇总的财务交易列表响应"""
    items: List[FinanceTransactionDailySummaryItem]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get(
    "/finance/transactions",
    response_model=FinanceTransactionsListResponse,
    summary="获取财务交易列表"
)
async def get_finance_transactions(
    shop_id: Optional[int] = Query(None, description="店铺ID（不传时查询所有店铺）"),
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    transaction_type: Optional[str] = Query(None, description="交易类型: orders/returns/services/compensation/transferDelivery/other/all"),
    operation_type: Optional[str] = Query(None, description="操作类型"),
    posting_number: Optional[str] = Query(None, description="发货单号"),
    posting_status: Optional[str] = Query(None, description="订单状态: awaiting_deliver/delivered"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(100, ge=1, le=1000, description="每页数量"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取财务交易列表

    支持筛选条件：
    - 日期范围
    - 交易类型
    - 操作类型
    - 发货单号
    - 店铺ID（可选，不传时查询所有店铺）
    """
    try:
        # 获取全局时区设置（用于日期过滤）
        global_timezone = await get_global_timezone(db)

        # 构建查询条件
        conditions = []

        # 店铺ID筛选（可选）
        if shop_id is not None:
            conditions.append(OzonFinanceTransaction.shop_id == shop_id)

        # 日期范围筛选（按全局时区解析）
        if date_from:
            try:
                date_from_obj = parse_date_with_timezone(date_from, global_timezone)
                if date_from_obj:
                    conditions.append(OzonFinanceTransaction.operation_date >= date_from_obj)
            except Exception as e:
                logger.warning(f"Failed to parse date_from: {date_from}, error: {e}")
                raise HTTPException(status_code=400, detail="Invalid date_from format")

        if date_to:
            try:
                date_to_obj = parse_date_with_timezone(date_to, global_timezone)
                if date_to_obj:
                    # 设置为当天的23:59:59
                    from datetime import timedelta
                    date_to_obj = date_to_obj + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                    conditions.append(OzonFinanceTransaction.operation_date <= date_to_obj)
            except Exception as e:
                logger.warning(f"Failed to parse date_to: {date_to}, error: {e}")
                raise HTTPException(status_code=400, detail="Invalid date_to format")

        # 交易类型筛选
        if transaction_type and transaction_type != "all":
            conditions.append(OzonFinanceTransaction.transaction_type == transaction_type)

        # 操作类型筛选
        if operation_type:
            conditions.append(OzonFinanceTransaction.operation_type == operation_type)

        # 发货单号搜索（支持同时匹配精确和右匹配）
        if posting_number:
            import re
            posting_number_value = posting_number.strip()

            # 如果是"数字-数字"格式（如 29025599-0332），同时匹配精确和右匹配
            if re.match(r'^\d+-\d+$', posting_number_value):
                from sqlalchemy import or_
                conditions.append(
                    or_(
                        OzonFinanceTransaction.posting_number == posting_number_value,
                        OzonFinanceTransaction.posting_number.like(posting_number_value + '-%')
                    )
                )
            elif '%' in posting_number_value:
                # 包含通配符，使用 LIKE
                conditions.append(OzonFinanceTransaction.posting_number.like(posting_number_value))
            else:
                # 其他情况，精确匹配
                conditions.append(OzonFinanceTransaction.posting_number == posting_number_value)

        # 订单状态筛选（使用 EXISTS 子查询 + 前缀匹配 + 精确匹配）
        if posting_status == 'delivered':
            # 已签收：仅显示已签收订单
            # 支持两种匹配：
            # 1. 前缀匹配：71564466-0420 → 71564466-0420-1
            # 2. 精确匹配：71564466-0420-1 = 71564466-0420-1
            from sqlalchemy import or_
            conditions.append(
                exists(
                    select(1)
                    .select_from(OzonPosting)
                    .where(
                        or_(
                            OzonPosting.posting_number.like(
                                func.concat(OzonFinanceTransaction.posting_number, '-%')
                            ),
                            OzonPosting.posting_number == OzonFinanceTransaction.posting_number
                        ),
                        OzonPosting.status == 'delivered'
                    )
                )
            )
        # 注意：awaiting_deliver 显示所有订单（包括已签收和未签收），不添加筛选条件

        # 查询总数
        count_stmt = select(func.count()).select_from(OzonFinanceTransaction)
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total_result = await db.execute(count_stmt)
        total = total_result.scalar()

        # 分页查询
        offset = (page - 1) * page_size
        stmt = (
            select(OzonFinanceTransaction)
            .order_by(OzonFinanceTransaction.operation_date.desc())
            .offset(offset)
            .limit(page_size)
        )
        if conditions:
            stmt = stmt.where(and_(*conditions))

        result = await db.execute(stmt)
        transactions = result.scalars().all()

        # 转换为DTO（应用翻译 + 补充商品信息）
        items = []

        # 收集需要补充商品信息的posting_number
        postings_need_items = {}  # {posting_number: [transaction_index, ...]}
        for idx, transaction in enumerate(transactions):
            data = transaction.to_dict()

            # 翻译操作类型名称
            if data.get('operation_type_name'):
                data['operation_type_name'] = translate_operation_type_name(data['operation_type_name'])

            items.append(data)

            # 如果没有商品信息但有posting_number，记录下来
            if not data.get('item_name') and data.get('posting_number'):
                pn = data['posting_number']
                if pn not in postings_need_items:
                    postings_need_items[pn] = []
                postings_need_items[pn].append(idx)

        # 批量查询商品信息
        if postings_need_items:
            # 查询这些posting对应的订单商品
            posting_numbers = list(postings_need_items.keys())
            stmt = (
                select(OzonPosting, OzonOrderItem)
                .join(OzonOrder, OzonPosting.order_id == OzonOrder.id)
                .join(OzonOrderItem, OzonOrder.id == OzonOrderItem.order_id)
                .where(OzonPosting.posting_number.in_(posting_numbers))
            )
            result = await db.execute(stmt)
            rows = result.all()

            # 按posting_number分组商品信息
            posting_items_map = {}  # {posting_number: {'names': [], 'skus': []}}
            for posting, order_item in rows:
                pn = posting.posting_number
                if pn not in posting_items_map:
                    posting_items_map[pn] = {'names': [], 'skus': []}
                if order_item.name:
                    posting_items_map[pn]['names'].append(order_item.name)
                if order_item.ozon_sku:
                    posting_items_map[pn]['skus'].append(str(order_item.ozon_sku))

            # 填充商品信息到对应的交易记录
            for pn, indices in postings_need_items.items():
                if pn in posting_items_map:
                    item_info = posting_items_map[pn]
                    # 将多个商品名称用逗号连接
                    item_name = ', '.join(item_info['names']) if item_info['names'] else None
                    ozon_sku = ', '.join(item_info['skus']) if item_info['skus'] else None

                    for idx in indices:
                        if item_name:
                            items[idx]['item_name'] = item_name
                        if ozon_sku:
                            items[idx]['ozon_sku'] = ozon_sku

        # 转换为DTO
        items = [FinanceTransactionDTO(**data) for data in items]

        total_pages = (total + page_size - 1) // page_size

        return FinanceTransactionsListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取财务交易列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get(
    "/finance/transactions/summary",
    response_model=FinanceTransactionsSummary,
    summary="获取财务交易汇总"
)
async def get_finance_transactions_summary(
    shop_id: Optional[int] = Query(None, description="店铺ID（不传时查询所有店铺）"),
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    transaction_type: Optional[str] = Query(None, description="交易类型"),
    posting_status: Optional[str] = Query(None, description="订单状态: awaiting_deliver/delivered"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取财务交易汇总数据

    返回指定条件下的金额汇总
    支持查询所有店铺（不传 shop_id）
    """
    try:
        # 获取全局时区设置（用于日期过滤）
        global_timezone = await get_global_timezone(db)

        # 构建查询条件
        conditions = []

        # 店铺ID筛选（可选）
        if shop_id is not None:
            conditions.append(OzonFinanceTransaction.shop_id == shop_id)

        if date_from:
            date_from_obj = parse_date_with_timezone(date_from, global_timezone)
            if date_from_obj:
                conditions.append(OzonFinanceTransaction.operation_date >= date_from_obj)

        if date_to:
            date_to_obj = parse_date_with_timezone(date_to, global_timezone)
            if date_to_obj:
                from datetime import timedelta
                date_to_obj = date_to_obj + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                conditions.append(OzonFinanceTransaction.operation_date <= date_to_obj)

        if transaction_type and transaction_type != "all":
            conditions.append(OzonFinanceTransaction.transaction_type == transaction_type)

        # 订单状态筛选（使用 EXISTS 子查询 + 前缀匹配 + 精确匹配）
        if posting_status == 'delivered':
            # 已签收：仅显示已签收订单
            from sqlalchemy import or_
            conditions.append(
                exists(
                    select(1)
                    .select_from(OzonPosting)
                    .where(
                        or_(
                            OzonPosting.posting_number.like(
                                func.concat(OzonFinanceTransaction.posting_number, '-%')
                            ),
                            OzonPosting.posting_number == OzonFinanceTransaction.posting_number
                        ),
                        OzonPosting.status == 'delivered'
                    )
                )
            )
        # 注意：awaiting_deliver 显示所有订单（包括已签收和未签收），不添加筛选条件

        # 聚合查询
        stmt = select(
            func.sum(OzonFinanceTransaction.amount).label("total_amount"),
            func.sum(OzonFinanceTransaction.accruals_for_sale).label("total_accruals_for_sale"),
            func.sum(OzonFinanceTransaction.sale_commission).label("total_sale_commission"),
            func.sum(OzonFinanceTransaction.delivery_charge).label("total_delivery_charge"),
            func.sum(OzonFinanceTransaction.return_delivery_charge).label("total_return_delivery_charge"),
            func.count().label("transaction_count")
        )
        if conditions:
            stmt = stmt.where(and_(*conditions))

        result = await db.execute(stmt)
        row = result.one()

        return FinanceTransactionsSummary(
            total_amount=str(row.total_amount or 0),
            total_accruals_for_sale=str(row.total_accruals_for_sale or 0),
            total_sale_commission=str(row.total_sale_commission or 0),
            total_delivery_charge=str(row.total_delivery_charge or 0),
            total_return_delivery_charge=str(row.total_return_delivery_charge or 0),
            transaction_count=row.transaction_count or 0
        )

    except Exception as e:
        logger.error(f"获取财务交易汇总失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get(
    "/finance/transactions/daily-summary",
    response_model=FinanceTransactionsDailySummaryResponse,
    summary="获取财务交易按日期汇总"
)
async def get_finance_transactions_daily_summary(
    shop_id: Optional[int] = Query(None, description="店铺ID（不传时查询所有店铺）"),
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    transaction_type: Optional[str] = Query(None, description="交易类型: orders/returns/services/compensation/transferDelivery/other/all"),
    posting_status: Optional[str] = Query(None, description="订单状态: awaiting_deliver/delivered"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(100, ge=1, le=1000, description="每页数量"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取财务交易按日期汇总

    返回每天的汇总数据，用于主表格显示
    支持查询所有店铺（不传 shop_id）
    """
    try:
        # 获取全局时区设置（用于日期过滤）
        global_timezone = await get_global_timezone(db)

        # 构建查询条件
        conditions = []

        # 店铺ID筛选（可选）
        if shop_id is not None:
            conditions.append(OzonFinanceTransaction.shop_id == shop_id)

        # 日期范围筛选（按全局时区解析）
        if date_from:
            try:
                date_from_obj = parse_date_with_timezone(date_from, global_timezone)
                if date_from_obj:
                    conditions.append(OzonFinanceTransaction.operation_date >= date_from_obj)
            except Exception as e:
                logger.warning(f"Failed to parse date_from: {date_from}, error: {e}")
                raise HTTPException(status_code=400, detail="Invalid date_from format")

        if date_to:
            try:
                date_to_obj = parse_date_with_timezone(date_to, global_timezone)
                if date_to_obj:
                    from datetime import timedelta
                    date_to_obj = date_to_obj + timedelta(hours=23, minutes=59, seconds=59, microseconds=999999)
                    conditions.append(OzonFinanceTransaction.operation_date <= date_to_obj)
            except Exception as e:
                logger.warning(f"Failed to parse date_to: {date_to}, error: {e}")
                raise HTTPException(status_code=400, detail="Invalid date_to format")

        # 交易类型筛选
        if transaction_type and transaction_type != "all":
            conditions.append(OzonFinanceTransaction.transaction_type == transaction_type)

        # 订单状态筛选（使用 EXISTS 子查询 + 前缀匹配 + 精确匹配）
        if posting_status == 'delivered':
            # 已签收：仅显示已签收订单
            # 支持两种匹配：
            # 1. 前缀匹配：71564466-0420 → 71564466-0420-1
            # 2. 精确匹配：71564466-0420-1 = 71564466-0420-1
            from sqlalchemy import or_
            conditions.append(
                exists(
                    select(1)
                    .select_from(OzonPosting)
                    .where(
                        or_(
                            OzonPosting.posting_number.like(
                                func.concat(OzonFinanceTransaction.posting_number, '-%')
                            ),
                            OzonPosting.posting_number == OzonFinanceTransaction.posting_number
                        ),
                        OzonPosting.status == 'delivered'
                    )
                )
            )
        # 注意：awaiting_deliver 显示所有订单（包括已签收和未签收），不添加筛选条件

        # 提取日期部分（使用 func.date 或 func.cast）
        # PostgreSQL: DATE(operation_date)
        from sqlalchemy import cast, Date
        date_column = cast(OzonFinanceTransaction.operation_date, Date)

        # 构建聚合查询（按日期分组）
        base_query = select(
            date_column.label("operation_date"),
            func.count().label("transaction_count"),
            func.sum(OzonFinanceTransaction.amount).label("total_amount"),
            func.sum(OzonFinanceTransaction.accruals_for_sale).label("total_accruals_for_sale"),
            func.sum(OzonFinanceTransaction.sale_commission).label("total_sale_commission"),
            func.sum(OzonFinanceTransaction.delivery_charge).label("total_delivery_charge"),
            func.sum(OzonFinanceTransaction.return_delivery_charge).label("total_return_delivery_charge"),
        ).group_by(date_column)

        if conditions:
            base_query = base_query.where(and_(*conditions))

        # 查询总天数（用于分页）
        count_subquery = base_query.subquery()
        count_stmt = select(func.count()).select_from(count_subquery)
        total_result = await db.execute(count_stmt)
        total = total_result.scalar()

        # 分页查询（按日期倒序）
        offset = (page - 1) * page_size
        stmt = base_query.order_by(date_column.desc()).offset(offset).limit(page_size)

        result = await db.execute(stmt)
        rows = result.all()

        # 转换为DTO
        items = [
            FinanceTransactionDailySummaryItem(
                operation_date=row.operation_date.isoformat(),
                transaction_count=row.transaction_count or 0,
                total_amount=str(row.total_amount or 0),
                total_accruals_for_sale=str(row.total_accruals_for_sale or 0),
                total_sale_commission=str(row.total_sale_commission or 0),
                total_delivery_charge=str(row.total_delivery_charge or 0),
                total_return_delivery_charge=str(row.total_return_delivery_charge or 0),
            )
            for row in rows
        ]

        total_pages = (total + page_size - 1) // page_size

        return FinanceTransactionsDailySummaryResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取财务交易按日期汇总失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
