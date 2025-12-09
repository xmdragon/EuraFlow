"""
认证API路由
"""
from typing import Optional
from pydantic import BaseModel, Field, EmailStr, validator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ef_core.services.auth_service import get_auth_service
from ef_core.services.api_key_service import get_api_key_service
from ef_core.services.audit_service import AuditService
from ef_core.database import get_async_session, get_db_manager
from ef_core.models.users import User, UserSettings
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import UnauthorizedError, ValidationError, NotFoundError, ConflictError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = get_logger(__name__)

# 创建路由器
router = APIRouter(prefix="/auth", tags=["Authentication"])

# Bearer认证
security = HTTPBearer()


# ========== 请求/响应模型 ==========

class LoginRequest(BaseModel):
    """登录请求"""
    username: str = Field(..., description="邮箱或用户名")
    password: str = Field(..., description="密码")


class TokenResponse(BaseModel):
    """令牌响应"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    """登录响应"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class RefreshRequest(BaseModel):
    """刷新令牌请求"""
    refresh_token: str


class UserSettingsResponse(BaseModel):
    """用户设置响应（嵌入在用户信息中）"""
    notifications: dict = Field(default_factory=lambda: {
        "email": True, "browser": True, "order_updates": True,
        "price_alerts": True, "inventory_alerts": True
    })
    display: dict = Field(default_factory=lambda: {
        "language": "zh-CN", "timezone": "Asia/Shanghai",
        "currency": "RUB", "date_format": "YYYY-MM-DD", "shop_name_format": "both"
    })
    sync: dict = Field(default_factory=lambda: {
        "auto_sync": True, "sync_interval": 60, "sync_on_login": True
    })
    security: dict = Field(default_factory=lambda: {
        "two_factor_auth": False, "session_timeout": 30
    })


class UserResponse(BaseModel):
    """用户信息响应"""
    id: int
    username: str
    role: str
    is_active: bool
    account_status: str = "active"  # active/suspended/disabled
    expires_at: Optional[str] = None  # 过期时间
    parent_user_id: Optional[int]
    primary_shop_id: Optional[int]
    shop_ids: list[int] = []  # 用户关联的店铺ID列表
    permissions: list = []
    manager_level_id: Optional[int] = None
    manager_level: Optional[dict] = None  # 管理员级别详情
    last_login_at: Optional[str]
    created_at: str
    settings: UserSettingsResponse = Field(default_factory=UserSettingsResponse)  # 用户设置


class CreateUserRequest(BaseModel):
    """创建用户请求"""
    username: str = Field(..., min_length=3, max_length=50, description="用户名")
    password: str = Field(..., min_length=8, description="密码")
    role: str = Field("sub_account", description="角色：manager/sub_account")
    is_active: bool = Field(True, description="是否激活")
    account_status: str = Field("active", description="账号状态：active/suspended/disabled")
    expires_at: Optional[str] = Field(None, description="过期时间（ISO 8601格式）")
    primary_shop_id: Optional[int] = Field(None, description="主店铺ID")
    shop_ids: Optional[list[int]] = Field(None, description="关联店铺ID列表")
    permissions: list = Field(default_factory=list, description="权限列表")
    manager_level_id: Optional[int] = Field(None, description="管理员级别ID（仅manager角色）")

    @validator('role')
    def validate_role(cls, v):
        if v not in ['manager', 'sub_account']:
            raise ValueError('只能创建manager或sub_account角色')
        return v

    @validator('account_status')
    def validate_account_status(cls, v):
        if v not in ['active', 'suspended', 'disabled']:
            raise ValueError('账号状态只能是 active/suspended/disabled')
        return v


