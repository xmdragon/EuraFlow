"""通用翻译API路由（使用翻译工厂）"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from datetime import datetime
import logging

from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ef_core.database import get_db_manager
from ..models.chat import OzonChatMessage
from ..services.translation_factory import TranslationFactory

router = APIRouter(prefix="/translation", tags=["translation"])
logger = logging.getLogger(__name__)


@router.get("/active-provider")
async def get_active_provider(
    user: User = Depends(get_current_user)
) -> dict:
    """获取当前激活的翻译引擎类型"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        provider_type = await TranslationFactory.get_active_provider_type(session)
        return {
            "ok": True,
            "data": {
                "provider": provider_type  # "chatgpt", "aliyun" 或 "none"
            }
        }


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

        # 使用翻译工厂创建翻译服务（自动选择当前激活的引擎）
        try:
            service = await TranslationFactory.create_from_db(session)
        except ValueError as e:
            raise HTTPException(
                status_code=500,
                detail={
                    "type": "about:blank",
                    "title": "Translation Service Unavailable",
                    "status": 500,
                    "detail": str(e),
                    "code": "NO_TRANSLATION_SERVICE"
                }
            )

        logger.info(f"开始翻译消息: message_id={message_id}, sender_type={message.sender_type}, content_length={len(message.content or '')}")

        translation = await service.translate_message(
            content=message.content or "",
            sender_type=message.sender_type
        )

        logger.info(f"翻译结果: translation={'成功' if translation else '失败'}, result_length={len(translation) if translation else 0}")

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
