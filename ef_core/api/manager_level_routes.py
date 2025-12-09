"""
管理员级别 API 路由
"""
from typing import Optional, List
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.services.manager_level_service import ManagerLevelService
from ef_core.services.audit_service import AuditService
from ef_core.api.auth import get_current_user
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import NotFoundError, ValidationError, ConflictError

logger = get_logger(__name__)

router = APIRouter(prefix="/manager-levels", tags=["Manager Levels"])


# ========== 请求/响应模型 ==========

class ManagerLevelResponse(BaseModel):
    """管理员级别响应"""
    id: int
    name: str
    alias: Optional[str]
    max_sub_accounts: int
    max_shops: int
    default_expiration_days: int
    extra_config: dict
    is_default: bool
    sort_order: int
    created_at: str
    updated_at: str


class CreateManagerLevelRequest(BaseModel):
    """创建管理员级别请求"""
    name: str = Field(..., min_length=1, max_length=50, description="级别名称（唯一标识）")
    alias: Optional[str] = Field(None, max_length=50, description="级别别名（显示用）")
    max_sub_accounts: int = Field(5, ge=0, description="子账号数量限额")
    max_shops: int = Field(10, ge=0, description="店铺数量限额")
    default_expiration_days: int = Field(30, ge=0, description="默认过期周期（天）：7/30/90/365/0")
    extra_config: dict = Field(default_factory=dict, description="扩展配置")
    is_default: bool = Field(False, description="是否为默认级别")
    sort_order: int = Field(0, description="排序顺序")


