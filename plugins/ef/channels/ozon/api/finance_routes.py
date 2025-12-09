"""
OZON 财务交易API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, exists
from sqlalchemy.dialects.postgresql import insert as pg_insert
from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible, get_current_user_from_api_key
from ..models.finance import OzonFinanceTransaction, OzonInvoicePayment, calculate_billing_period
from ..models.ozon_shops import OzonShop
from ..models.global_settings import OzonGlobalSetting
from ..models.orders import OzonPosting
from ..utils.datetime_utils import parse_date_with_timezone, get_global_timezone
from ..services.finance_translations import translate_operation_type_name
from .permissions import filter_by_shop_permission, build_shop_filter_condition
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


# =====================================================
# Invoice Payment DTOs (账单付款)
# =====================================================


class InvoicePaymentItem(BaseModel):
    """浏览器扩展上传的单条付款记录"""
    payment_type: str = Field(..., description="付款类型")
    amount_cny: str = Field(..., description="金额(CNY)")
    payment_status: str = Field(..., description="付款状态: waiting/paid")
    scheduled_payment_date: str = Field(..., description="计划付款日期 (DD.MM.YYYY)")
    actual_payment_date: Optional[str] = Field(None, description="实际付款日期 (DD.MM.YYYY)")
    period_text: Optional[str] = Field(None, description="周期文本")
    payment_file_number: Optional[str] = Field(None, description="付款文件编号")
    payment_method: Optional[str] = Field(None, description="支付方式")


class InvoicePaymentSyncRequest(BaseModel):
    """浏览器扩展同步请求"""
    client_id: str = Field(..., description="OZON Client ID")
    payments: List[InvoicePaymentItem] = Field(..., description="付款记录列表")


class InvoicePaymentSyncResponse(BaseModel):
    """同步响应"""
    success: bool
    created: int = 0
    updated: int = 0
    message: Optional[str] = None


class InvoicePaymentDTO(BaseModel):
    """账单付款记录 DTO"""
    id: int
    shop_id: int
    payment_type: str
    amount_cny: str
    payment_status: str
    scheduled_payment_date: str
    actual_payment_date: Optional[str] = None
    period_start: str
    period_end: str
    payment_method: Optional[str] = None
    payment_file_number: Optional[str] = None
    period_text: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class InvoicePaymentsByPeriodResponse(BaseModel):
    """按周期查询付款响应"""
    items: List[InvoicePaymentDTO]
    total_amount_cny: str
    paid_amount_cny: str
    pending_amount_cny: str


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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
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
        # 权限过滤：获取用户授权的店铺列表
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))

        # 获取全局时区设置（用于日期过滤）
        global_timezone = await get_global_timezone(db)

        # 构建查询条件
        conditions = []

        # 应用店铺权限过滤
        shop_filter = build_shop_filter_condition(OzonFinanceTransaction, allowed_shop_ids)
        if shop_filter is not True:
            conditions.append(shop_filter)

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

        # 批量查询商品信息（从 posting.raw_payload.products 获取，避免 JOIN）
        if postings_need_items:
            posting_numbers = list(postings_need_items.keys())
            stmt = select(OzonPosting).where(OzonPosting.posting_number.in_(posting_numbers))
            result = await db.execute(stmt)
            postings = result.scalars().all()

            # 从 raw_payload.products 获取商品信息（无需 JOIN OzonOrder/OzonOrderItem）
            posting_items_map = {}  # {posting_number: {'names': [], 'skus': []}}
            for posting in postings:
                pn = posting.posting_number
                posting_items_map[pn] = {'names': [], 'skus': []}

                if posting.raw_payload and 'products' in posting.raw_payload:
                    for product in posting.raw_payload['products']:
                        if product.get('name'):
                            posting_items_map[pn]['names'].append(product['name'])
                        if product.get('sku'):
                            posting_items_map[pn]['skus'].append(str(product['sku']))

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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取财务交易汇总数据

    返回指定条件下的金额汇总
    支持查询所有店铺（不传 shop_id）
    """
    try:
        # 权限过滤：获取用户授权的店铺列表
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))

        # 获取全局时区设置（用于日期过滤）
        global_timezone = await get_global_timezone(db)

        # 构建查询条件
        conditions = []

        # 应用店铺权限过滤
        shop_filter = build_shop_filter_condition(OzonFinanceTransaction, allowed_shop_ids)
        if shop_filter is not True:
            conditions.append(shop_filter)

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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取财务交易按日期汇总

    返回每天的汇总数据，用于主表格显示
    支持查询所有店铺（不传 shop_id）
    """
    try:
        # 权限过滤：获取用户授权的店铺列表
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))

        # 获取全局时区设置（用于日期过滤）
        global_timezone = await get_global_timezone(db)

        # 构建查询条件
        conditions = []

        # 应用店铺权限过滤
        shop_filter = build_shop_filter_condition(OzonFinanceTransaction, allowed_shop_ids)
        if shop_filter is not True:
            conditions.append(shop_filter)

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


# =====================================================
# Invoice Payment Endpoints (账单付款)
# =====================================================


def parse_ru_date(date_str: str) -> Optional[date]:
    """
    解析俄罗斯格式日期 DD.MM.YYYY
    返回 date 对象
    """
    if not date_str or date_str == "—":
        return None
    try:
        parts = date_str.strip().split(".")
        if len(parts) == 3:
            day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
            return date(year, month, day)
    except (ValueError, IndexError):
        pass
    return None


def parse_amount_cny(amount_str: str) -> Decimal:
    """
    解析金额字符串，支持俄罗斯/欧洲格式
    例如: "11 676,27 ¥" -> Decimal("11676.27")
          "12 345.67" -> Decimal("12345.67")
          "-1 234,56 ¥" -> Decimal("-1234.56")
    """
    if not amount_str:
        return Decimal("0")

    # 1. 移除货币符号和空格（包括普通空格和非断行空格 U+00A0）
    cleaned = amount_str.replace("¥", "").replace("₽", "").replace(" ", "").replace("\u00a0", "").strip()

    # 2. 处理负数（俄语负号 − 和普通负号 -）
    is_negative = False
    if cleaned.startswith("−") or cleaned.startswith("-"):
        is_negative = True
        cleaned = cleaned[1:]

    # 3. 处理小数分隔符（俄罗斯用逗号，国际用点号）
    # 如果同时有点和逗号，需要判断哪个是小数分隔符
    if "," in cleaned and "." in cleaned:
        # 例如 "1.234,56" -> 逗号是小数分隔符
        # 例如 "1,234.56" -> 点号是小数分隔符
        if cleaned.rfind(",") > cleaned.rfind("."):
            # 逗号在后面，是小数分隔符
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            # 点号在后面，是小数分隔符
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        # 只有逗号，当作小数分隔符
        cleaned = cleaned.replace(",", ".")

    # 4. 解析
    try:
        result = Decimal(cleaned)
        return -result if is_negative else result
    except Exception:
        return Decimal("0")


@router.post(
    "/invoice-payments/sync",
    response_model=InvoicePaymentSyncResponse,
    summary="同步账单付款数据（浏览器扩展调用）"
)
async def sync_invoice_payments(
    request: InvoicePaymentSyncRequest,
    db: AsyncSession = Depends(get_async_session),
    _: User = Depends(get_current_user_from_api_key)
):
    """
    接收浏览器扩展上传的账单付款数据

    1. 根据 client_id 查找 shop_id
    2. 解析日期和金额
    3. 计算账单周期
    4. Upsert 记录（按唯一约束去重）
    """
    try:
        # 1. 根据 client_id 查找店铺
        result = await db.execute(
            select(OzonShop).where(OzonShop.client_id == request.client_id)
        )
        shop = result.scalar_one_or_none()

        if not shop:
            logger.warning(f"Invoice payment sync: shop not found for client_id={request.client_id}")
            raise HTTPException(
                status_code=404,
                detail=f"Shop not found for client_id: {request.client_id}"
            )

        created_count = 0
        updated_count = 0

        for payment in request.payments:
            # 2. 解析日期
            scheduled_date = parse_ru_date(payment.scheduled_payment_date)
            if not scheduled_date:
                logger.warning(f"Invalid scheduled_payment_date: {payment.scheduled_payment_date}")
                continue

            actual_date = parse_ru_date(payment.actual_payment_date)

            # 3. 解析金额
            amount = parse_amount_cny(payment.amount_cny)

            # 4. 计算账单周期
            period_start, period_end = calculate_billing_period(scheduled_date)

            # 5. 转换状态
            # 页面显示 "等待付款" 或 "已付款"
            status_map = {
                "等待付款": "waiting",
                "已付款": "paid",
                "waiting": "waiting",
                "paid": "paid",
            }
            payment_status = status_map.get(payment.payment_status, "waiting")

            # 6. Upsert
            stmt = pg_insert(OzonInvoicePayment).values(
                shop_id=shop.id,
                payment_type=payment.payment_type,
                amount_cny=amount,
                payment_status=payment_status,
                scheduled_payment_date=scheduled_date,
                actual_payment_date=actual_date,
                period_start=period_start,
                period_end=period_end,
                payment_method=payment.payment_method if payment.payment_method != "—" else None,
                payment_file_number=payment.payment_file_number if payment.payment_file_number != "—" else None,
                period_text=payment.period_text if payment.period_text != "—" else None,
                raw_data={
                    "original": payment.model_dump(),
                    "synced_at": datetime.utcnow().isoformat()
                }
            ).on_conflict_do_update(
                constraint="uq_ozon_invoice_payment",
                set_={
                    "payment_status": payment_status,
                    "actual_payment_date": actual_date,
                    "payment_method": payment.payment_method if payment.payment_method != "—" else None,
                    "payment_file_number": payment.payment_file_number if payment.payment_file_number != "—" else None,
                    "updated_at": func.now(),
                    "raw_data": {
                        "original": payment.model_dump(),
                        "synced_at": datetime.utcnow().isoformat()
                    }
                }
            ).returning(OzonInvoicePayment.id, OzonInvoicePayment.created_at, OzonInvoicePayment.updated_at)

            result = await db.execute(stmt)
            row = result.one()

            # 判断是新增还是更新（created_at == updated_at 说明是新增）
            if row.created_at and row.updated_at:
                # 新记录的 created_at 和 updated_at 应该非常接近
                time_diff = abs((row.updated_at - row.created_at).total_seconds())
                if time_diff < 1:
                    created_count += 1
                else:
                    updated_count += 1
            else:
                created_count += 1

        await db.commit()

        logger.info(
            f"Invoice payment sync completed: shop_id={shop.id}, "
            f"created={created_count}, updated={updated_count}"
        )

        return InvoicePaymentSyncResponse(
            success=True,
            created=created_count,
            updated=updated_count,
            message=f"Synced {created_count + updated_count} payments for client_id {request.client_id}"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Invoice payment sync failed: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.get(
    "/invoice-payments/by-period",
    response_model=InvoicePaymentsByPeriodResponse,
    summary="按周期查询账单付款"
)
async def get_invoice_payments_by_period(
    shop_id: Optional[int] = Query(None, description="店铺ID（不传时查询所有店铺）"),
    period_start: str = Query(..., description="周期开始日期 (YYYY-MM-DD)"),
    period_end: str = Query(..., description="周期结束日期 (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    按周期查询账单付款

    用于前端显示"实收款"统计
    返回:
    - items: 付款记录列表
    - total_amount_cny: 总金额
    - paid_amount_cny: 已付金额
    - pending_amount_cny: 待付金额
    """
    try:
        # 权限过滤
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e))

        # 解析日期
        try:
            period_start_date = date.fromisoformat(period_start)
            period_end_date = date.fromisoformat(period_end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

        # 构建查询条件
        conditions = [
            OzonInvoicePayment.period_start >= period_start_date,
            OzonInvoicePayment.period_end <= period_end_date
        ]

        # 应用店铺权限过滤
        shop_filter = build_shop_filter_condition(OzonInvoicePayment, allowed_shop_ids)
        if shop_filter is not True:
            conditions.append(shop_filter)

        # 查询记录
        stmt = select(OzonInvoicePayment).where(and_(*conditions)).order_by(
            OzonInvoicePayment.scheduled_payment_date.desc()
        )
        result = await db.execute(stmt)
        payments = result.scalars().all()

        # 计算汇总
        total_amount = Decimal("0")
        paid_amount = Decimal("0")
        pending_amount = Decimal("0")

        items = []
        for payment in payments:
            amount = payment.amount_cny or Decimal("0")
            total_amount += amount

            if payment.payment_status == "paid":
                paid_amount += amount
            else:
                pending_amount += amount

            items.append(InvoicePaymentDTO(
                id=payment.id,
                shop_id=payment.shop_id,
                payment_type=payment.payment_type,
                amount_cny=str(payment.amount_cny),
                payment_status=payment.payment_status,
                scheduled_payment_date=payment.scheduled_payment_date.isoformat() if payment.scheduled_payment_date else "",
                actual_payment_date=payment.actual_payment_date.isoformat() if payment.actual_payment_date else None,
                period_start=payment.period_start.isoformat() if payment.period_start else "",
                period_end=payment.period_end.isoformat() if payment.period_end else "",
                payment_method=payment.payment_method,
                payment_file_number=payment.payment_file_number,
                period_text=payment.period_text,
                created_at=payment.created_at.isoformat() if payment.created_at else None,
                updated_at=payment.updated_at.isoformat() if payment.updated_at else None,
            ))

        return InvoicePaymentsByPeriodResponse(
            items=items,
            total_amount_cny=str(total_amount),
            paid_amount_cny=str(paid_amount),
            pending_amount_cny=str(pending_amount)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get invoice payments by period failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


class ShopSyncStatus(BaseModel):
    """店铺同步状态"""
    shop_id: int = Field(..., description="店铺ID")
    client_id: str = Field(..., description="店铺 client_id")
    shop_name: str = Field(..., description="店铺名称")
    should_sync: bool = Field(..., description="是否需要同步")
    reason: str = Field(..., description="原因说明")


class InvoicePaymentSyncCheckResponse(BaseModel):
    """账单付款同步检查响应"""
    in_check_window: bool = Field(..., description="是否在检查窗口内")
    window_reason: str = Field(..., description="检查窗口说明")
    shops: List[ShopSyncStatus] = Field(default_factory=list, description="各店铺同步状态")


@router.get(
    "/invoice-payments/should-sync",
    response_model=InvoicePaymentSyncCheckResponse,
    summary="检查是否需要同步账单付款"
)
async def check_should_sync_invoice_payments(
    db: AsyncSession = Depends(get_async_session),
    _: User = Depends(get_current_user_from_api_key)
):
    """
    检查是否需要同步账单付款

    检查逻辑：
    1. 当前日期是否在检查窗口内（周期结束后 7 天内）
    2. 每个店铺是否已同步（该周期是否有记录）

    检查窗口：
    - 周期 1-15 结束后 → 16-22 号检查
    - 周期 16-月末结束后 → 下月 1-7 号检查
    """
    try:
        from datetime import datetime
        from calendar import monthrange

        now = datetime.utcnow()
        day = now.day

        # 判断检查窗口和对应周期
        # 周期 1-15 结束后 → 16-22 号检查
        # 周期 16-月末结束后 → 下月 1-7 号检查
        if day >= 16 and day <= 22:
            # 检查当月 1-15 周期
            in_check_window = True
            period_start = date(now.year, now.month, 1)
            period_end = date(now.year, now.month, 15)
            window_reason = f"在检查窗口内（{day}号，检查周期 {period_start} ~ {period_end}）"
        elif day >= 1 and day <= 7:
            # 检查上月 16-月末周期
            in_check_window = True
            if now.month == 1:
                prev_year = now.year - 1
                prev_month = 12
            else:
                prev_year = now.year
                prev_month = now.month - 1

            _, last_day = monthrange(prev_year, prev_month)
            period_start = date(prev_year, prev_month, 16)
            period_end = date(prev_year, prev_month, last_day)
            window_reason = f"在检查窗口内（{day}号，检查周期 {period_start} ~ {period_end}）"
        else:
            # 不在检查窗口内
            return InvoicePaymentSyncCheckResponse(
                in_check_window=False,
                window_reason=f"不在检查窗口内（当前 {day} 号，检查窗口: 1-7号或16-22号）",
                shops=[]
            )

        # 获取所有有 client_id 的店铺
        from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
        stmt = select(OzonShop).where(
            and_(
                OzonShop.client_id.isnot(None),
                OzonShop.client_id != "",
                OzonShop.status == "active"
            )
        )
        result = await db.execute(stmt)
        shops = result.scalars().all()

        shop_statuses = []
        for shop in shops:
            # 查询该店铺在该周期是否有记录
            stmt = select(func.count(OzonInvoicePayment.id)).where(
                and_(
                    OzonInvoicePayment.shop_id == shop.id,
                    OzonInvoicePayment.period_start >= period_start,
                    OzonInvoicePayment.period_end <= period_end
                )
            )
            result = await db.execute(stmt)
            record_count = result.scalar() or 0

            if record_count > 0:
                # 已有记录，检查是否有 waiting 状态
                stmt = select(func.count(OzonInvoicePayment.id)).where(
                    and_(
                        OzonInvoicePayment.shop_id == shop.id,
                        OzonInvoicePayment.period_start >= period_start,
                        OzonInvoicePayment.period_end <= period_end,
                        OzonInvoicePayment.payment_status == "waiting"
                    )
                )
                result = await db.execute(stmt)
                waiting_count = result.scalar() or 0

                if waiting_count > 0:
                    should_sync = True
                    reason = f"有 {waiting_count} 条待付款记录需要更新"
                else:
                    should_sync = False
                    reason = f"已同步 {record_count} 条记录，无待付款"
            else:
                # 没有记录，需要同步
                should_sync = True
                reason = "该周期尚未同步"

            shop_statuses.append(ShopSyncStatus(
                shop_id=shop.id,
                client_id=shop.client_id,
                shop_name=shop.shop_name_cn or shop.shop_name,
                should_sync=should_sync,
                reason=reason
            ))

        return InvoicePaymentSyncCheckResponse(
            in_check_window=in_check_window,
            window_reason=window_reason,
            shops=shop_statuses
        )

    except Exception as e:
        logger.error(f"Check should sync invoice payments failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Check failed: {str(e)}")
