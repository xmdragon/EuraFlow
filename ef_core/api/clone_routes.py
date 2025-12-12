"""
超级管理员账号克隆 API 路由
"""
from pydantic import BaseModel, Field
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ef_core.services.auth_service import get_auth_service
from ef_core.services.clone_service import get_clone_service
from ef_core.services.audit_service import AuditService
from ef_core.database import get_async_session, get_db_manager
from ef_core.models.users import User
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import UnauthorizedError, ForbiddenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = get_logger(__name__)

router = APIRouter(prefix="/auth/clone", tags=["Clone Identity"])
security = HTTPBearer()


# ========== 响应模型 ==========

class CloneUserInfo(BaseModel):
    """克隆用户信息"""
    id: int
    username: str
    role: Optional[str] = None
    shop_ids: Optional[list] = None


class CloneSessionResponse(BaseModel):
    """克隆会话响应"""
    session_id: str
    original_user: CloneUserInfo
    cloned_user: CloneUserInfo
    expires_at: str
    remaining_seconds: int


class CloneResponse(BaseModel):
    """克隆响应"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    clone_session: CloneSessionResponse


class RestoreResponse(BaseModel):
    """恢复身份响应"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class CloneStatusResponse(BaseModel):
    """克隆状态响应"""
    is_cloned: bool
    session_id: Optional[str] = None
    original_user: Optional[CloneUserInfo] = None
    cloned_user: Optional[CloneUserInfo] = None
    expires_at: Optional[str] = None
    remaining_seconds: Optional[int] = None


# ========== 辅助函数 ==========

async def get_current_admin_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_async_session)
) -> tuple[User, dict]:
    """获取当前管理员用户和 Token 数据

    Returns:
        tuple[User, dict]: (用户对象, Token payload)
    """
    auth_service = get_auth_service()

    # 解码 Token
    payload = auth_service.decode_token(credentials.credentials)

    # 验证令牌类型
    if payload.get("type") != "access":
        raise UnauthorizedError(
            code="INVALID_TOKEN_TYPE",
            detail="Invalid token type"
        )

    # 检查黑名单
    jti = payload.get("jti")
    if await auth_service.is_token_revoked(jti):
        raise UnauthorizedError(
            code="TOKEN_REVOKED",
            detail="Token has been revoked"
        )

    # 获取用户
    user_id = int(payload.get("sub"))
    stmt = select(User).where(User.id == user_id).options(
        selectinload(User.shops)
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise UnauthorizedError(
            code="USER_NOT_FOUND",
            detail="User not found"
        )

    if not user.is_active:
        raise UnauthorizedError(
            code="USER_INACTIVE",
            detail="User account is inactive"
        )

    return user, payload


# ========== API 路由 ==========

@router.post("/{user_id}", response_model=CloneResponse, summary="克隆用户身份")
async def clone_identity(
    user_id: int,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_async_session)
):
    """
    克隆指定用户的身份

    - 仅超级管理员（role=admin）可以使用此功能
    - 仅能克隆 manager 角色的用户
    - 克隆后获得被克隆用户的店铺权限
    - 克隆有效期 30 分钟
    - 克隆期间不能访问用户管理和系统管理
    """
    admin_user, token_payload = await get_current_admin_user(request, credentials, session)

    # 验证是否为超级管理员
    if admin_user.role != "admin":
        raise ForbiddenError(
            code="NOT_ADMIN",
            detail="只有超级管理员可以克隆身份"
        )

    # 检查是否已经在克隆状态
    if token_payload.get("is_cloned"):
        raise ForbiddenError(
            code="ALREADY_CLONED",
            detail="已在克隆状态，请先恢复身份"
        )

    # 创建克隆会话
    clone_service = get_clone_service()
    clone_result = await clone_service.create_clone_session(
        admin_user=admin_user,
        target_user_id=user_id,
        original_token_data=token_payload
    )

    # 生成克隆 Token
    auth_service = get_auth_service()
    clone_token_data = clone_result["clone_token_data"]

    access_token = auth_service.create_access_token(clone_token_data)
    refresh_token = auth_service.create_refresh_token({
        "sub": clone_token_data["sub"],
        "is_cloned": True,
        "clone_session_id": clone_result["session_id"],
        "original_user_id": admin_user.id
    })

    # 记录审计日志
    db_manager = get_db_manager()
    async with db_manager.get_session() as audit_db:
        await AuditService.log_action(
            db=audit_db,
            user_id=admin_user.id,
            username=admin_user.username,
            module="user",
            action="clone_identity",
            action_display="克隆身份",
            table_name="users",
            record_id=str(user_id),
            changes={
                "cloned_user": {"new": clone_result["cloned_user"]["username"]},
                "session_id": {"new": clone_result["session_id"]},
                "expires_at": {"new": clone_result["expires_at"].isoformat()}
            },
            request=request
        )

    logger.info(
        "Identity cloned",
        admin_user_id=admin_user.id,
        admin_username=admin_user.username,
        cloned_user_id=user_id,
        cloned_username=clone_result["cloned_user"]["username"],
        session_id=clone_result["session_id"]
    )

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "clone_session": {
            "session_id": clone_result["session_id"],
            "original_user": clone_result["original_user"],
            "cloned_user": clone_result["cloned_user"],
            "expires_at": clone_result["expires_at"].isoformat(),
            "remaining_seconds": clone_result["remaining_seconds"]
        }
    }


