"""阿里云翻译配置API路由"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
import logging

from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ef_core.database import get_async_session
from ..models.translation import AliyunTranslationConfig
from ..models.chatgpt_translation import ChatGPTTranslationConfig
from ..services.aliyun_translation_service import AliyunTranslationService
from ..utils.datetime_utils import utcnow

router = APIRouter(prefix="/translation/aliyun", tags=["translation"])
logger = logging.getLogger(__name__)


class AliyunTranslationConfigRequest(BaseModel):
    """阿里云翻译配置请求"""
    access_key_id: str = Field(..., description="阿里云AccessKey ID")
    access_key_secret: Optional[str] = Field(None, description="阿里云AccessKey Secret（留空表示不修改）")
    region_id: str = Field(default="cn-hangzhou", description="阿里云区域ID")
    enabled: bool = Field(default=True, description="是否启用")


class AliyunTranslationConfigResponse(BaseModel):
    """阿里云翻译配置响应"""
    id: int
    access_key_id: Optional[str]
    region_id: str
    enabled: bool
    is_default: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]
    created_at: datetime
    updated_at: datetime


@router.get("/config")
async def get_aliyun_translation_config(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """获取阿里云翻译配置"""
    stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
    config = await db.scalar(stmt)

    if not config:
        return {"ok": True, "data": None}

    return {
        "ok": True,
        "data": {
            "id": config.id,
            "access_key_id": config.access_key_id,
            "region_id": config.region_id,
            "enabled": config.enabled,
            "is_default": config.is_default,
            "last_test_at": config.last_test_at,
            "last_test_success": config.last_test_success,
            "created_at": config.created_at,
            "updated_at": config.updated_at
        }
    }


@router.post("/config")
async def save_aliyun_translation_config(
    request: AliyunTranslationConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """保存或更新阿里云翻译配置"""
    stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
    config = await db.scalar(stmt)

    if config:
        # 更新现有配置
        config.access_key_id = request.access_key_id
        if request.access_key_secret:  # 只在提供了新密钥时才更新
            config.access_key_secret_encrypted = request.access_key_secret  # TODO: 加密
        config.region_id = request.region_id
        config.enabled = request.enabled
    else:
        # 创建新配置（默认为 is_default=True）
        config = AliyunTranslationConfig(
            id=1,
            access_key_id=request.access_key_id,
            access_key_secret_encrypted=request.access_key_secret,  # TODO: 加密
            region_id=request.region_id,
            enabled=request.enabled,
            is_default=True  # 第一次创建时默认为默认引擎
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)

    return {
        "ok": True,
        "data": {
            "id": config.id,
            "access_key_id": config.access_key_id,
            "region_id": config.region_id,
            "enabled": config.enabled,
            "is_default": config.is_default
        }
    }


@router.post("/config/test")
async def test_aliyun_translation_connection(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """测试阿里云翻译服务连接"""
    try:
        service = AliyunTranslationService()
        success = await service.test_connection()

        # 更新测试结果
        stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
        config = await db.scalar(stmt)

        if config:
            config.last_test_at = utcnow()
            config.last_test_success = success
            await db.commit()

        if success:
            return {"ok": True, "data": {"message": "阿里云翻译连接测试成功"}}
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "type": "about:blank",
                    "title": "Connection Test Failed",
                    "status": 500,
                    "detail": "阿里云翻译连接测试失败，请检查配置",
                    "code": "CONNECTION_TEST_FAILED"
                }
            )
    except Exception as e:
        logger.error(f"测试阿里云翻译连接失败: {e}", exc_info=True)
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


@router.put("/set-default")
async def set_aliyun_translation_default(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """设置阿里云翻译为默认翻译引擎"""
    try:
        # 1. 获取阿里云翻译配置
        aliyun_config = await db.get(AliyunTranslationConfig, 1)

        if not aliyun_config:
            raise HTTPException(
                status_code=404,
                detail={
                    "type": "about:blank",
                    "title": "Config Not Found",
                    "status": 404,
                    "detail": "阿里云翻译配置不存在，请先创建配置",
                    "code": "CONFIG_NOT_FOUND"
                }
            )

        # 2. 取消 ChatGPT 的默认状态
        stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.id == 1)
        chatgpt_config = await db.scalar(stmt)
        if chatgpt_config:
            chatgpt_config.is_default = False

        # 3. 设置阿里云翻译为默认并启用
        aliyun_config.is_default = True
        aliyun_config.enabled = True

        await db.commit()

        logger.info("阿里云翻译已设置为默认翻译引擎")

        return {
            "ok": True,
            "data": {
                "message": "阿里云翻译已设置为默认翻译引擎"
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"设置阿里云翻译为默认失败: {e}", exc_info=True)
        await db.rollback()
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
