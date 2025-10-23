"""
认证API路由
"""
from typing import Optional
from pydantic import BaseModel, Field, EmailStr, validator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ef_core.services.auth_service import get_auth_service
from ef_core.services.api_key_service import get_api_key_service
from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import UnauthorizedError, ValidationError, NotFoundError, ConflictError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


class UserResponse(BaseModel):
    """用户信息响应"""
    id: int
    username: str
    email: Optional[str]
    role: str
    is_active: bool
    parent_user_id: Optional[int]
    primary_shop_id: Optional[int]
    shop_ids: list[int] = []  # 用户关联的店铺ID列表
    permissions: list = []
    last_login_at: Optional[str]
    created_at: str


class CreateUserRequest(BaseModel):
    """创建用户请求"""
    username: str = Field(..., min_length=3, max_length=50, description="用户名（必填）")
    email: Optional[EmailStr] = Field(None, description="邮箱地址（选填）")
    password: str = Field(..., min_length=8, description="密码")
    role: str = Field("operator", description="角色：operator/viewer")
    is_active: bool = Field(True, description="是否激活")
    primary_shop_id: Optional[int] = Field(None, description="主店铺ID")
    shop_ids: Optional[list[int]] = Field(None, description="关联店铺ID列表")
    permissions: list = Field(default_factory=list, description="权限列表")

    @validator('role')
    def validate_role(cls, v):
        if v not in ['operator', 'viewer']:
            raise ValueError('子账号只能设置为operator或viewer角色')
        return v


class UpdateUserRequest(BaseModel):
    """更新用户请求"""
    username: Optional[str] = Field(None, description="用户名")
    role: Optional[str] = Field(None, description="角色")
    is_active: Optional[bool] = Field(None, description="是否激活")
    primary_shop_id: Optional[int] = Field(None, description="主店铺ID")
    shop_ids: Optional[list[int]] = Field(None, description="关联店铺ID列表")
    permissions: Optional[list] = Field(None, description="权限列表")


class ChangePasswordRequest(BaseModel):
    """修改密码请求"""
    current_password: str = Field(..., description="当前密码")
    new_password: str = Field(..., min_length=8, description="新密码")


class UpdateProfileRequest(BaseModel):
    """更新个人资料请求"""
    username: Optional[str] = Field(None, min_length=3, max_length=50, description="用户名")
    email: Optional[EmailStr] = Field(None, description="邮箱")


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

        # 设置请求状态（供中间件使用）
        request.state.user_id = user.id
        request.state.shop_id = user.primary_shop_id
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
    """获取当前认证用户（JWT Token）"""
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

        # 设置请求状态（供中间件使用）
        request.state.user_id = user.id
        request.state.shop_id = user.primary_shop_id
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
    """
    auth_service = get_auth_service()
    
    # 获取客户端IP
    client_ip = request.client.host if request.client else None
    
    try:
        result = await auth_service.login(
            email_or_username=login_request.username,
            password=login_request.password,
            ip_address=client_ip
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


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取当前用户信息

    - 支持 JWT Token (Authorization: Bearer <token>) 或 API Key (X-API-Key: <key>)
    - 返回用户基本信息和关联的店铺
    """
    # 加载关联的店铺
    from sqlalchemy.orm import selectinload
    stmt = select(User).where(User.id == current_user.id).options(
        selectinload(User.primary_shop),
        selectinload(User.owned_shops)
    )
    result = await session.execute(stmt)
    user = result.scalar_one()

    # 构建响应
    user_data = user.to_dict()

    # 添加店铺列表
    shops = []
    if user.primary_shop:
        shops.append(user.primary_shop.to_dict())
    for shop in user.owned_shops:
        if shop.id != user.primary_shop_id:
            shops.append(shop.to_dict())

    user_data["shops"] = shops

    return UserResponse(**user_data)


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


# ========== 管理端点（仅admin） ==========

