"""
额度管理 API - 用户接口
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.models.credit import CreditAccount, CreditTransaction, CreditModuleConfig
from ef_core.api.auth import get_current_user
from ef_core.services.credit_service import CreditService

router = APIRouter(prefix="/credit", tags=["Credit"])


# ============ Request/Response Models ============

class BalanceResponse(BaseModel):
    """余额响应"""
    balance: str
    total_recharged: str
    total_consumed: str
    low_balance_threshold: str
    low_balance_alert_muted: bool
    is_low_balance: bool
    credit_name: str
    # 账户所有者信息
    account_user_id: int
    account_username: str


class CalculateRequest(BaseModel):
    """消费计算请求"""
    module: str = Field(..., description="模块标识，如 print_label")
    posting_numbers: List[str] = Field(default=[], description="货件编号列表")
    exclude_reprints: bool = Field(default=True, description="是否排除补打印")


class CalculateResponse(BaseModel):
    """消费计算响应"""
    total_cost: str
    unit_cost: str
    billable_count: int
    reprint_count: int
    current_balance: str
    sufficient: bool
    credit_name: str


class MuteAlertResponse(BaseModel):
    """静默预警响应"""
    muted: bool


class TransactionItem(BaseModel):
    """交易记录项"""
    id: int
    transaction_type: str
    amount: str
    balance_before: str
    balance_after: str
    module: Optional[str]
    operator_user_id: int
    operator_username: str
    details: dict
    payment_method: Optional[str]
    payment_amount_cny: Optional[str]
    notes: Optional[str]
    ip_address: Optional[str]
    created_at: str


class TransactionsResponse(BaseModel):
    """交易记录列表响应"""
    items: List[TransactionItem]
    total: int
    page: int
    page_size: int


class ModuleConfigItem(BaseModel):
    """模块配置项"""
    module_key: str
    module_name: str
    cost_per_unit: str
    unit_description: str
    is_enabled: bool


class ModuleConfigsResponse(BaseModel):
    """模块配置列表响应"""
    items: List[ModuleConfigItem]


# ============ API Endpoints ============

@router.get("/balance", response_model=BalanceResponse)
async def get_balance(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """
    获取当前用户的额度余额

    - 子账号返回主账号的余额
    - 返回余额、累计充值、累计消费、预警状态等
    """
    account = await CreditService.get_master_account(db, current_user.id)
    credit_name = await CreditService.get_credit_name(db)

    # 获取账户所有者信息
    result = await db.execute(
        select(User).where(User.id == account.user_id)
    )
    account_user = result.scalar_one()

    return BalanceResponse(
        balance=str(account.balance),
        total_recharged=str(account.total_recharged),
        total_consumed=str(account.total_consumed),
        low_balance_threshold=str(account.low_balance_threshold),
        low_balance_alert_muted=account.low_balance_alert_muted,
        is_low_balance=account.is_low_balance(),
        credit_name=credit_name,
        account_user_id=account.user_id,
        account_username=account_user.username
    )


@router.post("/calculate", response_model=CalculateResponse)
async def calculate_cost(
    body: CalculateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """
    计算模块消费

    - 支持打印等模块的费用预估
    - 排除补打印（已打印过的订单不计费）
    """
    if body.module == "print_label":
        cost_info = await CreditService.calculate_print_cost(
            db, body.posting_numbers, body.exclude_reprints
        )
    else:
        # 通用模块计算
        unit_cost = await CreditService.get_module_cost(db, body.module)
        count = len(body.posting_numbers) if body.posting_numbers else 1
        cost_info = {
            "total_cost": unit_cost * count,
            "unit_cost": unit_cost,
            "billable_count": count,
            "reprint_count": 0
        }

    # 获取当前余额
    account = await CreditService.get_master_account(db, current_user.id)
    credit_name = await CreditService.get_credit_name(db)

    sufficient = account.balance >= cost_info["total_cost"]

    return CalculateResponse(
        total_cost=str(cost_info["total_cost"]),
        unit_cost=str(cost_info["unit_cost"]),
        billable_count=cost_info["billable_count"],
        reprint_count=cost_info["reprint_count"],
        current_balance=str(account.balance),
        sufficient=sufficient,
        credit_name=credit_name
    )


@router.post("/mute-alert", response_model=MuteAlertResponse)
async def mute_alert(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """
    静默余额不足预警

    - 用户选择"不再提醒"后调用
    - 下次充值后自动重置
    """
    await CreditService.mute_low_balance_alert(db, current_user.id)
    await db.commit()
    return MuteAlertResponse(muted=True)


@router.get("/transactions", response_model=TransactionsResponse)
async def get_transactions(
    transaction_type: Optional[str] = Query(None, description="交易类型：recharge/consume/refund"),
    module: Optional[str] = Query(None, description="消费模块：print_label 等"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """
    获取交易记录

    - 子账号可以看到自己的消费记录
    - 主账号可以看到所有子账号的消费记录和充值记录
    - 支持按时间、类型、模块筛选
    """
    # 获取主账号
    account = await CreditService.get_master_account(db, current_user.id)

    # 构建查询条件
    conditions = [CreditTransaction.account_id == account.id]

    if transaction_type:
        conditions.append(CreditTransaction.transaction_type == transaction_type)

    if module:
        conditions.append(CreditTransaction.module == module)

    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            conditions.append(CreditTransaction.created_at >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的开始日期格式")

    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
            conditions.append(CreditTransaction.created_at <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的结束日期格式")

    # 如果是子账号，只能看自己的消费记录
    if current_user.role == "sub_account":
        conditions.append(CreditTransaction.operator_user_id == current_user.id)

    # 查询总数
    from sqlalchemy import func
    count_query = select(func.count()).select_from(CreditTransaction).where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 查询数据
    offset = (page - 1) * page_size
    query = (
        select(CreditTransaction)
        .where(and_(*conditions))
        .order_by(CreditTransaction.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(query)
    transactions = result.scalars().all()

    # 获取操作员信息
    operator_ids = list(set(t.operator_user_id for t in transactions))
    if operator_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(operator_ids))
        )
        users_map = {u.id: u.username for u in users_result.scalars().all()}
    else:
        users_map = {}

    items = []
    for t in transactions:
        items.append(TransactionItem(
            id=t.id,
            transaction_type=t.transaction_type,
            amount=str(t.amount),
            balance_before=str(t.balance_before),
            balance_after=str(t.balance_after),
            module=t.module,
            operator_user_id=t.operator_user_id,
            operator_username=users_map.get(t.operator_user_id, "未知"),
            details=t.details or {},
            payment_method=t.payment_method,
            payment_amount_cny=str(t.payment_amount_cny) if t.payment_amount_cny else None,
            notes=t.notes,
            ip_address=t.ip_address,
            created_at=t.created_at.isoformat()
        ))

    return TransactionsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/module-configs", response_model=ModuleConfigsResponse)
async def get_module_configs(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """
    获取所有模块消费配置

    - 所有用户可见
    - 用于前端显示各模块的消费单价
    """
    configs = await CreditService.get_all_module_configs(db)

    items = [
        ModuleConfigItem(
            module_key=c.module_key,
            module_name=c.module_name,
            cost_per_unit=str(c.cost_per_unit),
            unit_description=c.unit_description,
            is_enabled=c.is_enabled
        )
        for c in configs
    ]

    return ModuleConfigsResponse(items=items)
