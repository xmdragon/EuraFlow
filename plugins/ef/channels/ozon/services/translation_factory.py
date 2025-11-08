"""
翻译服务工厂
根据数据库配置选择 ChatGPT 或 阿里云翻译
"""

from typing import Union
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ..models.translation import AliyunTranslationConfig
from ..models.chatgpt_translation import ChatGPTTranslationConfig
from .aliyun_translation_service import AliyunTranslationService
from .chatgpt_translation_service import ChatGPTTranslationService

logger = get_logger(__name__)


class TranslationFactory:
    """翻译服务工厂类"""

    @staticmethod
    async def create_from_db(db: AsyncSession) -> Union[ChatGPTTranslationService, AliyunTranslationService]:
        """
        从数据库配置创建翻译服务实例

        优先级：
        1. 启用且默认的 ChatGPT 翻译
        2. 启用且默认的阿里云翻译
        3. 任何启用的 ChatGPT 翻译
        4. 任何启用的阿里云翻译
        5. 抛出异常（无可用配置）

        Args:
            db: 数据库会话

        Returns:
            ChatGPTTranslationService 或 AliyunTranslationService 实例

        Raises:
            ValueError: 没有找到可用的翻译配置
        """
        # 1. 查找启用且默认的 ChatGPT 翻译
        stmt = select(ChatGPTTranslationConfig).where(
            ChatGPTTranslationConfig.enabled == True,
            ChatGPTTranslationConfig.is_default == True
        )
        chatgpt_config = await db.scalar(stmt)

        if chatgpt_config:
            logger.info("使用 ChatGPT 作为默认翻译引擎")
            return ChatGPTTranslationService()

        # 2. 查找启用且默认的阿里云翻译
        stmt = select(AliyunTranslationConfig).where(
            AliyunTranslationConfig.enabled == True,
            AliyunTranslationConfig.is_default == True
        )
        aliyun_config = await db.scalar(stmt)

        if aliyun_config:
            logger.info("使用阿里云翻译作为默认翻译引擎")
            return AliyunTranslationService()

        # 3. 查找任何启用的 ChatGPT 翻译
        stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.enabled == True)
        chatgpt_config = await db.scalar(stmt)

        if chatgpt_config:
            logger.info("使用 ChatGPT 作为翻译引擎（无默认标记，但已启用）")
            return ChatGPTTranslationService()

        # 4. 查找任何启用的阿里云翻译
        stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.enabled == True)
        aliyun_config = await db.scalar(stmt)

        if aliyun_config:
            logger.info("使用阿里云翻译作为翻译引擎（无默认标记，但已启用）")
            return AliyunTranslationService()

        # 5. 没有找到任何可用配置
        logger.error("没有找到可用的翻译配置（ChatGPT 或阿里云翻译）")
        raise ValueError("没有找到可用的翻译配置，请先在系统设置中配置 ChatGPT 或阿里云翻译")

    @staticmethod
    async def get_active_provider_type(db: AsyncSession) -> str:
        """
        获取当前激活的翻译引擎类型

        Args:
            db: 数据库会话

        Returns:
            "chatgpt" 或 "aliyun" 或 "none"
        """
        # 检查 ChatGPT 翻译
        stmt = select(ChatGPTTranslationConfig).where(
            ChatGPTTranslationConfig.enabled == True,
            ChatGPTTranslationConfig.is_default == True
        )
        chatgpt_config = await db.scalar(stmt)

        if chatgpt_config:
            return "chatgpt"

        # 检查阿里云翻译
        stmt = select(AliyunTranslationConfig).where(
            AliyunTranslationConfig.enabled == True,
            AliyunTranslationConfig.is_default == True
        )
        aliyun_config = await db.scalar(stmt)

        if aliyun_config:
            return "aliyun"

        # 检查任何启用的配置
        stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.enabled == True)
        chatgpt_config = await db.scalar(stmt)
        if chatgpt_config:
            return "chatgpt"

        stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.enabled == True)
        aliyun_config = await db.scalar(stmt)
        if aliyun_config:
            return "aliyun"

        return "none"