class UpdateManagerLevelRequest(BaseModel):
    """更新管理员级别请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=50, description="级别名称")
    alias: Optional[str] = Field(None, max_length=50, description="级别别名")
    max_sub_accounts: Optional[int] = Field(None, ge=0, description="子账号数量限额")
    max_shops: Optional[int] = Field(None, ge=0, description="店铺数量限额")
    default_expiration_days: Optional[int] = Field(None, ge=0, description="默认过期周期（天）")
    extra_config: Optional[dict] = Field(None, description="扩展配置")
    is_default: Optional[bool] = Field(None, description="是否为默认级别")
    sort_order: Optional[int] = Field(None, description="排序顺序")


# ========== API 端点 ==========

@router.get("", response_model=List[ManagerLevelResponse])
async def list_manager_levels(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取所有管理员级别（仅admin）
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "只有超级管理员可以查看级别列表"}
        )

    levels = await ManagerLevelService.get_all(session)
    return [
        ManagerLevelResponse(
            id=level.id,
            name=level.name,
            alias=level.alias,
            max_sub_accounts=level.max_sub_accounts,
            max_shops=level.max_shops,
            default_expiration_days=level.default_expiration_days,
            extra_config=level.extra_config,
            is_default=level.is_default,
            sort_order=level.sort_order,
            created_at=level.created_at.isoformat(),
            updated_at=level.updated_at.isoformat()
        )
        for level in levels
    ]


@router.get("/{level_id}", response_model=ManagerLevelResponse)
async def get_manager_level(
    level_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取单个管理员级别（仅admin）
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "只有超级管理员可以查看级别详情"}
        )

    level = await ManagerLevelService.get_by_id(session, level_id)
    if not level:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "LEVEL_NOT_FOUND", "message": f"管理员级别 ID={level_id} 不存在"}
        )

    return ManagerLevelResponse(
        id=level.id,
        name=level.name,
        alias=level.alias,
        max_sub_accounts=level.max_sub_accounts,
        max_shops=level.max_shops,
        default_expiration_days=level.default_expiration_days,
        extra_config=level.extra_config,
        is_default=level.is_default,
        sort_order=level.sort_order,
        created_at=level.created_at.isoformat(),
        updated_at=level.updated_at.isoformat()
    )


@router.post("", response_model=ManagerLevelResponse, status_code=status.HTTP_201_CREATED)
async def create_manager_level(
    request: Request,
    data: CreateManagerLevelRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    创建管理员级别（仅admin）
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "只有超级管理员可以创建级别"}
        )

    try:
        level = await ManagerLevelService.create(
            db=session,
            name=data.name,
            alias=data.alias,
            max_sub_accounts=data.max_sub_accounts,
            max_shops=data.max_shops,
            default_expiration_days=data.default_expiration_days,
            extra_config=data.extra_config,
            is_default=data.is_default,
            sort_order=data.sort_order
        )
        await session.commit()

        # 记录审计日志
        await AuditService.log_action(
            db=session,
            user_id=current_user.id,
            username=current_user.username,
            module="manager_level",
            action="create",
            action_display="创建管理员级别",
            table_name="manager_levels",
            record_id=str(level.id),
            changes={
                "name": {"new": level.name},
                "alias": {"new": level.alias},
                "max_sub_accounts": {"new": level.max_sub_accounts},
                "max_shops": {"new": level.max_shops}
            },
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent")
        )

        return ManagerLevelResponse(
            id=level.id,
            name=level.name,
            alias=level.alias,
            max_sub_accounts=level.max_sub_accounts,
            max_shops=level.max_shops,
            default_expiration_days=level.default_expiration_days,
            extra_config=level.extra_config,
            is_default=level.is_default,
            sort_order=level.sort_order,
            created_at=level.created_at.isoformat(),
            updated_at=level.updated_at.isoformat()
        )

    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": e.code, "message": e.detail}
        )


@router.put("/{level_id}", response_model=ManagerLevelResponse)
async def update_manager_level(
    request: Request,
    level_id: int,
    data: UpdateManagerLevelRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    更新管理员级别（仅admin）
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "只有超级管理员可以更新级别"}
        )

    try:
        # 获取旧值用于审计
        old_level = await ManagerLevelService.get_by_id(session, level_id)
        if not old_level:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "LEVEL_NOT_FOUND", "message": f"管理员级别 ID={level_id} 不存在"}
            )

        old_values = {
            "name": old_level.name,
            "alias": old_level.alias,
            "max_sub_accounts": old_level.max_sub_accounts,
            "max_shops": old_level.max_shops
        }

        level = await ManagerLevelService.update(
            db=session,
            level_id=level_id,
            name=data.name,
            alias=data.alias,
            max_sub_accounts=data.max_sub_accounts,
            max_shops=data.max_shops,
            default_expiration_days=data.default_expiration_days,
            extra_config=data.extra_config,
            is_default=data.is_default,
            sort_order=data.sort_order
        )
        await session.commit()

        # 记录审计日志
        changes = {}
        if data.name and data.name != old_values["name"]:
            changes["name"] = {"old": old_values["name"], "new": level.name}
        if data.alias is not None and data.alias != old_values["alias"]:
            changes["alias"] = {"old": old_values["alias"], "new": level.alias}
        if data.max_sub_accounts is not None and data.max_sub_accounts != old_values["max_sub_accounts"]:
            changes["max_sub_accounts"] = {"old": old_values["max_sub_accounts"], "new": level.max_sub_accounts}
        if data.max_shops is not None and data.max_shops != old_values["max_shops"]:
            changes["max_shops"] = {"old": old_values["max_shops"], "new": level.max_shops}

        if changes:
            await AuditService.log_action(
                db=session,
                user_id=current_user.id,
                username=current_user.username,
                module="manager_level",
                action="update",
                action_display="更新管理员级别",
                table_name="manager_levels",
                record_id=str(level_id),
                changes=changes,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent")
            )

        return ManagerLevelResponse(
            id=level.id,
            name=level.name,
            alias=level.alias,
            max_sub_accounts=level.max_sub_accounts,
            max_shops=level.max_shops,
            default_expiration_days=level.default_expiration_days,
            extra_config=level.extra_config,
            is_default=level.is_default,
            sort_order=level.sort_order,
            created_at=level.created_at.isoformat(),
            updated_at=level.updated_at.isoformat()
        )

    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": e.code, "message": e.detail}
        )
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": e.code, "message": e.detail}
        )


@router.delete("/{level_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_manager_level(
    request: Request,
    level_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session)
):
    """
    删除管理员级别（仅admin）

    - 如果有用户正在使用此级别，无法删除
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "INSUFFICIENT_PERMISSIONS", "message": "只有超级管理员可以删除级别"}
        )

    try:
        # 获取级别信息用于审计
        level = await ManagerLevelService.get_by_id(session, level_id)
        if not level:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "LEVEL_NOT_FOUND", "message": f"管理员级别 ID={level_id} 不存在"}
            )

        level_name = level.name

        await ManagerLevelService.delete(session, level_id)
        await session.commit()

        # 记录审计日志
        await AuditService.log_delete(
            db=session,
            user_id=current_user.id,
            username=current_user.username,
            module="manager_level",
            table_name="manager_levels",
            record_id=str(level_id),
            deleted_data={"name": level_name},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent")
        )

        return None

    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": e.code, "message": e.detail}
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": e.code, "message": e.detail}
        )
