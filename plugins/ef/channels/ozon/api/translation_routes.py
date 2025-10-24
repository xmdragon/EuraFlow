"""阿里云翻译API路由"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from datetime import datetime
import logging

from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ef_core.database import get_db_manager
from ..models.translation import AliyunTranslationConfig
from ..models.chat import OzonChatMessage
from ..services.aliyun_translation_service import AliyunTranslationService

router = APIRouter(prefix="/translation", tags=["translation"])
logger = logging.getLogger(__name__)


class TranslationConfigRequest(BaseModel):
    """翻译配置请求"""
    access_key_id: str = Field(..., description="阿里云AccessKey ID")
    access_key_secret: str = Field(..., description="阿里云AccessKey Secret")
    region_id: str = Field(default="cn-hangzhou", description="阿里云区域ID")
    enabled: bool = Field(default=True, description="是否启用")


class TranslationConfigResponse(BaseModel):
    """翻译配置响应"""
    id: int
    access_key_id: Optional[str]
    region_id: str
    enabled: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]
    created_at: datetime
    updated_at: datetime


@router.get("/config")
async def get_translation_config(
    user: User = Depends(get_current_user)
) -> dict:
    """获取翻译配置"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
        config = await session.scalar(stmt)

        if not config:
            return {"ok": True, "data": None}

        return {
            "ok": True,
            "data": {
                "id": config.id,
                "access_key_id": config.access_key_id,
                "region_id": config.region_id,
                "enabled": config.enabled,
                "last_test_at": config.last_test_at,
                "last_test_success": config.last_test_success,
                "created_at": config.created_at,
                "updated_at": config.updated_at
            }
        }


@router.post("/config")
async def save_translation_config(
    request: TranslationConfigRequest,
    user: User = Depends(get_current_user)
) -> dict:
    """保存或更新翻译配置"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
        config = await session.scalar(stmt)

        if config:
            # 更新现有配置
            config.access_key_id = request.access_key_id
            if request.access_key_secret:  # 只在提供了新密钥时才更新
                config.access_key_secret_encrypted = request.access_key_secret  # TODO: 加密
            config.region_id = request.region_id
            config.enabled = request.enabled
        else:
            # 创建新配置
            config = AliyunTranslationConfig(
                id=1,
                access_key_id=request.access_key_id,
                access_key_secret_encrypted=request.access_key_secret,  # TODO: 加密
                region_id=request.region_id,
                enabled=request.enabled
            )
            session.add(config)

        await session.commit()
        await session.refresh(config)

        return {
            "ok": True,
            "data": {
                "id": config.id,
                "access_key_id": config.access_key_id,
                "region_id": config.region_id,
                "enabled": config.enabled
            }
        }


@router.post("/config/test")
async def test_translation_connection(
    user: User = Depends(get_current_user)
) -> dict:
    """测试翻译服务连接"""
    try:
        service = AliyunTranslationService()
        success = await service.test_connection()

        # 更新测试结果
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
            config = await session.scalar(stmt)

            if config:
                from ..utils.datetime_utils import utcnow
                config.last_test_at = utcnow()
                config.last_test_success = success
                await session.commit()

        if success:
            return {"ok": True, "data": {"message": "连接测试成功"}}
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "type": "about:blank",
                    "title": "Connection Test Failed",
                    "status": 500,
                    "detail": "翻译服务连接测试失败，请检查配置",
                    "code": "CONNECTION_TEST_FAILED"
                }
            )
    except Exception as e:
        logger.error(f"测试翻译服务连接失败: {e}", exc_info=True)
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


@router.post("/chats/{shop_id}/{chat_id}/messages/{message_id}/translate")
async def translate_message(
    shop_id: int,
    chat_id: str,
    message_id: str,
    user: User = Depends(get_current_user)
) -> dict:
    """懒加载翻译聊天消息"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        # 查询消息
        stmt = select(OzonChatMessage).where(
            OzonChatMessage.shop_id == shop_id,
            OzonChatMessage.chat_id == chat_id,
            OzonChatMessage.message_id == message_id
        )
        message = await session.scalar(stmt)

        if not message:
            raise HTTPException(
                status_code=404,
                detail={
                    "type": "about:blank",
                    "title": "Message Not Found",
                    "status": 404,
                    "detail": "消息不存在",
                    "code": "MESSAGE_NOT_FOUND"
                }
            )

        # 如果已有翻译，直接返回
        if message.data_cn:
            return {"ok": True, "data": {"translation": message.data_cn}}

        # 调用翻译服务
        service = AliyunTranslationService()
        translation = await service.translate_message(
            content=message.content or "",
            sender_type=message.sender_type
        )

        if translation:
            # 保存翻译结果
            message.data_cn = translation
            await session.commit()

            return {"ok": True, "data": {"translation": translation}}
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "type": "about:blank",
                    "title": "Translation Failed",
                    "status": 500,
                    "detail": "翻译失败",
                    "code": "TRANSLATION_FAILED"
                }
            )
