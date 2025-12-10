"""
取消和退货申请管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime, date

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
    order_number: Optional[str]
    client_name: Optional[str]
    product_name: Optional[str]
    offer_id: Optional[str]
    sku: Optional[int]
    price: Optional[str]
    currency_code: Optional[str]
    group_state: str
    state: str  # 详细状态标识（如 CanceledByBuyer）
    state_name: Optional[str]
    money_return_state_name: Optional[str]
    delivery_method_name: Optional[str]  # 物流方式（从posting表join获取）
    # 从详情API获取的字段
    return_reason_id: Optional[int]
    return_reason_name: Optional[str]
    rejection_reason_id: Optional[int]
    rejection_reason_name: Optional[str]
    return_method_description: Optional[str]
    created_at_ozon: Optional[str]
    # 商品图片（从商品表JOIN获取）
    image_url: Optional[str]


class ReturnListResponse(BaseModel):
    """退货申请列表响应"""
    items: list[ReturnItemResponse]
    total: int
    page: int
    limit: int


class SyncRequest(BaseModel):
    """同步请求"""
    shop_id: Optional[int] = Field(None, description="店铺ID（不传则同步所有店铺）")


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
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取取消申请列表

    权限要求：
    - admin: 可查看所有店铺
    - manager/sub_account: 只能查看已授权店铺
    """
    # 权限校验：过滤用户有权限的店铺
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        # 用户没有任何店铺权限，直接返回空结果
        if allowed_shop_ids is not None and len(allowed_shop_ids) == 0:
            return CancellationListResponse(items=[], total=0, page=page, limit=limit)
        if shop_id and allowed_shop_ids and shop_id not in allowed_shop_ids:
            problem(403, "SHOP_ACCESS_DENIED", "您没有权限查看该店铺的数据")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 构建筛选条件
    filters = {}
    if state:
        filters["state"] = state
    if initiator:
        filters["initiator"] = initiator
    if posting_number:
        filters["posting_number"] = posting_number
    if date_from:
        # 转换为 datetime (开始时间设为00:00:00)
        filters["date_from"] = datetime.fromisoformat(f"{date_from}T00:00:00")
    if date_to:
        # 转换为 datetime (结束时间设为23:59:59)
        filters["date_to"] = datetime.fromisoformat(f"{date_to}T23:59:59")

    # 调用服务层
    # 注意：shop_id 用于前端指定的店铺，allowed_shop_ids 用于权限过滤
    # - 如果用户指定了 shop_id，使用该值
    # - 如果用户没有指定且 allowed_shop_ids 为 None（admin），不过滤店铺
    # - 如果用户没有指定且 allowed_shop_ids 为列表，只查询授权的店铺
    service = CancelReturnService()
    result = await service.get_cancellation_list(
        shop_id=shop_id,
        shop_ids=allowed_shop_ids,  # 权限过滤
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
    date_from: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取退货申请列表

    权限要求：
    - admin: 可查看所有店铺
    - manager/sub_account: 只能查看已授权店铺
    """
    # 权限校验：过滤用户有权限的店铺
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, shop_id)
        # 用户没有任何店铺权限，直接返回空结果
        if allowed_shop_ids is not None and len(allowed_shop_ids) == 0:
            return ReturnListResponse(items=[], total=0, page=page, limit=limit)
        if shop_id and allowed_shop_ids and shop_id not in allowed_shop_ids:
            problem(403, "SHOP_ACCESS_DENIED", "您没有权限查看该店铺的数据")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    # 构建筛选条件
    filters = {}
    if group_state:
        filters["group_state"] = group_state
    if posting_number:
        filters["posting_number"] = posting_number
    if offer_id:
        filters["offer_id"] = offer_id
    if date_from:
        # 转换为 datetime (开始时间设为00:00:00)
        filters["date_from"] = datetime.fromisoformat(f"{date_from}T00:00:00")
    if date_to:
        # 转换为 datetime (结束时间设为23:59:59)
        filters["date_to"] = datetime.fromisoformat(f"{date_to}T23:59:59")

    # 调用服务层
    service = CancelReturnService()
    result = await service.get_return_list(
        shop_id=shop_id,
        shop_ids=allowed_shop_ids,  # 权限过滤
        page=page,
        limit=limit,
        filters=filters
    )

    return result


@router.get("/returns/{return_id}", response_model=ReturnItemResponse)
async def get_return_detail(
    return_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    获取退货申请详情

    权限要求：
    - admin: 可查看所有店铺
    - manager/sub_account: 只能查看已授权店铺
    """
    # 调用服务层
    service = CancelReturnService()
    result = await service.get_return_detail(return_id=return_id, current_user=current_user, db=db)

    if not result:
        problem(404, "RETURN_NOT_FOUND", "退货申请不存在")

    return result


@router.post("/cancellations/sync")
async def sync_cancellations(
    request: SyncRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    手动同步取消申请（异步）

    权限要求：
    - 任何登录用户可触发同步（同步用户有权限的店铺）
    - 必须指定店铺ID
    """
    import logging
    import uuid
    import asyncio
    logger = logging.getLogger(__name__)
    logger.info(f"收到取消申请同步请求，shop_id={request.shop_id}, user={current_user.username}")

    # 必须指定店铺
    if request.shop_id is None:
        return {
            "ok": False,
            "error": "请先选择店铺"
        }

    # 校验店铺权限
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, request.shop_id)
        logger.info(f"用户有权限的店铺: {allowed_shop_ids}")
        if allowed_shop_ids is None:
            # admin 用户，检查店铺是否存在
            pass
        elif len(allowed_shop_ids) == 0 or request.shop_id not in allowed_shop_ids:
            return {
                "ok": False,
                "error": "您没有权限操作该店铺"
            }
    except PermissionError as e:
        return {
            "ok": False,
            "error": str(e)
        }

    # 生成任务ID
    task_id = f"cancellation_sync_{uuid.uuid4().hex[:12]}"

    # 异步执行同步任务
    async def run_sync():
        """在后台执行同步任务"""
        from ..services.ozon_sync import SYNC_TASKS
        from ..utils.datetime_utils import utcnow

        try:
            # 初始化任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在同步取消申请，请稍候...",
                "started_at": utcnow().isoformat(),
                "type": "cancellations",
            }

            # 进度更新回调函数
            async def update_progress(progress: int, message: str):
                SYNC_TASKS[task_id].update({
                    "progress": progress,
                    "message": message
                })

            # 创建新的数据库会话用于异步任务
            from ef_core.database import get_db_manager
            db_manager = get_db_manager()
            async with db_manager.get_session() as task_db:
                # 调用服务层同步
                service = CancelReturnService()
                result = await service.sync_cancellations(
                    config={"shop_id": request.shop_id},
                    progress_callback=update_progress
                )

                # 更新任务为完成状态
                SYNC_TASKS[task_id] = {
                    "status": "completed",
                    "progress": 100,
                    "message": result.get("message", "同步完成"),
                    "completed_at": utcnow().isoformat(),
                    "type": "cancellations",
                    "result": {
                        "records_synced": result.get("records_synced", 0),
                        "records_updated": result.get("records_updated", 0)
                    }
                }
                logger.info(f"取消申请同步完成，task_id={task_id}")

        except Exception as e:
            # 更新任务为失败状态
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"同步失败: {str(e)}",
                "error": str(e),
                "failed_at": utcnow().isoformat(),
                "type": "cancellations",
            }
            logger.error(f"取消申请同步失败: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # 在后台启动同步任务
    asyncio.create_task(run_sync())

    return {
        "ok": True,
        "data": {
            "task_id": task_id,
            "message": "取消申请同步已启动"
        }
    }


@router.post("/returns/sync")
async def sync_returns(
    request: SyncRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """
    手动同步退货申请（异步）

    权限要求：
    - 任何登录用户可触发同步（同步用户有权限的店铺）
    - 必须指定店铺ID
    """
    import logging
    import uuid
    import asyncio
    logger = logging.getLogger(__name__)
    logger.info(f"收到退货申请同步请求，shop_id={request.shop_id}, user={current_user.username}")

    # 必须指定店铺
    if request.shop_id is None:
        return {
            "ok": False,
            "error": "请先选择店铺"
        }

    # 校验店铺权限
    try:
        allowed_shop_ids = await filter_by_shop_permission(current_user, db, request.shop_id)
        logger.info(f"用户有权限的店铺: {allowed_shop_ids}")
        if allowed_shop_ids is None:
            # admin 用户，检查店铺是否存在
            pass
        elif len(allowed_shop_ids) == 0 or request.shop_id not in allowed_shop_ids:
            return {
                "ok": False,
                "error": "您没有权限操作该店铺"
            }
    except PermissionError as e:
        return {
            "ok": False,
            "error": str(e)
        }

    # 生成任务ID
    task_id = f"return_sync_{uuid.uuid4().hex[:12]}"

    # 异步执行同步任务
    async def run_sync():
        """在后台执行同步任务"""
        from ..services.ozon_sync import SYNC_TASKS
        from ..utils.datetime_utils import utcnow

        try:
            # 初始化任务状态
            SYNC_TASKS[task_id] = {
                "status": "running",
                "progress": 0,
                "message": "正在同步退货申请，请稍候...",
                "started_at": utcnow().isoformat(),
                "type": "returns",
            }

            # 进度更新回调函数
            async def update_progress(progress: int, message: str):
                SYNC_TASKS[task_id].update({
                    "progress": progress,
                    "message": message
                })

            # 创建新的数据库会话用于异步任务
            from ef_core.database import get_db_manager
            db_manager = get_db_manager()
            async with db_manager.get_session() as task_db:
                # 调用服务层同步
                service = CancelReturnService()
                result = await service.sync_returns(
                    config={"shop_id": request.shop_id},
                    progress_callback=update_progress
                )

                # 更新任务为完成状态
                SYNC_TASKS[task_id] = {
                    "status": "completed",
                    "progress": 100,
                    "message": result.get("message", "同步完成"),
                    "completed_at": utcnow().isoformat(),
                    "type": "returns",
                    "result": {
                        "records_synced": result.get("records_synced", 0),
                        "records_updated": result.get("records_updated", 0)
                    }
                }
                logger.info(f"退货申请同步完成，task_id={task_id}")

        except Exception as e:
            # 更新任务为失败状态
            SYNC_TASKS[task_id] = {
                "status": "failed",
                "progress": SYNC_TASKS.get(task_id, {}).get("progress", 0),
                "message": f"同步失败: {str(e)}",
                "error": str(e),
                "failed_at": utcnow().isoformat(),
                "type": "returns",
            }
            logger.error(f"退货申请同步失败: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # 在后台启动同步任务
    asyncio.create_task(run_sync())

    return {
        "ok": True,
        "data": {
            "task_id": task_id,
            "message": "退货申请同步已启动"
        }
    }
