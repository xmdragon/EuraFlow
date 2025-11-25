"""
Ozon全局设置API路由
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Dict, Any
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from plugins.ef.channels.ozon.models.global_settings import OzonGlobalSetting

router = APIRouter(prefix="/global-settings", tags=["Ozon Global Settings"])
logger = logging.getLogger(__name__)


# === DTO ===

class GlobalSettingResponse(BaseModel):
    """全局设置响应"""
    setting_key: str
    setting_value: Dict[str, Any]
    description: str | None = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "setting_key": "api_rate_limit",
                "setting_value": {"value": 50, "unit": "req/s"},
                "description": "API限流：每秒发送API请求上限"
            }
        }
    }


class GlobalSettingUpdateRequest(BaseModel):
    """更新全局设置请求"""
    setting_value: Dict[str, Any] = Field(..., description="设置值（JSONB格式）")

    model_config = {
        "json_schema_extra": {
            "example": {
                "setting_value": {"value": 100, "unit": "req/s"}
            }
        }
    }


class GlobalSettingsListResponse(BaseModel):
    """全局设置列表响应"""
    settings: Dict[str, GlobalSettingResponse]


# === API端点 ===

@router.get(
    "",
    response_model=GlobalSettingsListResponse,
    summary="获取所有全局设置"
)
async def get_global_settings(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取所有全局设置

    权限：所有登录用户
    """
    # 查询所有全局设置
    result = await db.execute(select(OzonGlobalSetting))
    settings = result.scalars().all()

    # 转换为字典格式
    settings_dict = {}
    for setting in settings:
        settings_dict[setting.setting_key] = GlobalSettingResponse(
            setting_key=setting.setting_key,
            setting_value=setting.setting_value,
            description=setting.description
        )

    return GlobalSettingsListResponse(settings=settings_dict)


@router.get(
    "/{setting_key}",
    response_model=GlobalSettingResponse,
    summary="获取指定全局设置"
)
async def get_global_setting(
    setting_key: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取指定的全局设置

    参数：
    - setting_key: 设置键（如：api_rate_limit）

    权限：所有登录用户
    """
    # 查询指定设置
    result = await db.execute(
        select(OzonGlobalSetting).where(OzonGlobalSetting.setting_key == setting_key)
    )
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "type": "about:blank",
                "title": "Setting not found",
                "status": 404,
                "detail": f"Global setting '{setting_key}' does not exist",
                "code": "SETTING_NOT_FOUND"
            }
        )

    return GlobalSettingResponse(
        setting_key=setting.setting_key,
        setting_value=setting.setting_value,
        description=setting.description
    )


@router.put(
    "/{setting_key}",
    response_model=GlobalSettingResponse,
    summary="更新全局设置（仅管理员）"
)
async def update_global_setting(
    setting_key: str,
    request: GlobalSettingUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    更新指定的全局设置

    参数：
    - setting_key: 设置键（如：api_rate_limit）
    - request: 更新请求（包含新的设置值）

    权限：仅管理员
    """
    # 权限检查：仅管理员可修改
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "type": "about:blank",
                "title": "Permission denied",
                "status": 403,
                "detail": "Only administrators can modify global settings",
                "code": "PERMISSION_DENIED"
            }
        )

    # 查询指定设置
    result = await db.execute(
        select(OzonGlobalSetting).where(OzonGlobalSetting.setting_key == setting_key)
    )
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "type": "about:blank",
                "title": "Setting not found",
                "status": 404,
                "detail": f"Global setting '{setting_key}' does not exist",
                "code": "SETTING_NOT_FOUND"
            }
        )

    # 更新设置值
    setting.setting_value = request.setting_value

    # 提交事务
    await db.commit()
    await db.refresh(setting)

    # 如果更新的是时区设置，清除时区缓存
    if setting_key == "default_timezone":
        from plugins.ef.channels.ozon.utils.datetime_utils import invalidate_timezone_cache
        invalidate_timezone_cache()

    logger.info(
        f"Global setting updated",
        extra={
            "setting_key": setting_key,
            "new_value": request.setting_value,
            "user_id": current_user.id
        }
    )

    return GlobalSettingResponse(
        setting_key=setting.setting_key,
        setting_value=setting.setting_value,
        description=setting.description
    )