class UpdateUserRequest(BaseModel):
    """更新用户请求"""
    username: Optional[str] = Field(None, description="用户名")
    role: Optional[str] = Field(None, description="角色")
    is_active: Optional[bool] = Field(None, description="是否激活")
    account_status: Optional[str] = Field(None, description="账号状态：active/suspended/disabled")
    expires_at: Optional[str] = Field(None, description="过期时间（ISO 8601格式），传 null 表示永不过期")
    primary_shop_id: Optional[int] = Field(None, description="主店铺ID")
    shop_ids: Optional[list[int]] = Field(None, description="关联店铺ID列表")
    permissions: Optional[list] = Field(None, description="权限列表")
    manager_level_id: Optional[int] = Field(None, description="管理员级别ID（仅manager角色）")

    @validator('account_status')
    def validate_account_status(cls, v):
        if v is not None and v not in ['active', 'suspended', 'disabled']:
            raise ValueError('账号状态只能是 active/suspended/disabled')
        return v


class ChangePasswordRequest(BaseModel):
    """修改密码请求"""
    current_password: str = Field(..., description="当前密码")
    new_password: str = Field(..., min_length=8, description="新密码")


class UpdateProfileRequest(BaseModel):
    """更新个人资料请求"""
    username: Optional[str] = Field(None, min_length=3, max_length=50, description="用户名")


# ========== 依赖函数 ==========

async def get_current_user_from_api_key(
    request: Request,
    session: AsyncSession = Depends(get_async_session)
) -> Optional[User]:
    """
    通过API Key认证用户（从X-API-Key Header）

    Returns:
        验证成功返回User对象，否则返回None
    """
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        return None

    try:
        api_key_service = get_api_key_service()
        user = await api_key_service.validate_api_key(session, api_key)

        if user:
            # 设置请求状态（供中间件使用）
            request.state.user_id = user.id
            request.state.shop_id = user.primary_shop_id
            request.state.permissions = user.permissions
            request.state.auth_method = "api_key"
            logger.info(f"API Key认证成功: user_id={user.id}")

        return user
    except Exception as e:
        logger.error(f"API Key认证错误: {e}", exc_info=True)
        return None


async def get_current_user_flexible(
    request: Request,
    session: AsyncSession = Depends(get_async_session)
) -> User:
    """
    获取当前认证用户（支持 JWT Token 或 API Key）

    优先检查 API Key (X-API-Key header)，如果不存在则尝试 JWT Token

    性能优化：从 JWT 中读取 shop_ids，避免数据库查询
    """
    # 1. 尝试 API Key 认证
    user = await get_current_user_from_api_key(request, session)
    if user:
        return user

    # 2. 尝试 JWT Token 认证
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise UnauthorizedError(
            code="MISSING_CREDENTIALS",
            detail="Missing authentication credentials"
        )

    token = auth_header.replace("Bearer ", "")
    auth_service = get_auth_service()

    try:
        # 解码令牌
        payload = auth_service.decode_token(token)

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
        user_id = payload.get("sub")
        stmt = select(User).where(User.id == int(user_id))
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise UnauthorizedError(
                code="USER_NOT_FOUND",
                detail="User not found or inactive"
            )

        # 从 JWT 缓存 shop_ids 到用户对象（避免后续数据库查询）
        shop_ids_from_jwt = payload.get("shop_ids")
        if shop_ids_from_jwt is not None:
            user._cached_shop_ids = shop_ids_from_jwt

        # 设置请求状态（供中间件使用）
        request.state.user_id = user.id
        request.state.shop_id = user.primary_shop_id
        request.state.shop_ids = shop_ids_from_jwt  # None 表示 admin
        request.state.permissions = user.permissions
        request.state.auth_method = "jwt"

        return user

    except UnauthorizedError:
        raise
    except Exception as e:
        logger.error("Authentication failed", exc_info=True)
        raise UnauthorizedError(
            code="AUTHENTICATION_FAILED",
            detail="Authentication failed"
        )


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_async_session)
) -> User:
    """获取当前认证用户（JWT Token）

    性能优化：从 JWT 中读取 shop_ids，避免数据库查询
    """
    auth_service = get_auth_service()

    try:
        # 解码令牌
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
        user_id = payload.get("sub")
        stmt = select(User).where(User.id == int(user_id))
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise UnauthorizedError(
                code="USER_NOT_FOUND",
                detail="User not found or inactive"
            )

        # 从 JWT 缓存 shop_ids 到用户对象（避免后续数据库查询）
        shop_ids_from_jwt = payload.get("shop_ids")
        if shop_ids_from_jwt is not None:
            user._cached_shop_ids = shop_ids_from_jwt

        # 设置请求状态（供中间件使用）
        request.state.user_id = user.id
        request.state.shop_id = user.primary_shop_id
        request.state.shop_ids = shop_ids_from_jwt  # None 表示 admin
        request.state.permissions = user.permissions
        request.state.auth_method = "jwt"

        return user

    except UnauthorizedError:
        raise
    except Exception as e:
        logger.error("Authentication failed", exc_info=True)
        raise UnauthorizedError(
            code="AUTHENTICATION_FAILED",
            detail="Authentication failed"
        )


