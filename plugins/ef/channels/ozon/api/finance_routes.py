"""
OZON 财务交易API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import List, Optional
from datetime import datetime
import logging

from ef_core.database import get_async_session
from ..models.finance import OzonFinanceTransaction
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


@router.get(
    "/finance/transactions",
    response_model=FinanceTransactionsListResponse,
    summary="获取财务交易列表"
)
async def get_finance_transactions(
    shop_id: int = Query(..., description="店铺ID"),
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    transaction_type: Optional[str] = Query(None, description="交易类型: orders/returns/services/compensation/transferDelivery/other/all"),
    operation_type: Optional[str] = Query(None, description="操作类型"),
    posting_number: Optional[str] = Query(None, description="发货单号"),
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
    """
    try:
        # 构建查询条件
        conditions = [OzonFinanceTransaction.shop_id == shop_id]

        # 日期范围筛选
        if date_from:
            try:
                date_from_obj = datetime.fromisoformat(date_from + "T00:00:00Z")
                conditions.append(OzonFinanceTransaction.operation_date >= date_from_obj)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date_from format")

        if date_to:
            try:
                date_to_obj = datetime.fromisoformat(date_to + "T23:59:59Z")
                conditions.append(OzonFinanceTransaction.operation_date <= date_to_obj)
            except ValueError:
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

        # 查询总数
        count_stmt = select(func.count()).select_from(OzonFinanceTransaction).where(and_(*conditions))
        total_result = await db.execute(count_stmt)
        total = total_result.scalar()

        # 分页查询
        offset = (page - 1) * page_size
        stmt = (
            select(OzonFinanceTransaction)
            .where(and_(*conditions))
            .order_by(OzonFinanceTransaction.operation_date.desc())
            .offset(offset)
            .limit(page_size)
        )

        result = await db.execute(stmt)
        transactions = result.scalars().all()

        # 转换为DTO
        items = [
            FinanceTransactionDTO(
                **transaction.to_dict()
            )
            for transaction in transactions
        ]

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
    shop_id: int = Query(..., description="店铺ID"),
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    transaction_type: Optional[str] = Query(None, description="交易类型"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取财务交易汇总数据

    返回指定条件下的金额汇总
    """
    try:
        # 构建查询条件
        conditions = [OzonFinanceTransaction.shop_id == shop_id]

        if date_from:
            date_from_obj = datetime.fromisoformat(date_from + "T00:00:00Z")
            conditions.append(OzonFinanceTransaction.operation_date >= date_from_obj)

        if date_to:
            date_to_obj = datetime.fromisoformat(date_to + "T23:59:59Z")
            conditions.append(OzonFinanceTransaction.operation_date <= date_to_obj)

        if transaction_type and transaction_type != "all":
            conditions.append(OzonFinanceTransaction.transaction_type == transaction_type)

        # 聚合查询
        stmt = select(
            func.sum(OzonFinanceTransaction.amount).label("total_amount"),
            func.sum(OzonFinanceTransaction.accruals_for_sale).label("total_accruals_for_sale"),
            func.sum(OzonFinanceTransaction.sale_commission).label("total_sale_commission"),
            func.sum(OzonFinanceTransaction.delivery_charge).label("total_delivery_charge"),
            func.sum(OzonFinanceTransaction.return_delivery_charge).label("total_return_delivery_charge"),
            func.count().label("transaction_count")
        ).where(and_(*conditions))

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
