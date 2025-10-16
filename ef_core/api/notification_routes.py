"""
WebSocket通知路由
提供实时通知WebSocket连接端点
"""
import asyncio
import json
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends, HTTPException
from sqlalchemy import select
from ef_core.websocket.manager import notification_manager
from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ef_core.services.auth_service import get_auth_service
from ef_core.database import get_db_manager
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


async def get_user_from_ws_token(token: str) -> User:
    """
    从WebSocket查询参数中的token获取用户

    Args:
        token: JWT token

    Returns:
        User对象

    Raises:
        HTTPException: 认证失败
    """
    try:
        auth_service = get_auth_service()

        # 解码令牌
        payload = auth_service.decode_token(token)

        # 验证令牌类型
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")

        # 检查黑名单
        jti = payload.get("jti")
        if await auth_service.is_token_revoked(jti):
            raise HTTPException(status_code=401, detail="Token has been revoked")

        # 获取用户
        user_id = payload.get("sub")
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(User).where(User.id == int(user_id))
            result = await session.execute(stmt)
            user = result.scalar_one_or_none()

            if not user or not user.is_active:
                raise HTTPException(status_code=401, detail="User not found or inactive")

            # 让user对象脱离session
            session.expunge(user)
            return user

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"WebSocket authentication failed: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(..., description="JWT认证token"),
    shop_ids: Optional[str] = Query(None, description="订阅的店铺ID列表（逗号分隔）")
):
    """
    WebSocket通知连接端点

    Args:
        websocket: WebSocket连接对象
        token: JWT认证token（从query string获取）
        shop_ids: 订阅的店铺ID列表，用逗号分隔，例如："1,2,3"

    WebSocket消息格式：

    服务端发送：
    ```json
    {
        "type": "connected|ping|chat.new_message|chat.message_updated|...",
        "shop_id": 1,  // 可选，消息相关的店铺ID
        "data": {...},  // 消息数据
        "timestamp": "2025-01-01T12:00:00Z"
    }
    ```

    客户端发送：
    ```json
    {
        "type": "ping|subscribe|unsubscribe",
        "shop_ids": [1, 2, 3]  // 可选，仅用于subscribe/unsubscribe
    }
    ```
    """
    user: Optional[User] = None

    try:
        # 认证
        user = await get_user_from_ws_token(token)
        logger.info(f"WebSocket authentication successful: user_id={user.id}")

        # 解析店铺ID列表
        parsed_shop_ids = None
        if shop_ids:
            try:
                parsed_shop_ids = [int(sid.strip()) for sid in shop_ids.split(",") if sid.strip()]
            except ValueError:
                logger.warning(f"Invalid shop_ids format: {shop_ids}")

        # 注册连接
        await notification_manager.connect(websocket, user.id, parsed_shop_ids)

        # 保持连接并处理消息
        heartbeat_task = asyncio.create_task(heartbeat_loop(websocket))

        try:
            while True:
                # 接收客户端消息
                data = await websocket.receive_text()

                try:
                    message = json.loads(data)
                    msg_type = message.get("type")

                    if msg_type == "ping":
                        # 响应心跳
                        await websocket.send_json({"type": "pong"})

                    elif msg_type == "subscribe":
                        # 订阅新店铺
                        new_shop_ids = message.get("shop_ids", [])
                        if user.id in notification_manager._user_shops:
                            notification_manager._user_shops[user.id].update(new_shop_ids)
                        else:
                            notification_manager._user_shops[user.id] = set(new_shop_ids)
                        logger.info(f"User {user.id} subscribed to shops: {new_shop_ids}")
                        await websocket.send_json({"type": "subscribed", "shop_ids": new_shop_ids})

                    elif msg_type == "unsubscribe":
                        # 取消订阅店铺
                        remove_shop_ids = message.get("shop_ids", [])
                        if user.id in notification_manager._user_shops:
                            notification_manager._user_shops[user.id].difference_update(remove_shop_ids)
                        logger.info(f"User {user.id} unsubscribed from shops: {remove_shop_ids}")
                        await websocket.send_json({"type": "unsubscribed", "shop_ids": remove_shop_ids})

                    else:
                        logger.warning(f"Unknown message type from user {user.id}: {msg_type}")

                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from user {user.id}: {data}")
                except Exception as e:
                    logger.error(f"Error processing message from user {user.id}: {e}")

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected normally: user_id={user.id}")
        finally:
            # 取消心跳任务
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    except HTTPException as e:
        logger.warning(f"WebSocket authentication failed: {e.detail}")
        await websocket.close(code=1008, reason="Authentication failed")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        # 确保连接被清理
        if user:
            await notification_manager.disconnect(websocket)


async def heartbeat_loop(websocket: WebSocket):
    """
    心跳循环，每30秒发送一次ping

    Args:
        websocket: WebSocket连接
    """
    try:
        while True:
            await asyncio.sleep(30)
            await notification_manager.send_ping(websocket)
    except asyncio.CancelledError:
        logger.debug("Heartbeat loop cancelled")
    except Exception as e:
        logger.error(f"Heartbeat loop error: {e}")


@router.get("/stats")
async def get_notification_stats(user: User = Depends(get_current_user)):
    """
    获取WebSocket连接统计信息（管理员）

    Returns:
        {
            "ok": true,
            "data": {
                "total_connections": int,
                "unique_users": int,
                "subscribed_shops": int,
                "users_by_shop": {...}
            }
        }
    """
    # TODO: 添加管理员权限检查
    stats = notification_manager.get_stats()
    return {"ok": True, "data": stats}