@router.post("/restore", response_model=RestoreResponse, summary="恢复原始身份")
async def restore_identity(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_async_session)
):
    """
    恢复原始管理员身份

    - 仅在克隆状态下可用
    - 恢复后获得原始管理员的所有权限
    """
    auth_service = get_auth_service()

    # 解码 Token
    payload = auth_service.decode_token(credentials.credentials)

    # 验证是否在克隆状态
    if not payload.get("is_cloned"):
        raise ForbiddenError(
            code="NOT_CLONED",
            detail="当前不在克隆状态"
        )

    clone_session_id = payload.get("clone_session_id")
    if not clone_session_id:
        raise ForbiddenError(
            code="INVALID_CLONE_SESSION",
            detail="无效的克隆会话"
        )

    # 恢复会话
    clone_service = get_clone_service()
    restore_result = await clone_service.restore_session(clone_session_id)

    # 获取原始 Token 数据
    original_token_data = restore_result["original_token_data"]
    admin_user_id = restore_result["admin_user_id"]

    # 重新查询管理员用户以获取最新数据
    stmt = select(User).where(User.id == admin_user_id).options(
        selectinload(User.shops),
        selectinload(User.manager_level)
    )
    result = await session.execute(stmt)
    admin_user = result.scalar_one_or_none()

    if not admin_user:
        raise UnauthorizedError(
            code="ADMIN_NOT_FOUND",
            detail="管理员用户不存在"
        )

    # 生成新的管理员 Token
    shop_ids = None if admin_user.role == "admin" else [shop.id for shop in admin_user.shops] if admin_user.shops else []
    new_token_data = {
        "sub": str(admin_user.id),
        "username": admin_user.username,
        "role": admin_user.role,
        "permissions": admin_user.permissions,
        "shop_id": admin_user.primary_shop_id,
        "shop_ids": shop_ids,
        "session_token": original_token_data.get("session_token")
    }

    access_token = auth_service.create_access_token(new_token_data)
    refresh_token = auth_service.create_refresh_token({
        "sub": str(admin_user.id),
        "session_token": original_token_data.get("session_token")
    })

    # 记录审计日志
    db_manager = get_db_manager()
    async with db_manager.get_session() as audit_db:
        await AuditService.log_action(
            db=audit_db,
            user_id=admin_user.id,
            username=admin_user.username,
            module="user",
            action="restore_identity",
            action_display="恢复身份",
            table_name="users",
            record_id=str(admin_user.id),
            changes={
                "session_id": {"old": clone_session_id, "new": None}
            },
            request=request
        )

    logger.info(
        "Identity restored",
        admin_user_id=admin_user.id,
        admin_username=admin_user.username,
        session_id=clone_session_id
    )

    # 构建用户数据
    user_data = {
        "id": admin_user.id,
        "username": admin_user.username,
        "role": admin_user.role,
        "permissions": admin_user.permissions,
        "is_active": admin_user.is_active,
        "account_status": admin_user.account_status,
        "primary_shop_id": admin_user.primary_shop_id,
        "shop_ids": [shop.id for shop in admin_user.shops] if admin_user.shops else [],
        "manager_level_id": admin_user.manager_level_id,
        "manager_level": admin_user.manager_level.to_dict() if admin_user.manager_level else None
    }

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_data
    }


@router.get("/status", response_model=CloneStatusResponse, summary="获取克隆状态")
async def get_clone_status(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """
    获取当前的克隆状态

    - 返回是否在克隆状态
    - 如果在克隆状态，返回克隆会话信息和剩余时间
    """
    auth_service = get_auth_service()

    # 解码 Token
    payload = auth_service.decode_token(credentials.credentials)

    # 检查是否在克隆状态
    if not payload.get("is_cloned"):
        return {"is_cloned": False}

    clone_session_id = payload.get("clone_session_id")
    if not clone_session_id:
        return {"is_cloned": False}

    # 获取克隆状态
    clone_service = get_clone_service()
    status = await clone_service.get_clone_status(clone_session_id)

    if not status:
        return {"is_cloned": False}

    return status
