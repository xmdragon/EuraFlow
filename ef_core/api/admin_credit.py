"""
额度管理 API - 管理员接口
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.models.credit import CreditAccount, CreditTransaction, CreditModuleConfig
from ef_core.middleware.auth import require_role
from ef_core.services.credit_service import CreditService

router = APIRouter(prefix="/admin/credit", tags=["Admin Credit"])


# ============ Request/Response Models ============

class RechargeRequest(BaseModel):
    """充值请求"""
    user_id: int = Field(..., description="被充值的用户ID")
    amount: str = Field(..., description="充值点数")
    payment_method: str = Field(default="manual", description="支付方式：manual/wechat/alipay")
    payment_amount_cny: Optional[str] = Field(None, description="实付金额（CNY）")
    payment_order_no: Optional[str] = Field(None, description="支付订单号")
    notes: Optional[str] = Field(None, description="备注")


class RechargeResponse(BaseModel):
    """充值响应"""
    transaction_id: int
    balance_before: str
    balance_after: str
    amount: str


class AccountItem(BaseModel):
    """账户列表项"""
    id: int
    user_id: int
    username: str
    role: str
    balance: str
    total_recharged: str
    total_consumed: str
    low_balance_threshold: str
    is_low_balance: bool
    sub_accounts_count: int
    created_at: str
    updated_at: str


class AccountsResponse(BaseModel):
    """账户列表响应"""
    items: List[AccountItem]
    total: int
    page: int
    page_size: int


class RechargeRecordItem(BaseModel):
    """充值记录项"""
    id: int
    user_id: int
    username: str
    amount: str
    payment_method: str
    payment_amount_cny: Optional[str]
    payment_order_no: Optional[str]
    balance_before: str
    balance_after: str
    approved_by: int
    approved_by_username: str
    notes: Optional[str]
    ip_address: Optional[str]
    created_at: str


class RechargeRecordsResponse(BaseModel):
    """充值记录列表响应"""
    items: List[RechargeRecordItem]
    total: int
    page: int
    page_size: int


class UpdateModuleConfigRequest(BaseModel):
    """更新模块配置请求"""
    cost_per_unit: Optional[str] = Field(None, description="单次消费点数")
    module_name: Optional[str] = Field(None, description="模块显示名称")
    unit_description: Optional[str] = Field(None, description="单位描述")
    is_enabled: Optional[bool] = Field(None, description="是否启用")


class ModuleConfigItem(BaseModel):
    """模块配置项"""
    id: int
    module_key: str
    module_name: str
    cost_per_unit: str
    unit_description: str
    is_enabled: bool
    created_at: str
    updated_at: str


class ModuleConfigsResponse(BaseModel):
    """模块配置列表响应"""
    items: List[ModuleConfigItem]


class UpdateThresholdRequest(BaseModel):
    """更新预警阈值请求"""
    user_id: int = Field(..., description="用户ID")
    threshold: str = Field(..., description="新的预警阈值")


# ============ API Endpoints ============

@router.post("/recharge", response_model=RechargeResponse)
async def recharge(
    request: Request,
    body: RechargeRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("admin"))
):
    """
    为用户充值（仅管理员）

    - 支持手动充值、微信支付、支付宝支付
    - 记录完整的充值信息
    """
    # 验证被充值用户
    result = await db.execute(
        select(User).where(User.id == body.user_id)
    )
    target_user = result.scalar_one_or_none()

    if not target_user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if target_user.role == "sub_account":
        raise HTTPException(status_code=400, detail="不能直接为子账号充值，请为其主账号充值")

    # 解析金额
    try:
        amount = Decimal(body.amount)
        if amount <= 0:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="无效的充值金额")

    payment_amount_cny = None
    if body.payment_amount_cny:
        try:
            payment_amount_cny = Decimal(body.payment_amount_cny)
        except Exception:
            raise HTTPException(status_code=400, detail="无效的实付金额")

    # 验证支付方式
    if body.payment_method not in ["manual", "wechat", "alipay"]:
        raise HTTPException(status_code=400, detail="无效的支付方式")

    # 获取客户端IP
    ip_address = None
    if request.client:
        ip_address = request.client.host

    # 执行充值
    transaction = await CreditService.recharge(
        db=db,
        user_id=body.user_id,
        amount=amount,
        payment_method=body.payment_method,
        payment_amount_cny=payment_amount_cny,
        approved_by=current_user.id,
        payment_order_no=body.payment_order_no,
        notes=body.notes,
        ip_address=ip_address
    )

    await db.commit()

    return RechargeResponse(
        transaction_id=transaction.id,
        balance_before=str(transaction.balance_before),
        balance_after=str(transaction.balance_after),
        amount=str(transaction.amount)
    )


@router.get("/accounts", response_model=AccountsResponse)
async def get_accounts(
    search: Optional[str] = Query(None, description="搜索用户名"),
    role: Optional[str] = Query(None, description="角色筛选：admin/manager"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("admin"))
):
    """
    获取所有用户额度列表（仅管理员）

    - 只显示 admin 和 manager 的账户
    - 支持搜索和筛选
    """
    # 构建用户查询条件
    user_conditions = [User.role.in_(["admin", "manager"])]

    if search:
        user_conditions.append(User.username.ilike(f"%{search}%"))

    if role:
        if role not in ["admin", "manager"]:
            raise HTTPException(status_code=400, detail="无效的角色筛选")
        user_conditions.append(User.role == role)

    # 查询总数
    count_query = select(func.count()).select_from(User).where(and_(*user_conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 查询用户
    offset = (page - 1) * page_size
    users_query = (
        select(User)
        .where(and_(*user_conditions))
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    users_result = await db.execute(users_query)
    users = users_result.scalars().all()

    # 获取这些用户的额度账户
    user_ids = [u.id for u in users]
    if user_ids:
        accounts_result = await db.execute(
            select(CreditAccount).where(CreditAccount.user_id.in_(user_ids))
        )
        accounts_map = {a.user_id: a for a in accounts_result.scalars().all()}
    else:
        accounts_map = {}

    # 获取子账号数量
    if user_ids:
        sub_counts_result = await db.execute(
            select(User.parent_user_id, func.count(User.id))
            .where(User.parent_user_id.in_(user_ids))
            .group_by(User.parent_user_id)
        )
        sub_counts_map = {row[0]: row[1] for row in sub_counts_result.fetchall()}
    else:
        sub_counts_map = {}

    items = []
    for user in users:
        account = accounts_map.get(user.id)
        if account:
            items.append(AccountItem(
                id=account.id,
                user_id=user.id,
                username=user.username,
                role=user.role,
                balance=str(account.balance),
                total_recharged=str(account.total_recharged),
                total_consumed=str(account.total_consumed),
                low_balance_threshold=str(account.low_balance_threshold),
                is_low_balance=account.is_low_balance(),
                sub_accounts_count=sub_counts_map.get(user.id, 0),
                created_at=account.created_at.isoformat(),
                updated_at=account.updated_at.isoformat()
            ))
        else:
            # 还没有额度账户的用户
            items.append(AccountItem(
                id=0,
                user_id=user.id,
                username=user.username,
                role=user.role,
                balance="0.0000",
                total_recharged="0.0000",
                total_consumed="0.0000",
                low_balance_threshold="100.0000",
                is_low_balance=True,
                sub_accounts_count=sub_counts_map.get(user.id, 0),
                created_at=user.created_at.isoformat(),
                updated_at=user.updated_at.isoformat()
            ))

    return AccountsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/recharge-records", response_model=RechargeRecordsResponse)
async def get_recharge_records(
    user_id: Optional[int] = Query(None, description="用户ID筛选"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("admin"))
):
    """
    获取充值记录（仅管理员）

    - 支持按用户、时间筛选
    """
    conditions = [CreditTransaction.transaction_type == "recharge"]

    if user_id:
        # 先获取该用户的账户
        account_result = await db.execute(
            select(CreditAccount).where(CreditAccount.user_id == user_id)
        )
        account = account_result.scalar_one_or_none()
        if account:
            conditions.append(CreditTransaction.account_id == account.id)
        else:
            # 用户没有账户，返回空
            return RechargeRecordsResponse(items=[], total=0, page=page, page_size=page_size)

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

    # 查询总数
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

    # 获取相关用户信息
    account_ids = list(set(t.account_id for t in transactions))
    operator_ids = list(set(t.approved_by for t in transactions if t.approved_by))

    if account_ids:
        accounts_result = await db.execute(
            select(CreditAccount).where(CreditAccount.id.in_(account_ids))
        )
        accounts_map = {a.id: a for a in accounts_result.scalars().all()}
        account_user_ids = [a.user_id for a in accounts_map.values()]
    else:
        accounts_map = {}
        account_user_ids = []

    all_user_ids = list(set(account_user_ids + operator_ids))
    if all_user_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(all_user_ids))
        )
        users_map = {u.id: u.username for u in users_result.scalars().all()}
    else:
        users_map = {}

    items = []
    for t in transactions:
        account = accounts_map.get(t.account_id)
        target_user_id = account.user_id if account else 0
        target_username = users_map.get(target_user_id, "未知")
        approved_by_username = users_map.get(t.approved_by, "未知") if t.approved_by else "系统"

        items.append(RechargeRecordItem(
            id=t.id,
            user_id=target_user_id,
            username=target_username,
            amount=str(t.amount),
            payment_method=t.payment_method or "manual",
            payment_amount_cny=str(t.payment_amount_cny) if t.payment_amount_cny else None,
            payment_order_no=t.payment_order_no,
            balance_before=str(t.balance_before),
            balance_after=str(t.balance_after),
            approved_by=t.approved_by or 0,
            approved_by_username=approved_by_username,
            notes=t.notes,
            ip_address=t.ip_address,
            created_at=t.created_at.isoformat()
        ))

    return RechargeRecordsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/module-configs", response_model=ModuleConfigsResponse)
async def get_module_configs(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("admin"))
):
    """
    获取所有模块配置（仅管理员）
    """
    configs = await CreditService.get_all_module_configs(db)

    items = [
        ModuleConfigItem(
            id=c.id,
            module_key=c.module_key,
            module_name=c.module_name,
            cost_per_unit=str(c.cost_per_unit),
            unit_description=c.unit_description,
            is_enabled=c.is_enabled,
            created_at=c.created_at.isoformat(),
            updated_at=c.updated_at.isoformat()
        )
        for c in configs
    ]

    return ModuleConfigsResponse(items=items)


@router.put("/module-configs/{module_key}", response_model=ModuleConfigItem)
async def update_module_config(
    module_key: str,
    body: UpdateModuleConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("admin"))
):
    """
    更新模块配置（仅管理员）
    """
    cost_per_unit = None
    if body.cost_per_unit:
        try:
            cost_per_unit = Decimal(body.cost_per_unit)
            if cost_per_unit < 0:
                raise ValueError()
        except Exception:
            raise HTTPException(status_code=400, detail="无效的消费点数")

    config = await CreditService.update_module_config(
        db=db,
        module_key=module_key,
        cost_per_unit=cost_per_unit,
        module_name=body.module_name,
        unit_description=body.unit_description,
        is_enabled=body.is_enabled
    )

    if config is None:
        raise HTTPException(status_code=404, detail="模块配置不存在")

    await db.commit()

    return ModuleConfigItem(
        id=config.id,
        module_key=config.module_key,
        module_name=config.module_name,
        cost_per_unit=str(config.cost_per_unit),
        unit_description=config.unit_description,
        is_enabled=config.is_enabled,
        created_at=config.created_at.isoformat(),
        updated_at=config.updated_at.isoformat()
    )


@router.put("/accounts/{user_id}/threshold")
async def update_threshold(
    user_id: int,
    body: UpdateThresholdRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("admin"))
):
    """
    更新用户预警阈值（仅管理员）
    """
    try:
        threshold = Decimal(body.threshold)
        if threshold < 0:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="无效的阈值")

    account = await CreditService.get_or_create_account(db, user_id)
    account.low_balance_threshold = threshold
    await db.commit()

    return {"ok": True, "threshold": str(threshold)}