# ========== API端点 ==========

@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    login_request: LoginRequest
):
    """
    用户登录

    - 支持邮箱或用户名登录
    - 返回访问令牌和刷新令牌
    - 实施登录限流（5次/分钟）
    - 单设备登录：新设备登录会踢出旧设备
    """
    auth_service = get_auth_service()

    # 获取客户端信息
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    try:
        result = await auth_service.login(
            email_or_username=login_request.username,
            password=login_request.password,
            ip_address=client_ip,
            user_agent=user_agent
        )

        # 如果有被踢出的旧会话，通过 WebSocket 通知
        kicked_session_token = result.pop("kicked_session_token", None)
        if kicked_session_token:
            # TODO: 通过 WebSocket 通知旧设备
            logger.info(
                f"用户 {result['user']['id']} 在新设备登录，旧会话已踢出",
                kicked_token=kicked_session_token[:8] + "..."
            )

        # 记录登录成功审计日志
        db_manager = get_db_manager()
        async with db_manager.get_session() as audit_db:
            await AuditService.log_action(
                db=audit_db,
                user_id=result['user']['id'],
                username=result['user']['username'],
                module="user",
                action="login",
                action_display="用户登录",
                table_name="users",
                record_id=str(result['user']['id']),
                changes={
                    "login_method": {"new": "password"},
                    "success": {"new": True}
                },
                ip_address=client_ip,
                user_agent=request.headers.get("user-agent"),
                request_id=getattr(request.state, 'trace_id', None),
                notes=f"登录用户名: {login_request.username}"
            )

        return LoginResponse(**result)

    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": e.code,
                "message": e.detail
            }
        )
    except Exception as e:
        logger.error("Login error", exc_info=True, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "LOGIN_ERROR",
                "message": f"An error occurred during login: {str(e)}"
            }
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    refresh_request: RefreshRequest
):
    """
    刷新访问令牌
    
    - 使用刷新令牌获取新的访问令牌
    - 实现令牌旋转（返回新的刷新令牌）
    - 旧的刷新令牌将被撤销
    """
    auth_service = get_auth_service()
    
    try:
        result = await auth_service.refresh_access_token(
            refresh_token=refresh_request.refresh_token
        )
        
        return TokenResponse(**result)
        
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": e.code,
                "message": e.detail
            }
        )
    except Exception as e:
        logger.error("Token refresh error", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "REFRESH_ERROR",
                "message": "An error occurred during token refresh"
            }
        )


