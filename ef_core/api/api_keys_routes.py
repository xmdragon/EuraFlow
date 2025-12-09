"""
API Key管理路由
"""
from typing import Optional, List
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.services.api_key_service import get_api_key_service
from ef_core.services.audit_service import AuditService
from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user
from ef_core.middleware.auth import require_role
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# 创建路由器
router = APIRouter(prefix="/api-keys", tags=["API Keys"])


# ========== 请求/响应模型 ==========

class CreateAPIKeyRequest(BaseModel):
    """创建API Key请求"""
    name: str = Field(..., min_length=1, max_length=100, description="Key名称")
    permissions: List[str] = Field(
        default_factory=lambda: ["product_selection:write"],
        description="权限列表"
    )
    expires_in_days: Optional[int] = Field(None, description="过期天数（可选）")


class APIKeyResponse(BaseModel):
    """API Key响应（不包含实际Key）"""
    id: int
    name: str
    permissions: List[str]
    is_active: bool
    last_used_at: Optional[str]
    expires_at: Optional[str]
    created_at: str
    updated_at: str


class CreateAPIKeyResponse(BaseModel):
    """创建API Key响应（包含原始Key，仅返回一次）"""
    key_id: int
    key: str  # 原始Key，仅在创建时返回
    name: str
    permissions: List[str]
    expires_at: Optional[str]
    created_at: str


class RegenerateAPIKeyResponse(BaseModel):
    """重新生成API Key响应（包含新Key）"""
    key_id: int
    key: str  # 新的原始Key
    name: str
    permissions: List[str]
    expires_at: Optional[str]
    updated_at: str


# ========== API端点 ==========

@router.post("/", response_model=CreateAPIKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    http_request: Request,
    key_data: CreateAPIKeyRequest,
    current_user: User = Depends(require_role("sub_account")),
    db: AsyncSession = Depends(get_async_session)
):
    """
    创建新的API Key

    **注意**：API Key仅在创建时显示一次，请妥善保存！
    """
    try:
        api_key_service = get_api_key_service()
        result = await api_key_service.create_api_key(
            db=db,
            user_id=current_user.id,
            name=key_data.name,
            permissions=key_data.permissions,
            expires_in_days=key_data.expires_in_days
        )

        # 记录创建API密钥审计日志
        await AuditService.log_action(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="user",
            action="create",
            action_display="创建API密钥",
            table_name="api_keys",
            record_id=str(result['key_id']),
            changes={
                "name": {"new": key_data.name},
                "key_prefix": {"new": result['key'][:8] + "..."},
                "permissions": {"new": key_data.permissions}
            },
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
            request_id=getattr(http_request.state, 'trace_id', None)
        )

        return CreateAPIKeyResponse(**result)

    except Exception as e:
        logger.error(f"创建API Key失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "API_KEY_CREATE_ERROR",
                "message": f"创建API Key失败: {str(e)}"
            }
        )


@router.get("/", response_model=List[APIKeyResponse])
async def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session)
):
    """
    列出当前用户的所有API Keys
    """
    try:
        api_key_service = get_api_key_service()
        keys = await api_key_service.list_user_keys(
            db=db,
            user_id=current_user.id
        )

        return [APIKeyResponse(**key) for key in keys]

    except Exception as e:
        logger.error(f"获取API Key列表失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "API_KEY_LIST_ERROR",
                "message": "获取API Key列表失败"
            }
        )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(
    http_request: Request,
    key_id: int,
    current_user: User = Depends(require_role("sub_account")),
    db: AsyncSession = Depends(get_async_session)
):
    """
    删除指定的API Key
    """
    try:
        api_key_service = get_api_key_service()
        success = await api_key_service.delete_api_key(
            db=db,
            key_id=key_id,
            user_id=current_user.id
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "API_KEY_NOT_FOUND",
                    "message": "API Key不存在或无权限访问"
                }
            )

        # 记录删除API密钥审计日志
        await AuditService.log_delete(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="user",
            table_name="api_keys",
            record_id=str(key_id),
            deleted_data={"key_id": key_id},
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
            request_id=getattr(http_request.state, 'trace_id', None)
        )

        return None

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除API Key失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "API_KEY_DELETE_ERROR",
                "message": "删除API Key失败"
            }
        )


@router.put("/{key_id}/regenerate", response_model=RegenerateAPIKeyResponse)
async def regenerate_api_key(
    http_request: Request,
    key_id: int,
    current_user: User = Depends(require_role("sub_account")),
    db: AsyncSession = Depends(get_async_session)
):
    """
    重新生成API Key（保留名称和权限）

    **注意**：新Key仅显示一次，旧Key立即失效！
    """
    try:
        api_key_service = get_api_key_service()
        result = await api_key_service.regenerate_api_key(
            db=db,
            key_id=key_id,
            user_id=current_user.id
        )

        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "API_KEY_NOT_FOUND",
                    "message": "API Key不存在或无权限访问"
                }
            )

        # 记录重新生成API密钥审计日志
        await AuditService.log_action(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="user",
            action="update",
            action_display="重新生成API密钥",
            table_name="api_keys",
            record_id=str(key_id),
            changes={
                "key": {"old": "[已脱敏]", "new": result['key'][:8] + "..."}
            },
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
            request_id=getattr(http_request.state, 'trace_id', None)
        )

        return RegenerateAPIKeyResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"重新生成API Key失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "API_KEY_REGENERATE_ERROR",
                "message": "重新生成API Key失败"
            }
        )
