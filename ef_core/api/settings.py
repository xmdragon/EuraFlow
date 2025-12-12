"""
用户设置API路由
"""
from typing import Dict, Any
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.models.users import User, UserSettings
from ef_core.middleware.auth import require_shops
from ef_core.services.audit_service import AuditService
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

# 创建路由器
router = APIRouter(prefix="/settings", tags=["Settings"])


# ========== 请求/响应模型 ==========

class NotificationsSettings(BaseModel):
    """通知设置"""
    email: bool = True
    browser: bool = True
    order_updates: bool = True
    price_alerts: bool = True
    inventory_alerts: bool = True


class DisplaySettings(BaseModel):
    """显示设置"""
    language: str = Field("zh-CN", description="界面语言")
    timezone: str = Field("Asia/Shanghai", description="时区")
    currency: str = Field("RUB", description="默认货币")
    date_format: str = Field("YYYY-MM-DD", description="日期格式")
    shop_name_format: str = Field("both", description="店铺名称显示格式：ru/cn/both")


class SyncSettings(BaseModel):
    """同步设置"""
    auto_sync: bool = True
    sync_interval: int = Field(60, description="同步间隔（分钟）")
    sync_on_login: bool = True
    promotions: bool = Field(True, description="自动同步促销活动")
    finance_transactions: bool = Field(True, description="自动同步财务账单")
    balance: bool = Field(True, description="自动同步余额")


class SecuritySettings(BaseModel):
    """安全设置"""
    two_factor_auth: bool = False
    session_timeout: int = Field(30, description="会话超时（分钟）")


class UserSettingsRequest(BaseModel):
    """用户设置请求"""
    notifications: NotificationsSettings
    display: DisplaySettings
    sync: SyncSettings
    security: SecuritySettings


class UserSettingsResponse(BaseModel):
    """用户设置响应"""
    notifications: NotificationsSettings
    display: DisplaySettings
    sync: SyncSettings
    security: SecuritySettings


# ========== API端点 ==========

@router.get("", response_model=UserSettingsResponse)
async def get_settings(
    current_user: User = Depends(require_shops()),
    session: AsyncSession = Depends(get_async_session)
):
    """
    获取用户设置

    - 需要用户已关联店铺
    - 如果用户没有设置记录，返回默认值
    - 支持 JWT Token 或 API Key 认证
    """
    try:
        # 查询用户设置
        stmt = select(UserSettings).where(UserSettings.user_id == current_user.id)
        result = await session.execute(stmt)
        settings = result.scalar_one_or_none()

        if not settings:
            # 返回默认设置
            return UserSettingsResponse(
                notifications=NotificationsSettings(),
                display=DisplaySettings(),
                sync=SyncSettings(),
                security=SecuritySettings()
            )

        # 返回用户设置
        settings_dict = settings.to_dict()
        return UserSettingsResponse(**settings_dict)

    except Exception as e:
        logger.error(f"获取用户设置失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "SETTINGS_FETCH_ERROR",
                "message": "获取设置失败"
            }
        )


@router.put("", response_model=UserSettingsResponse)
async def update_settings(
    request: Request,
    settings_data: UserSettingsRequest,
    current_user: User = Depends(require_shops()),
    session: AsyncSession = Depends(get_async_session)
):
    """
    更新用户设置

    - 需要用户已关联店铺
    - 如果用户没有设置记录，创建新记录
    - 如果已存在，更新现有记录
    - 支持部分更新（只更新提供的字段）
    """
    try:
        # 查询用户设置
        stmt = select(UserSettings).where(UserSettings.user_id == current_user.id)
        result = await session.execute(stmt)
        settings = result.scalar_one_or_none()

        settings_dict = settings_data.dict()
        is_create = settings is None

        if not settings:
            # 创建新设置记录
            settings = UserSettings.from_dict(current_user.id, settings_dict)
            session.add(settings)
            logger.info(f"创建用户设置: user_id={current_user.id}")
        else:
            # 更新现有设置
            settings.update_from_dict(settings_dict)
            logger.info(f"更新用户设置: user_id={current_user.id}")

        await session.commit()
        await session.refresh(settings)

        # 记录更新用户设置审计日志
        await AuditService.log_action(
            db=session,
            user_id=current_user.id,
            username=current_user.username,
            module="user",
            action="create" if is_create else "update",
            action_display="创建用户设置" if is_create else "更新用户设置",
            table_name="user_settings",
            record_id=str(settings.id),
            changes={
                "language": {"new": settings_data.display.language},
                "timezone": {"new": settings_data.display.timezone},
                "currency": {"new": settings_data.display.currency},
            },
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_id=getattr(request.state, 'trace_id', None)
        )

        # 返回更新后的设置
        settings_dict = settings.to_dict()
        return UserSettingsResponse(**settings_dict)

    except Exception as e:
        logger.error(f"更新用户设置失败: {e}", exc_info=True)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "SETTINGS_UPDATE_ERROR",
                "message": "保存设置失败"
            }
        )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def reset_settings(
    request: Request,
    current_user: User = Depends(require_shops()),
    session: AsyncSession = Depends(get_async_session)
):
    """
    重置用户设置为默认值

    - 需要用户已关联店铺
    - 删除用户的设置记录
    - 下次获取设置时将返回默认值
    """
    try:
        # 查询用户设置
        stmt = select(UserSettings).where(UserSettings.user_id == current_user.id)
        result = await session.execute(stmt)
        settings = result.scalar_one_or_none()

        if settings:
            settings_id = settings.id
            await session.delete(settings)
            await session.commit()
            logger.info(f"重置用户设置: user_id={current_user.id}")

            # 记录重置用户设置审计日志
            await AuditService.log_delete(
                db=session,
                user_id=current_user.id,
                username=current_user.username,
                module="user",
                table_name="user_settings",
                record_id=str(settings_id),
                deleted_data={"action": "reset_to_default"},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                request_id=getattr(request.state, 'trace_id', None)
            )

        return None

    except Exception as e:
        logger.error(f"重置用户设置失败: {e}", exc_info=True)
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "SETTINGS_RESET_ERROR",
                "message": "重置设置失败"
            }
        )
