"""OZON聊天REST API路由"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, Field
import logging

from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ..models.ozon_shops import OzonShop
from ..services.chat_service import OzonChatService
from ..api.client import OzonAPIClient
from sqlalchemy import select
from ef_core.database import get_db_manager


router = APIRouter(prefix="/chats", tags=["ozon-chats"])
logger = logging.getLogger(__name__)


@router.get("/all")
async def get_all_chats(
    shop_ids: str = Query(..., description="店铺ID列表，逗号分隔"),
    status: Optional[str] = Query(None, description="聊天状态筛选 (open/closed)"),
    has_unread: Optional[bool] = Query(None, description="是否有未读消息"),
    is_archived: Optional[bool] = Query(None, description="是否已归档"),
    order_number: Optional[str] = Query(None, description="订单号筛选"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    user: User = Depends(get_current_user)
):
    """获取多个店铺的聊天列表

    Args:
        shop_ids: 店铺ID列表，逗号分隔（如 "1,2,3"）
        status: 聊天状态 (open/closed)
        has_unread: 是否有未读消息
        is_archived: 是否已归档
        order_number: 订单号
        limit: 每页数量 (1-100)
        offset: 偏移量

    Returns:
        {
            "ok": true,
            "data": {
                "items": [...],  # 每个item包含shop_name字段
                "total": int,
                "limit": int,
                "offset": int
            }
        }
    """
    try:
        # 解析店铺ID列表
        shop_id_list = [int(sid.strip()) for sid in shop_ids.split(',') if sid.strip()]

        if not shop_id_list:
            return {"ok": True, "data": {"items": [], "total": 0, "limit": limit, "offset": offset}}

        # 使用店铺ID列表查询
        service = OzonChatService(shop_id=None, shop_ids=shop_id_list)
        result = await service.get_chats(
            status=status,
            has_unread=has_unread,
            is_archived=is_archived,
            order_number=order_number,
            limit=limit,
            offset=offset
        )
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.get("/all/stats")
async def get_all_chat_stats(
    shop_ids: str = Query(..., description="店铺ID列表，逗号分隔"),
    user: User = Depends(get_current_user)
):
    """获取多个店铺的聊天统计信息

    Args:
        shop_ids: 店铺ID列表，逗号分隔（如 "1,2,3"）

    Returns:
        {
            "ok": true,
            "data": {
                "total_chats": int,
                "active_chats": int,
                "total_unread": int,
                "unread_chats": int
            }
        }
    """
    try:
        # 解析店铺ID列表
        shop_id_list = [int(sid.strip()) for sid in shop_ids.split(',') if sid.strip()]

        if not shop_id_list:
            return {"ok": True, "data": {"total_chats": 0, "active_chats": 0, "total_unread": 0, "unread_chats": 0}}

        service = OzonChatService(shop_id=None, shop_ids=shop_id_list)
        result = await service.get_chat_stats()
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


class SendMessageRequest(BaseModel):
    """发送消息请求"""
    content: str = Field(..., min_length=1, description="消息内容")


class SendFileRequest(BaseModel):
    """发送文件请求"""
    base64_content: str = Field(..., description="base64编码的文件内容")
    file_name: str = Field(..., min_length=1, max_length=255, description="文件名（含扩展名）")


async def get_shop_and_client(
    shop_id: int,
    user: User = Depends(get_current_user)
) -> tuple[OzonShop, OzonAPIClient]:
    """获取店铺和API客户端（依赖注入）"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        stmt = select(OzonShop).where(OzonShop.id == shop_id)
        shop = await session.scalar(stmt)

        if not shop:
            raise HTTPException(
                status_code=404,
                detail={
                    "type": "about:blank",
                    "title": "Shop Not Found",
                    "status": 404,
                    "detail": f"Shop {shop_id} not found",
                    "code": "SHOP_NOT_FOUND"
                }
            )

        # TODO: 验证用户是否有权限访问此店铺
        # if shop.user_id != user.id:
        #     raise HTTPException(status_code=403, detail="Access denied")

        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        )

        # 让shop对象脱离session，避免session关闭后无法访问
        session.expunge(shop)

        return shop, client