@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    创建子账号（仅admin）

    - 仅管理员可以创建新用户
    - 子账号自动关联到创建者的主账号
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INSUFFICIENT_PERMISSIONS",
                "message": "只有管理员可以创建用户"
            }
        )

    auth_service = get_auth_service()

    # 检查用户名是否已存在（用户名必填）
    stmt = select(User).where(User.username == user_data.username)
    result = await session.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "USERNAME_EXISTS",
                "message": "该用户名已被使用"
            }
        )

    # 如果提供了邮箱，检查是否已存在
    if user_data.email:
        stmt = select(User).where(User.email == user_data.email)
        result = await session.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "EMAIL_EXISTS",
                    "message": "该邮箱已被注册"
                }
            )

    # 创建新用户
    new_user = User(
        email=user_data.email,
        username=user_data.username,
        password_hash=auth_service.hash_password(user_data.password),
        role=user_data.role,
        is_active=user_data.is_active,
        parent_user_id=current_user.id,  # 设置父账号
        primary_shop_id=user_data.primary_shop_id or current_user.primary_shop_id,
        permissions=user_data.permissions
    )

    session.add(new_user)
    await session.flush()  # 先flush获取用户ID

    # 处理店铺关联
    if user_data.role == "admin":
        # admin 自动关联所有店铺
        from ef_core.models.shops import Shop
        stmt = select(Shop)
        result = await session.execute(stmt)
        all_shops = result.scalars().all()
        new_user.shops = list(all_shops)
    elif user_data.shop_ids:
        # 其他角色根据传入的 shop_ids 关联
        from ef_core.models.shops import Shop
        stmt = select(Shop).where(Shop.id.in_(user_data.shop_ids))
        result = await session.execute(stmt)
        shops = result.scalars().all()
        new_user.shops = list(shops)

    await session.commit()
    await session.refresh(new_user)

    return UserResponse(**new_user.to_dict())


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取用户列表

    - 管理员可以看到自己和所有子账号
    - 普通用户只能看到自己的信息
    """
    if current_user.role == "admin":
        # 管理员查看自己和所有子账号
        from sqlalchemy import or_
        stmt = select(User).where(
            or_(
                User.id == current_user.id,  # 包含管理员自己
                User.parent_user_id == current_user.id  # 包含所有子账号
            )
        ).order_by(User.role.desc(), User.created_at)  # 按角色排序，admin在前
    else:
        # 普通用户只能看到自己
        stmt = select(User).where(User.id == current_user.id)

    result = await session.execute(stmt)
    users = result.scalars().all()

    return [UserResponse(**user.to_dict()) for user in users]


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    update_data: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    更新用户信息（仅admin）

    - 管理员可以更新子账号信息
    - 不能修改主账号关系
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INSUFFICIENT_PERMISSIONS",
                "message": "只有管理员可以更新用户信息"
            }
        )

    # 获取要更新的用户
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

    # 更新用户信息
    if update_data.username is not None:
        # 检查用户名是否已存在
        stmt = select(User).where(User.username == update_data.username, User.id != user_id)
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

    if update_data.role is not None:
        if update_data.role not in ['operator', 'viewer']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "INVALID_ROLE",
                    "message": "子账号只能设置为operator或viewer角色"
                }
            )
        user.role = update_data.role

    if update_data.is_active is not None:
        user.is_active = update_data.is_active

    if update_data.primary_shop_id is not None:
        user.primary_shop_id = update_data.primary_shop_id

    if update_data.permissions is not None:
        user.permissions = update_data.permissions

    # 处理店铺关联更新
    if update_data.shop_ids is not None:
        from ef_core.models.shops import Shop
        if update_data.role == "admin" or user.role == "admin":
            # admin 自动关联所有店铺
            stmt = select(Shop)
            result = await session.execute(stmt)
            all_shops = result.scalars().all()
            user.shops = list(all_shops)
        else:
            # 其他角色根据传入的 shop_ids 关联
            stmt = select(Shop).where(Shop.id.in_(update_data.shop_ids))
            result = await session.execute(stmt)
            shops = result.scalars().all()
            user.shops = list(shops)

    await session.commit()
    await session.refresh(user)

    return UserResponse(**user.to_dict())


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    禁用用户（仅admin）

    - 软删除，将is_active设为False
    - 不真正删除用户数据
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INSUFFICIENT_PERMISSIONS",
                "message": "只有管理员可以禁用用户"
            }
        )

    # 获取要禁用的用户
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

    # 禁用用户
    user.is_active = False
    await session.commit()

    return None


@router.put("/me", response_model=UserResponse)
async def update_profile(
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

    # 更新邮箱
    if update_data.email is not None:
        # 检查邮箱是否已存在
        stmt = select(User).where(User.email == update_data.email, User.id != user.id)
        result = await session.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "EMAIL_EXISTS",
                    "message": "该邮箱已被使用"
                }
            )
        user.email = update_data.email

    await session.commit()
    await session.refresh(user)

    return UserResponse(**user.to_dict())


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
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

    return None