async def _get_user_settings(session: AsyncSession, user_id: int) -> dict:
    """获取用户设置，如果不存在则返回默认值"""
    stmt = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await session.execute(stmt)
    settings = result.scalar_one_or_none()

    if settings:
        return settings.to_dict()
    # 返回默认设置
    return {
        "notifications": {
            "email": True, "browser": True, "order_updates": True,
            "price_alerts": True, "inventory_alerts": True
        },
        "display": {
            "language": "zh-CN", "timezone": "Asia/Shanghai",
            "currency": "RUB", "date_format": "YYYY-MM-DD", "shop_name_format": "both"
        },
        "sync": {
            "auto_sync": True, "sync_interval": 60, "sync_on_login": True
        },
        "security": {
            "two_factor_auth": False, "session_timeout": 30
        }
    }


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(request: Request):
    """
    获取当前用户信息

    - 支持 JWT Token (Authorization: Bearer <token>) 或 API Key (X-API-Key: <key>)
    - 返回用户基本信息、关联的店铺和用户设置
    """
    # 1. 优先尝试 API Key 认证
    api_key = request.headers.get("X-API-Key")
    if api_key:
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            api_key_service = get_api_key_service()
            user = await api_key_service.validate_api_key(session, api_key)

            if user:
                # 重新加载用户以包含 shops 关系
                stmt = select(User).where(User.id == user.id).options(
                    selectinload(User.primary_shop),
                    selectinload(User.shops)
                )
                result = await session.execute(stmt)
                user = result.scalar_one_or_none()

                if user:
                    user_data = user.to_dict()
                    user_data["shop_ids"] = [shop.id for shop in user.shops] if user.shops else []
                    user_data["settings"] = await _get_user_settings(session, user.id)
                    logger.info("API Key认证成功")
                    return UserResponse(**user_data)

    # 2. 降级到 JWT Token 认证
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": "MISSING_AUTH", "message": "Missing authorization"})

    token = auth_header.replace("Bearer ", "")
    auth_service = get_auth_service()

    try:
        payload = auth_service.decode_token(token)
        user_id = payload.get("sub")

        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(User).where(User.id == int(user_id)).options(
                selectinload(User.primary_shop),
                selectinload(User.shops)
            )
            result = await session.execute(stmt)
            user = result.scalar_one_or_none()

            if not user or not user.is_active:
                raise HTTPException(status_code=401, detail={"code": "USER_NOT_FOUND", "message": "User not found"})

            # 构建响应（包含用户设置）
            user_data = user.to_dict()
            user_data["shop_ids"] = [shop.id for shop in user.shops] if user.shops else []
            user_data["settings"] = await _get_user_settings(session, user.id)

            return UserResponse(**user_data)
    except Exception as e:
        raise HTTPException(status_code=401, detail={"code": "AUTH_FAILED", "message": str(e)})


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    refresh_token: Optional[str] = None
):
    """
    用户登出
    
    - 撤销访问令牌和刷新令牌
    - 将令牌加入黑名单
    """
    auth_service = get_auth_service()
    
    try:
        # 从请求体获取refresh_token（如果有）
        if request.headers.get("content-type") == "application/json":
            body = await request.json()
            refresh_token = body.get("refresh_token")
        
        await auth_service.logout(
            access_token=credentials.credentials,
            refresh_token=refresh_token
        )
        
        return None
        
    except Exception as e:
        logger.error("Logout error", exc_info=True)
        # 登出失败也返回成功，避免泄露信息
        return None


# ========== 管理端点 ==========