@router.get("/{shop_id}")
async def get_chats(
    shop_id: int,
    status: Optional[str] = Query(None, description="聊天状态筛选 (open/closed)"),
    has_unread: Optional[bool] = Query(None, description="是否有未读消息"),
    is_archived: Optional[bool] = Query(None, description="是否已归档"),
    order_number: Optional[str] = Query(None, description="订单号筛选"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    user: User = Depends(get_current_user)
):
    """获取聊天列表

    Args:
        shop_id: 店铺ID
        status: 聊天状态 (open/closed)
        has_unread: 是否有未读消息
        is_archived: 是否已归档
        order_number: 订单号
        limit: 每页数量 (1-100)
        offset: 偏移量

    Returns:
        {
            "ok": true,
            "data": {
                "items": [...],
                "total": int,
                "limit": int,
                "offset": int
            }
        }
    """
    try:
        service = OzonChatService(shop_id)
        result = await service.get_chats(
            status=status,
            has_unread=has_unread,
            is_archived=is_archived,
            order_number=order_number,
            limit=limit,
            offset=offset
        )
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.get("/{shop_id}/stats")
async def get_chat_stats(
    shop_id: int,
    user: User = Depends(get_current_user)
):
    """获取聊天统计信息

    Args:
        shop_id: 店铺ID

    Returns:
        {
            "ok": true,
            "data": {
                "total_chats": int,
                "active_chats": int,
                "total_unread": int,
                "unread_chats": int
            }
        }
    """
    try:
        service = OzonChatService(shop_id)
        result = await service.get_chat_stats()
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.get("/{shop_id}/{chat_id}")
async def get_chat_detail(
    shop_id: int,
    chat_id: str,
    user: User = Depends(get_current_user)
):
    """获取聊天详情

    Args:
        shop_id: 店铺ID
        chat_id: 聊天ID

    Returns:
        {
            "ok": true,
            "data": {...}
        }
    """
    try:
        service = OzonChatService(shop_id)
        chat = await service.get_chat_detail(chat_id)

        if not chat:
            raise HTTPException(
                status_code=404,
                detail={
                    "type": "about:blank",
                    "title": "Chat Not Found",
                    "status": 404,
                    "detail": f"Chat {chat_id} not found",
                    "code": "CHAT_NOT_FOUND"
                }
            )

        return {"ok": True, "data": chat}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.get("/{shop_id}/{chat_id}/messages")
async def get_chat_messages(
    shop_id: int,
    chat_id: str,
    limit: int = Query(50, ge=1, le=100, description="每页数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    before_message_id: Optional[str] = Query(None, description="获取此消息之前的消息"),
    user: User = Depends(get_current_user)
):
    """获取聊天消息列表

    Args:
        shop_id: 店铺ID
        chat_id: 聊天ID
        limit: 每页数量 (1-100)
        offset: 偏移量
        before_message_id: 获取此消息之前的消息

    Returns:
        {
            "ok": true,
            "data": {
                "items": [...],
                "total": int,
                "chat_id": str
            }
        }
    """
    try:
        service = OzonChatService(shop_id)
        result = await service.get_messages(
            chat_id=chat_id,
            limit=limit,
            offset=offset,
            before_message_id=before_message_id
        )
        return {"ok": True, "data": result}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.post("/{shop_id}/{chat_id}/messages")
async def send_message(
    shop_id: int,
    chat_id: str,
    request: SendMessageRequest,
    shop_and_client: tuple = Depends(get_shop_and_client)
):
    """发送文本消息

    Args:
        shop_id: 店铺ID
        chat_id: 聊天ID
        request: 消息内容

    Returns:
        {
            "ok": true,
            "data": {...}
        }
    """
    try:
        shop, client = shop_and_client
        service = OzonChatService(shop_id)

        result = await service.send_message(
            chat_id=chat_id,
            content=request.content,
            api_client=client
        )

        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(
            status_code=404,
            detail={
                "type": "about:blank",
                "title": "Chat Not Found",
                "status": 404,
                "detail": str(e),
                "code": "CHAT_NOT_FOUND"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.post("/{shop_id}/{chat_id}/files")
async def send_file(
    shop_id: int,
    chat_id: str,
    request: SendFileRequest,
    shop_and_client: tuple = Depends(get_shop_and_client)
):
    """发送文件消息

    Args:
        shop_id: 店铺ID
        chat_id: 聊天ID
        request: 文件信息（base64_content + file_name）

    Returns:
        {
            "ok": true,
            "data": {...}
        }
    """
    try:
        shop, client = shop_and_client
        service = OzonChatService(shop_id)

        result = await service.send_file(
            chat_id=chat_id,
            base64_content=request.base64_content,
            file_name=request.file_name,
            api_client=client
        )

        return {"ok": True, "data": result}
    except ValueError as e:
        # 业务逻辑错误（聊天不存在、文件大小/类型错误）
        # 根据错误信息判断具体的状态码
        error_message = str(e).lower()
        if "not found" in error_message:
            status_code = 404
            code = "CHAT_NOT_FOUND"
            title = "Chat Not Found"
        elif "size" in error_message or "type" in error_message:
            status_code = 400
            code = "INVALID_FILE"
            title = "Invalid File"
        else:
            status_code = 400
            code = "VALIDATION_ERROR"
            title = "Validation Error"

        raise HTTPException(
            status_code=status_code,
            detail={
                "type": "about:blank",
                "title": title,
                "status": status_code,
                "detail": str(e),
                "code": code
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.post("/{shop_id}/{chat_id}/read")
async def mark_chat_as_read(
    shop_id: int,
    chat_id: str,
    shop_and_client: tuple = Depends(get_shop_and_client)
):
    """标记聊天为已读

    Args:
        shop_id: 店铺ID
        chat_id: 聊天ID

    Returns:
        {
            "ok": true,
            "data": {...}
        }
    """
    try:
        shop, client = shop_and_client
        service = OzonChatService(shop_id)

        result = await service.mark_as_read(
            chat_id=chat_id,
            api_client=client
        )

        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(
            status_code=404,
            detail={
                "type": "about:blank",
                "title": "Chat Not Found",
                "status": 404,
                "detail": str(e),
                "code": "CHAT_NOT_FOUND"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.post("/{shop_id}/{chat_id}/archive")
async def archive_chat(
    shop_id: int,
    chat_id: str,
    request: dict = Body(...),
    user: User = Depends(get_current_user)
):
    """归档/取消归档聊天

    Args:
        shop_id: 店铺ID
        chat_id: 聊天ID
        request: 请求体，包含 is_archived 字段

    Returns:
        {
            "ok": true,
            "data": {...}
        }
    """
    try:
        is_archived = request.get("is_archived", True)
        service = OzonChatService(shop_id)

        result = await service.archive_chat(
            chat_id=chat_id,
            is_archived=is_archived
        )

        return {"ok": True, "data": result}
    except ValueError as e:
        raise HTTPException(
            status_code=404,
            detail={
                "type": "about:blank",
                "title": "Chat Not Found",
                "status": 404,
                "detail": str(e),
                "code": "CHAT_NOT_FOUND"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.post("/{shop_id}/sync")
async def sync_chats(
    shop_id: int,
    chat_id_list: Optional[list[str]] = Body(None, description="要同步的聊天ID列表"),
    shop_and_client: tuple = Depends(get_shop_and_client)
):
    """从OZON同步聊天数据（异步任务模式）

    Args:
        shop_id: 店铺ID
        chat_id_list: 要同步的聊天ID列表（为空则同步全部）

    Returns:
        {
            "ok": true,
            "data": {
                "task_id": str,
                "message": str
            }
        }
    """
    import uuid
    import asyncio
    from ef_core.database import get_db_manager

    shop, _ = shop_and_client

    # 生成任务ID
    task_id = f"chat_sync_{uuid.uuid4().hex[:12]}"

    # 定义异步任务
    async def run_sync():
        """后台运行聊天同步"""
        try:
            logger.info(f"Starting chat sync task: task_id={task_id}, shop_id={shop_id}")

            # 创建新的数据库会话和API客户端
            db_manager = get_db_manager()

            # 重新获取店铺信息并创建客户端
            from ..models.ozon_shops import OzonShop
            from ..api.client import OzonAPIClient
            from sqlalchemy import select

            async with db_manager.get_session() as session:
                shop_result = await session.execute(
                    select(OzonShop).where(OzonShop.id == shop_id)
                )
                shop_obj = shop_result.scalar_one_or_none()

                if not shop_obj:
                    logger.error(f"Shop {shop_id} not found")
                    return

                # 创建API客户端
                client = OzonAPIClient(
                    client_id=shop_obj.client_id,
                    api_key=shop_obj.api_key_enc
                )

                try:
                    # 执行同步
                    service = OzonChatService(shop_id)
                    result = await service.sync_chats(
                        api_client=client,
                        chat_id_list=chat_id_list,
                        sync_messages=True,
                        task_id=task_id
                    )

                    logger.info(f"Chat sync completed: {result}")

                finally:
                    # 关闭API客户端
                    await client.close()

        except Exception as e:
            logger.error(f"Chat sync failed: {e}")
            import traceback
            logger.error(traceback.format_exc())

    # 创建异步任务
    asyncio.create_task(run_sync())

    logger.info(f"Created chat sync task: task_id={task_id}, shop_id={shop_id}")

    return {
        "ok": True,
        "data": {
            "task_id": task_id,
            "message": "聊天同步任务已启动"
        }
    }