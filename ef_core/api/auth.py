"""
认证API路由
"""
from typing import Optional
from pydantic import BaseModel, Field, EmailStr

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ef_core.services.auth_service import get_auth_service
from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.utils.logging import get_logger
from ef_core.utils.errors import UnauthorizedError, ValidationError
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
    email: str
    username: Optional[str]
    role: str
    is_active: bool
    primary_shop_id: Optional[int]
    shops: list = []
    permissions: list = []
    last_login_at: Optional[str]
    created_at: str


# ========== 依赖函数 ==========

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: AsyncSession = Depends(get_async_session)
) -> User:
    """获取当前认证用户"""
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
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取当前用户信息
    
    - 需要有效的访问令牌
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

@router.post("/users", include_in_schema=False)
async def create_user(
    request: Request,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    创建用户（仅admin）
    
    - 不对外开放注册
    - 仅管理员可以创建新用户
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INSUFFICIENT_PERMISSIONS",
                "message": "Only administrators can create users"
            }
        )
    
    # TODO: 实现用户创建逻辑
    # 这里暂时返回未实现
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "code": "NOT_IMPLEMENTED",
            "message": "User creation endpoint not yet implemented"
        }
    )