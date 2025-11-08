"""ChatGPT翻译配置API路由"""
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
from ..models.chatgpt_translation import ChatGPTTranslationConfig, DEFAULT_SYSTEM_PROMPT
from ..models.translation import AliyunTranslationConfig
from ..services.chatgpt_translation_service import ChatGPTTranslationService
from ..utils.datetime_utils import utcnow

router = APIRouter(prefix="/translation/chatgpt", tags=["translation"])
logger = logging.getLogger(__name__)


class ChatGPTTranslationConfigRequest(BaseModel):
    """ChatGPT翻译配置请求"""
    api_key: Optional[str] = Field(None, description="OpenAI API Key（留空表示不修改）")
    base_url: Optional[str] = Field(None, description="API Base URL（可选，默认官方地址）")
    model_name: str = Field(default="gpt-5-mini", description="模型名称")
    system_prompt: str = Field(default=DEFAULT_SYSTEM_PROMPT, description="System Prompt（翻译规则）")
    enabled: bool = Field(default=True, description="是否启用")


class ChatGPTTranslationConfigResponse(BaseModel):
    """ChatGPT翻译配置响应"""
    id: int
    base_url: Optional[str]
    model_name: str
    system_prompt: str
    enabled: bool
    is_default: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]
    created_at: datetime
    updated_at: datetime


@router.get("/config")
async def get_chatgpt_translation_config(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """获取ChatGPT翻译配置"""
    stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.id == 1)
    config = await db.scalar(stmt)

    if not config:
        return {"ok": True, "data": None}

    return {
        "ok": True,
        "data": {
            "id": config.id,
            "base_url": config.base_url,
            "model_name": config.model_name,
            "system_prompt": config.system_prompt,
            "enabled": config.enabled,
            "is_default": config.is_default,
            "last_test_at": config.last_test_at,
            "last_test_success": config.last_test_success,
            "created_at": config.created_at,
            "updated_at": config.updated_at
        }
    }


@router.post("/config")
async def save_chatgpt_translation_config(
    request: ChatGPTTranslationConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """保存或更新ChatGPT翻译配置"""
    stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.id == 1)
    config = await db.scalar(stmt)

    if config:
        # 更新现有配置
        if request.api_key:  # 只在提供了新密钥时才更新
            config.api_key_encrypted = request.api_key  # TODO: 加密
        config.base_url = request.base_url
        config.model_name = request.model_name
        config.system_prompt = request.system_prompt
        config.enabled = request.enabled
    else:
        # 创建新配置
        if not request.api_key:
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "Bad Request",
                    "status": 400,
                    "detail": "首次创建配置时必须提供 API Key",
                    "code": "API_KEY_REQUIRED"
                }
            )

        config = ChatGPTTranslationConfig(
            id=1,
            api_key_encrypted=request.api_key,  # TODO: 加密
            base_url=request.base_url,
            model_name=request.model_name,
            system_prompt=request.system_prompt,
            enabled=request.enabled,
            is_default=False  # 默认不设为默认引擎（阿里云优先）
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)

    return {
        "ok": True,
        "data": {
            "id": config.id,
            "base_url": config.base_url,
            "model_name": config.model_name,
            "system_prompt": config.system_prompt,
            "enabled": config.enabled,
            "is_default": config.is_default
        }
    }


@router.post("/config/test")
async def test_chatgpt_translation_connection(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """测试ChatGPT翻译服务连接"""
    try:
        service = ChatGPTTranslationService()
        success = await service.test_connection()

        # 更新测试结果
        stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.id == 1)
        config = await db.scalar(stmt)

        if config:
            config.last_test_at = utcnow()
            config.last_test_success = success
            await db.commit()

        if success:
            return {"ok": True, "data": {"message": "ChatGPT翻译连接测试成功"}}
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "type": "about:blank",
                    "title": "Connection Test Failed",
                    "status": 500,
                    "detail": "ChatGPT翻译连接测试失败，请检查配置",
                    "code": "CONNECTION_TEST_FAILED"
                }
            )
    except Exception as e:
        logger.error(f"测试ChatGPT翻译连接失败: {e}", exc_info=True)
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
async def set_chatgpt_translation_default(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user)
) -> dict:
    """设置ChatGPT翻译为默认翻译引擎"""
    try:
        # 1. 获取ChatGPT翻译配置
        chatgpt_config = await db.get(ChatGPTTranslationConfig, 1)

        if not chatgpt_config:
            raise HTTPException(
                status_code=404,
                detail={
                    "type": "about:blank",
                    "title": "Config Not Found",
                    "status": 404,
                    "detail": "ChatGPT翻译配置不存在，请先创建配置",
                    "code": "CONFIG_NOT_FOUND"
                }
            )

        # 2. 取消阿里云的默认状态
        stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
        aliyun_config = await db.scalar(stmt)
        if aliyun_config:
            aliyun_config.is_default = False

        # 3. 设置ChatGPT翻译为默认并启用
        chatgpt_config.is_default = True
        chatgpt_config.enabled = True

        await db.commit()

        logger.info("ChatGPT翻译已设置为默认翻译引擎")

        return {
            "ok": True,
            "data": {
                "message": "ChatGPT翻译已设置为默认翻译引擎"
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"设置ChatGPT翻译为默认失败: {e}", exc_info=True)
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