@router.post("/users", response_model=UserResponse)
async def create_user(
    request: Request,
    user_data: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    创建用户

    权限规则：
    - admin: 可以创建 manager 或 sub_account
    - manager: 只能创建 sub_account（受级别配额限制）
    - sub_account: 不能创建用户
    """
    from sqlalchemy import func

    # 权限检查
    if current_user.role == "sub_account":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "子账号无权创建用户"}
        )

    # manager 只能创建 sub_account
    if current_user.role == "manager" and user_data.role != "sub_account":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INVALID_ROLE", "message": "管理员只能创建子账号"}
        )

    # 配额检查（仅 manager 需要检查）
    if current_user.role == "manager":
        # 加载管理员级别
        stmt = select(User).where(User.id == current_user.id).options(selectinload(User.manager_level))
        result = await session.execute(stmt)
        manager = result.scalar_one()

        if manager.manager_level:
            # 统计当前子账号数量
            stmt = select(func.count()).select_from(User).where(User.parent_user_id == current_user.id)
            result = await session.execute(stmt)
            sub_account_count = result.scalar()

            if sub_account_count >= manager.manager_level.max_sub_accounts:
                max_accounts = manager.manager_level.max_sub_accounts
                if max_accounts == 0:
                    error_msg = "您的账号级别不允许添加子账号"
                else:
                    error_msg = f"不能添加更多子账号，已达上限（{max_accounts}个）"
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "QUOTA_EXCEEDED",
                        "message": error_msg
                    }
                )

    auth_service = get_auth_service()

    # 检查用户名是否已存在
    stmt = select(User).where(User.username == user_data.username)
    result = await session.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "USERNAME_EXISTS", "message": "该用户名已被使用"}
        )

    # 确定管理员级别
    manager_level_id = None
    if user_data.role == "manager":
        if user_data.manager_level_id:
            manager_level_id = user_data.manager_level_id
        else:
            # 使用默认级别
            from ef_core.services.manager_level_service import ManagerLevelService
            default_level = await ManagerLevelService.get_default(session)
            if default_level:
                manager_level_id = default_level.id

    # 处理过期时间
    from datetime import datetime, timezone as tz
    expires_at = None
    if user_data.expires_at:
        try:
            expires_at = datetime.fromisoformat(user_data.expires_at.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "INVALID_DATE", "message": "过期时间格式错误"}
            )

    # manager 创建 sub_account 时，验证过期时间不能超过自己的过期时间
    if current_user.role == "manager" and expires_at:
        if current_user.expires_at and expires_at > current_user.expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "EXPIRES_AT_EXCEEDS_MANAGER",
                    "message": f"子账号过期时间不能超过您的账号过期时间（{current_user.expires_at.strftime('%Y-%m-%d %H:%M')}）"
                }
            )

    # 创建新用户
    new_user = User(
        username=user_data.username,
        password_hash=auth_service.hash_password(user_data.password),
        role=user_data.role,
        is_active=user_data.is_active,
        account_status=user_data.account_status,
        expires_at=expires_at,
        parent_user_id=current_user.id,
        primary_shop_id=user_data.primary_shop_id or current_user.primary_shop_id,
        permissions=user_data.permissions,
        manager_level_id=manager_level_id
    )

    # 所有角色都可以不关联店铺，登录后前端会引导用户添加店铺

    session.add(new_user)
    await session.flush()

    # 处理店铺关联
    from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
    if user_data.shop_ids:
        stmt = select(OzonShop).where(OzonShop.id.in_(user_data.shop_ids))
        result = await session.execute(stmt)
        shops = result.scalars().all()
        await session.run_sync(lambda s: setattr(new_user, 'shops', list(shops)))

    await session.commit()
    await session.refresh(new_user, attribute_names=["shops", "manager_level"])

    # 记录审计日志
    await AuditService.log_action(
        db=session,
        user_id=current_user.id,
        username=current_user.username,
        module="user",
        action="create",
        action_display="创建用户",
        table_name="users",
        record_id=str(new_user.id),
        changes={
            "username": {"new": new_user.username},
            "role": {"new": new_user.role},
            "is_active": {"new": new_user.is_active},
            "manager_level_id": {"new": new_user.manager_level_id},
            "shop_ids": {"new": [shop.id for shop in new_user.shops]}
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, 'trace_id', None),
        notes=f"由 {current_user.username}（{current_user.role}）创建"
    )

    return UserResponse(**{
        **new_user.to_dict(),
        "shop_ids": [shop.id for shop in new_user.shops],
        "manager_level": new_user.manager_level.to_dict() if new_user.manager_level else None
    })


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取用户列表

    权限规则：
    - admin: 看到所有用户
    - manager: 看到自己和自己创建的子账号
    - sub_account: 只能看到自己
    """
    from sqlalchemy import or_

    if current_user.role == "admin":
        # 超级管理员查看所有用户
        stmt = select(User).options(
            selectinload(User.shops),
            selectinload(User.manager_level)
        ).order_by(User.role.desc(), User.created_at)
    elif current_user.role == "manager":
        # 管理员查看自己和所有子账号
        stmt = select(User).where(
            or_(
                User.id == current_user.id,
                User.parent_user_id == current_user.id
            )
        ).options(
            selectinload(User.shops),
            selectinload(User.manager_level)
        ).order_by(User.role.desc(), User.created_at)
    else:
        # 子账号只能看到自己
        stmt = select(User).where(User.id == current_user.id).options(
            selectinload(User.shops),
            selectinload(User.manager_level)
        )

    result = await session.execute(stmt)
    users = result.scalars().all()

    return [
        UserResponse(**{
            **user.to_dict(),
            "shop_ids": [shop.id for shop in user.shops],
            "manager_level": user.manager_level.to_dict() if user.manager_level else None
        })
        for user in users
    ]


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    request: Request,
    user_id: int,
    update_data: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    更新用户信息

    权限规则：
    - admin: 可以编辑所有用户（除了自己）
    - manager: 只能编辑自己创建的子账号
    - sub_account: 不能编辑用户
    """
    # 权限检查
    if current_user.role == "sub_account":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "子账号无权编辑用户"}
        )

    # 获取要更新的用户
    if current_user.role == "admin":
        # admin 可以编辑任何用户（除了自己）
        stmt = select(User).options(
            selectinload(User.shops),
            selectinload(User.manager_level)
        ).where(User.id == user_id, User.id != current_user.id)
    else:
        # manager 只能编辑自己创建的子账号
        stmt = select(User).options(
            selectinload(User.shops),
            selectinload(User.manager_level)
        ).where(User.id == user_id, User.parent_user_id == current_user.id)

    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "USER_NOT_FOUND", "message": "用户不存在或无权限访问"}
        )

    # 保存旧值用于审计日志
    old_username = user.username
    old_role = user.role
    old_is_active = user.is_active
    old_account_status = user.account_status
    old_expires_at = user.expires_at.isoformat() if user.expires_at else None
    old_shop_ids = [shop.id for shop in user.shops] if user.shops else []
    old_permissions = user.permissions
    old_manager_level_id = user.manager_level_id

    # 更新用户名
    if update_data.username is not None:
        stmt = select(User).where(User.username == update_data.username, User.id != user_id)
        result = await session.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "USERNAME_EXISTS", "message": "该用户名已被使用"}
            )
        user.username = update_data.username

    # 更新角色
    if update_data.role is not None:
        if current_user.role == "admin":
            # admin 可以设置任意角色
            if update_data.role not in ['admin', 'manager', 'sub_account']:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "INVALID_ROLE", "message": "角色只能是 admin、manager 或 sub_account"}
                )
        else:
            # manager 只能设置 sub_account
            if update_data.role != 'sub_account':
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "INVALID_ROLE", "message": "只能设置为 sub_account 角色"}
                )
        user.role = update_data.role

    if update_data.is_active is not None:
        user.is_active = update_data.is_active

    if update_data.primary_shop_id is not None:
        user.primary_shop_id = update_data.primary_shop_id

    if update_data.permissions is not None:
        user.permissions = update_data.permissions

    # 更新账号状态
    # - admin 可以设置 manager 的状态
    # - manager 可以设置 sub_account 的状态（子账号继承管理员状态，此处设置无实际效果，但保留以便将来扩展）
    if update_data.account_status is not None:
        target_role = update_data.role or user.role
        if current_user.role == "admin" and target_role == "manager":
            user.account_status = update_data.account_status
        elif current_user.role == "manager" and target_role == "sub_account":
            user.account_status = update_data.account_status

    # 更新过期时间
    # - admin 可以设置 manager 的过期时间
    # - manager 可以设置 sub_account 的过期时间（不能超过自己的过期时间）
    if update_data.expires_at is not None:
        target_role = update_data.role or user.role
        from datetime import datetime, timezone as tz

        # 解析新的过期时间
        new_expires_at = None
        if update_data.expires_at not in ("null", ""):
            try:
                new_expires_at = datetime.fromisoformat(update_data.expires_at.replace('Z', '+00:00'))
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "INVALID_DATE", "message": "过期时间格式错误"}
                )

        if current_user.role == "admin" and target_role == "manager":
            # admin 设置 manager 的过期时间，无限制
            user.expires_at = new_expires_at
        elif current_user.role == "manager" and target_role == "sub_account":
            # manager 设置 sub_account 的过期时间，不能超过自己的过期时间
            if new_expires_at and current_user.expires_at and new_expires_at > current_user.expires_at:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "EXPIRES_AT_EXCEEDS_MANAGER",
                        "message": f"子账号过期时间不能超过您的账号过期时间（{current_user.expires_at.strftime('%Y-%m-%d %H:%M')}）"
                    }
                )
            user.expires_at = new_expires_at

    # 更新管理员级别（仅 admin 可以设置，且仅对 manager 角色有效）
    if update_data.manager_level_id is not None and current_user.role == "admin":
        target_role = update_data.role or user.role
        if target_role == "manager":
            user.manager_level_id = update_data.manager_level_id
        else:
            user.manager_level_id = None

    # 处理店铺关联更新
    if update_data.shop_ids is not None:
        from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
        logger.info(f"更新用户{user_id}的店铺关联: shop_ids={update_data.shop_ids}")

        if not update_data.shop_ids:
            user.shops = []
        else:
            stmt = select(OzonShop).where(OzonShop.id.in_(update_data.shop_ids))
            result = await session.execute(stmt)
            shops = result.scalars().all()
            user.shops = list(shops)

    await session.commit()

    # 重新加载用户
    stmt = select(User).where(User.id == user_id).options(
        selectinload(User.shops),
        selectinload(User.manager_level)
    )
    result = await session.execute(stmt)
    user = result.scalar_one()

    # 记录审计日志
    new_shop_ids = [shop.id for shop in user.shops]
    changes = {}
    if old_username != user.username:
        changes["username"] = {"old": old_username, "new": user.username}
    if old_role != user.role:
        changes["role"] = {"old": old_role, "new": user.role}
    if old_is_active != user.is_active:
        changes["is_active"] = {"old": old_is_active, "new": user.is_active}
    if old_shop_ids != new_shop_ids:
        changes["shop_ids"] = {"old": old_shop_ids, "new": new_shop_ids}
    if old_permissions != user.permissions:
        changes["permissions"] = {"old": old_permissions, "new": user.permissions}
    if old_manager_level_id != user.manager_level_id:
        changes["manager_level_id"] = {"old": old_manager_level_id, "new": user.manager_level_id}
    if old_account_status != user.account_status:
        changes["account_status"] = {"old": old_account_status, "new": user.account_status}
    new_expires_at = user.expires_at.isoformat() if user.expires_at else None
    if old_expires_at != new_expires_at:
        changes["expires_at"] = {"old": old_expires_at, "new": new_expires_at}

    if changes:
        await AuditService.log_action(
            db=session,
            user_id=current_user.id,
            username=current_user.username,
            module="user",
            action="update",
            action_display="更新用户",
            table_name="users",
            record_id=str(user_id),
            changes=changes,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, 'trace_id', None),
            notes=f"目标用户: {user.username}"
        )

    return UserResponse(**{
        **user.to_dict(),
        "shop_ids": [shop.id for shop in user.shops],
        "manager_level": user.manager_level.to_dict() if user.manager_level else None
    })


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    request: Request,
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    删除用户

    权限规则：
    - admin: 可以删除任何用户（除了自己）
    - manager: 只能删除自己创建的子账号
    - sub_account: 不能删除用户
    """
    # 权限检查
    if current_user.role == "sub_account":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "子账号无权删除用户"}
        )

    # 获取要删除的用户
    if current_user.role == "admin":
        # admin 可以删除任何用户（除了自己）
        stmt = select(User).where(User.id == user_id, User.id != current_user.id)
    else:
        # manager 只能删除自己创建的子账号
        stmt = select(User).where(User.id == user_id, User.parent_user_id == current_user.id)

    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "USER_NOT_FOUND", "message": "用户不存在或无权限访问"}
        )

    # 记录审计日志（在删除前记录）
    await AuditService.log_delete(
        db=session,
        user_id=current_user.id,
        username=current_user.username,
        module="user",
        table_name="users",
        record_id=str(user_id),
        deleted_data={
            "username": user.username,
            "role": user.role,
            "is_active": user.is_active
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, 'trace_id', None),
        notes=f"由 {current_user.username}（{current_user.role}）删除"
    )

    # 删除用户
    await session.delete(user)
    await session.commit()

    return None


