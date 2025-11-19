"""
取消和退货申请管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from .permissions import filter_by_shop_permission
from ..services.cancel_return_service import CancelReturnService

router = APIRouter(prefix="/cancel-return", tags=["Cancel & Return"])


def problem(status: int, code: str, title: str, detail: str | None = None):
    """抛出 Problem Details 格式的错误"""
    raise HTTPException(status_code=status, detail={
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code
    })


# ============================
# Pydantic Schema 定义
# ============================

class CancellationItemResponse(BaseModel):
    """取消申请响应"""
    id: int
    cancellation_id: int
    posting_number: str
    order_date: Optional[str]
    cancelled_at: Optional[str]
    cancellation_initiator: Optional[str]
    cancellation_reason_name: Optional[str]
    state: str
    state_name: Optional[str]
    auto_approve_date: Optional[str]


class CancellationListResponse(BaseModel):
    """取消申请列表响应"""
    items: list[CancellationItemResponse]
    total: int
    page: int
    limit: int


class ReturnItemResponse(BaseModel):
    """退货申请响应"""
    id: int
    return_id: int
    return_number: str
    posting_number: str
    client_name: Optional[str]
    product_name: Optional[str]
    offer_id: Optional[str]
    sku: Optional[int]
    price: Optional[str]
    currency_code: Optional[str]
    group_state: str
    state_name: Optional[str]
    money_return_state_name: Optional[str]
    created_at_ozon: Optional[str]


class ReturnListResponse(BaseModel):
    """退货申请列表响应"""
    items: list[ReturnItemResponse]
    total: int
    page: int
    limit: int


class SyncRequest(BaseModel):
    """同步请求"""
    shop_id: int = Field(..., description="店铺ID")


class SyncResponse(BaseModel):
    """同步响应"""
    task_id: str
    message: str


# ============================
# API 端点
# ============================

@router.get("/cancellations", response_model=CancellationListResponse)
async def get_cancellations(
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(50, ge=1, le=100, description="每页数量"),
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    state: Optional[str] = Query(None, description="状态筛选"),
    initiator: Optional[str] = Query(None, description="发起人筛选"),
    posting_number: Optional[str] = Query(None, description="货件编号搜索"),
    date_from: Optional[datetime] = Query(None, description="开始日期"),
    date_to: Optional[datetime] = Query(None, description="结束日期"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取取消申请列表

    权限要求：
    - admin: 可查看所有店铺
    - operator: 只能查看已授权店铺
    - viewer: 只读权限
    """
    # 权限校验：过滤用户有权限的店铺
    if shop_id:
        allowed_shop_ids = await filter_by_shop_permission(
            db=db,
            user=current_user,
            channel="ozon",
            shop_ids=[shop_id]
        )
        if shop_id not in allowed_shop_ids:
            problem(403, "SHOP_ACCESS_DENIED", "您没有权限查看该店铺的数据")
        filtered_shop_id = shop_id
    else:
        # 如果未指定店铺，返回所有有权限的店铺数据
        allowed_shop_ids = await filter_by_shop_permission(
            db=db,
            user=current_user,
            channel="ozon"
        )
        filtered_shop_id = None  # None表示查询所有有权限的店铺

    # 构建筛选条件
    filters = {}
    if state:
        filters["state"] = state
    if initiator:
        filters["initiator"] = initiator
    if posting_number:
        filters["posting_number"] = posting_number
    if date_from:
        filters["date_from"] = date_from
    if date_to:
        filters["date_to"] = date_to

    # 调用服务层
    service = CancelReturnService()
    result = await service.get_cancellation_list(
        shop_id=filtered_shop_id,
        page=page,
        limit=limit,
        filters=filters
    )

    return result


@router.get("/returns", response_model=ReturnListResponse)
async def get_returns(
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(50, ge=1, le=100, description="每页数量"),
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    group_state: Optional[str] = Query(None, description="状态组筛选"),
    posting_number: Optional[str] = Query(None, description="货件编号搜索"),
    offer_id: Optional[str] = Query(None, description="Offer ID搜索"),
    date_from: Optional[datetime] = Query(None, description="开始日期"),
    date_to: Optional[datetime] = Query(None, description="结束日期"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取退货申请列表

    权限要求：
    - admin: 可查看所有店铺
    - operator: 只能查看已授权店铺
    - viewer: 只读权限
    """
    # 权限校验：过滤用户有权限的店铺
    if shop_id:
        allowed_shop_ids = await filter_by_shop_permission(
            db=db,
            user=current_user,
            channel="ozon",
            shop_ids=[shop_id]
        )
        if shop_id not in allowed_shop_ids:
            problem(403, "SHOP_ACCESS_DENIED", "您没有权限查看该店铺的数据")
        filtered_shop_id = shop_id
    else:
        # 如果未指定店铺，返回所有有权限的店铺数据
        allowed_shop_ids = await filter_by_shop_permission(
            db=db,
            user=current_user,
            channel="ozon"
        )
        filtered_shop_id = None  # None表示查询所有有权限的店铺

    # 构建筛选条件
    filters = {}
    if group_state:
        filters["group_state"] = group_state
    if posting_number:
        filters["posting_number"] = posting_number
    if offer_id:
        filters["offer_id"] = offer_id
    if date_from:
        filters["date_from"] = date_from
    if date_to:
        filters["date_to"] = date_to

    # 调用服务层
    service = CancelReturnService()
    result = await service.get_return_list(
        shop_id=filtered_shop_id,
        page=page,
        limit=limit,
        filters=filters
    )

    return result


@router.post("/cancellations/sync")
async def sync_cancellations(
    request: SyncRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    手动同步取消申请

    权限要求：
    - admin/operator: 可触发同步
    - viewer: 无权限
    """
    # 权限校验：只有 admin 和 operator 可以触发同步
    if current_user.role == "viewer":
        problem(403, "PERMISSION_DENIED", "您没有权限执行此操作")

    # 校验店铺权限
    allowed_shop_ids = await filter_by_shop_permission(
        db=db,
        user=current_user,
        channel="ozon",
        shop_ids=[request.shop_id]
    )
    if request.shop_id not in allowed_shop_ids:
        problem(403, "SHOP_ACCESS_DENIED", "您没有权限操作该店铺")

    # 调用服务层同步
    service = CancelReturnService()
    result = await service.sync_cancellations({"shop_id": request.shop_id})

    return {
        "ok": True,
        "data": {
            "task_id": "manual_sync",
            "message": result.get("message", "同步完成"),
            "synced": result.get("records_synced", 0),
            "updated": result.get("records_updated", 0)
        }
    }


@router.post("/returns/sync")
async def sync_returns(
    request: SyncRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    手动同步退货申请

    权限要求：
    - admin/operator: 可触发同步
    - viewer: 无权限
    """
    # 权限校验：只有 admin 和 operator 可以触发同步
    if current_user.role == "viewer":
        problem(403, "PERMISSION_DENIED", "您没有权限执行此操作")

    # 校验店铺权限
    allowed_shop_ids = await filter_by_shop_permission(
        db=db,
        user=current_user,
        channel="ozon",
        shop_ids=[request.shop_id]
    )
    if request.shop_id not in allowed_shop_ids:
        problem(403, "SHOP_ACCESS_DENIED", "您没有权限操作该店铺")

    # 调用服务层同步
    service = CancelReturnService()
    result = await service.sync_returns({"shop_id": request.shop_id})

    return {
        "ok": True,
        "data": {
            "task_id": "manual_sync",
            "message": result.get("message", "同步完成"),
            "synced": result.get("records_synced", 0),
            "updated": result.get("records_updated", 0)
        }
    }