@router.put("/me", response_model=UserResponse)
async def update_profile(
    request: Request,
    update_data: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    更新个人资料

    - 用户可以更新自己的基本信息
    - 不能修改角色和权限
    """
    # 重新获取用户信息
    stmt = select(User).where(User.id == current_user.id)
    result = await session.execute(stmt)
    user = result.scalar_one()

    # 保存旧值用于审计日志
    old_username = user.username

    # 更新用户名
    if update_data.username is not None:
        # 检查用户名是否已存在
        stmt = select(User).where(User.username == update_data.username, User.id != user.id)
        result = await session.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "USERNAME_EXISTS",
                    "message": "该用户名已被使用"
                }
            )
        user.username = update_data.username

    await session.commit()
    await session.refresh(user, attribute_names=["shops"])

    # 记录更新个人资料审计日志
    if old_username != user.username:
        await AuditService.log_action(
            db=session,
            user_id=current_user.id,
            username=user.username,
            module="user",
            action="update",
            action_display="更新个人资料",
            table_name="users",
            record_id=str(current_user.id),
            changes={
                "username": {"old": old_username, "new": user.username}
            },
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, 'trace_id', None)
        )

    return UserResponse(**{**user.to_dict(), "shop_ids": [shop.id for shop in user.shops]})


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    request: Request,
    password_data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    修改密码

    - 需要验证当前密码
    - 密码最少8位
    """
    auth_service = get_auth_service()

    # 重新获取用户信息
    stmt = select(User).where(User.id == current_user.id)
    result = await session.execute(stmt)
    user = result.scalar_one()

    # 验证当前密码
    if not auth_service.verify_password(password_data.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_PASSWORD",
                "message": "当前密码不正确"
            }
        )

    # 更新密码
    user.password_hash = auth_service.hash_password(password_data.new_password)
    await session.commit()

    # 记录修改密码审计日志
    await AuditService.log_action(
        db=session,
        user_id=current_user.id,
        username=current_user.username,
        module="user",
        action="update",
        action_display="修改密码",
        table_name="users",
        record_id=str(current_user.id),
        changes={
            "password": {"old": "[已脱敏]", "new": "[已修改]"}
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, 'trace_id', None),
        notes="用户主动修改密码"
    )

    return None


class AdminResetPasswordRequest(BaseModel):
    """管理员重置密码请求"""
    new_password: str = Field(..., min_length=8, description="新密码")


@router.patch("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def admin_reset_user_password(
    request: Request,
    user_id: int,
    password_data: AdminResetPasswordRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    管理员重置用户密码（仅admin）

    - admin用户(username="admin")可以重置任何用户密码
    - 其他管理员只能重置自己创建的子账号密码，且不能重置admin用户密码
    - 不需要验证原密码
    - 密码最少8位
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INSUFFICIENT_PERMISSIONS",
                "message": "只有管理员可以重置用户密码"
            }
        )

    # 判断当前用户是否是超级管理员(username="admin")
    is_super_admin = current_user.username == "admin"

    # 获取要重置密码的用户
    if is_super_admin:
        # 超级管理员可以重置任何用户密码（除了自己）
        stmt = select(User).where(User.id == user_id, User.id != current_user.id)
    else:
        # 其他管理员只能重置自己创建的子账号密码
        stmt = select(User).where(User.id == user_id, User.parent_user_id == current_user.id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "USER_NOT_FOUND",
                "message": "用户不存在或无权限访问"
            }
        )

    # 其他管理员不能重置admin用户密码
    if not is_super_admin and user.username == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "CANNOT_RESET_ADMIN_PASSWORD",
                "message": "无法重置超级管理员密码"
            }
        )

    # 重置密码
    auth_service = get_auth_service()
    user.password_hash = auth_service.hash_password(password_data.new_password)
    await session.commit()

    # 记录重置密码审计日志
    await AuditService.log_action(
        db=session,
        user_id=current_user.id,
        username=current_user.username,
        module="user",
        action="update",
        action_display="重置用户密码",
        table_name="users",
        record_id=str(user_id),
        changes={
            "password": {"old": "[已脱敏]", "new": "[已重置]"}
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, 'trace_id', None),
        notes=f"目标用户: {user.username}"
    )

    return None