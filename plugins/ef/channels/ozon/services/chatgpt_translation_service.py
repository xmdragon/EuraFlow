"""ChatGPT翻译服务"""
import logging
from typing import Optional
from openai import AsyncOpenAI, OpenAIError
from datetime import datetime

from ef_core.database import get_db_manager
from ..models.chatgpt_translation import ChatGPTTranslationConfig

logger = logging.getLogger(__name__)


class ChatGPTTranslationService:
    """ChatGPT翻译服务（中俄互译）"""

    def __init__(self):
        """初始化翻译服务"""
        self.db_manager = get_db_manager()
        self._client: Optional[AsyncOpenAI] = None

    async def get_config(self) -> Optional[ChatGPTTranslationConfig]:
        """获取翻译配置"""
        async with self.db_manager.get_session() as session:
            from sqlalchemy import select
            stmt = select(ChatGPTTranslationConfig).where(ChatGPTTranslationConfig.id == 1)
            config = await session.scalar(stmt)
            return config

    async def _get_client(self) -> Optional[AsyncOpenAI]:
        """获取 OpenAI 客户端"""
        config = await self.get_config()
        if not config or not config.enabled:
            logger.warning("ChatGPT翻译未配置或未启用")
            return None

        if not config.api_key_encrypted:
            logger.warning("ChatGPT API Key未配置")
            return None

        # TODO: api_key_encrypted 需要解密后使用，暂时直接使用
        api_key = config.api_key_encrypted

        # 创建 OpenAI 客户端（配置全局超时）
        client_kwargs = {
            "api_key": api_key,
            "timeout": 30.0  # 全局超时 30 秒
        }
        if config.base_url:
            client_kwargs["base_url"] = config.base_url

        return AsyncOpenAI(**client_kwargs)

    async def translate_text(
        self,
        text: str,
        source_lang: Optional[str] = None,
        target_lang: Optional[str] = None
    ) -> Optional[str]:
        """
        翻译文本（自动识别中俄文并互译）

        Args:
            text: 要翻译的文本
            source_lang: 源语言代码（保留兼容性，未使用）
            target_lang: 目标语言代码（保留兼容性，未使用）

        Returns:
            翻译后的文本，失败返回None
        """
        if not text or not text.strip():
            return None

        # 获取配置
        config = await self.get_config()
        if not config or not config.enabled:
            logger.warning("ChatGPT翻译未配置或未启用")
            return None

        # 获取客户端
        client = await self._get_client()
        if not client:
            return None

        try:
            # 使用新版 Responses API
            # 注意：gpt-5-mini 不支持 temperature 参数
            response = await client.responses.create(
                model=config.model_name,
                input=[
                    {
                        "role": "system",
                        "content": config.system_prompt
                    },
                    {
                        "role": "user",
                        "content": text
                    }
                ]
            )

            # 提取翻译结果（使用新版 API 的简洁方法）
            translated = response.output_text.strip()
            logger.info(
                f"ChatGPT翻译成功: 原文长度={len(text)}, "
                f"译文长度={len(translated)}, "
                f"模型={config.model_name}, "
                f"tokens={response.usage.total_tokens if response.usage else 0}"
            )
            return translated

        except OpenAIError as e:
            logger.error(f"调用ChatGPT API失败: {e}", exc_info=True)
            logger.error(f"OpenAI错误详情: type={type(e).__name__}, message={str(e)}")
            return None
        except Exception as e:
            logger.error(f"翻译时发生未知错误: {e}", exc_info=True)
            logger.error(f"未知错误详情: type={type(e).__name__}, message={str(e)}")
            return None

    def detect_language_from_sender(self, sender_type: str) -> str:
        """
        根据发送者类型检测语言

        Args:
            sender_type: 发送者类型 (user/support/seller)

        Returns:
            语言代码 (zh/ru)（仅用于兼容性，ChatGPT自动识别）
        """
        # user(买家) 和 support(客服) 使用俄语
        # seller(卖家) 使用中文
        if sender_type in ('user', 'support'):
            return 'ru'
        elif sender_type == 'seller':
            return 'zh'
        else:
            logger.warning(f"未知的发送者类型: {sender_type}，默认为俄语")
            return 'ru'

    async def translate_message(
        self,
        content: str,
        sender_type: str
    ) -> Optional[str]:
        """
        根据发送者类型自动翻译消息

        Args:
            content: 消息内容
            sender_type: 发送者类型

        Returns:
            翻译后的文本
        """
        # ChatGPT 自动识别语言，无需指定 source_lang 和 target_lang
        return await self.translate_text(content)

    async def test_connection(self) -> bool:
        """
        测试翻译服务连接

        Returns:
            连接是否成功
        """
        try:
            # 获取配置（不检查 enabled 状态）
            config = await self.get_config()
            if not config:
                logger.warning("ChatGPT翻译未配置")
                return False

            if not config.api_key_encrypted:
                logger.warning("ChatGPT API Key未配置")
                return False

            # TODO: api_key_encrypted 需要解密后使用，暂时直接使用
            api_key = config.api_key_encrypted

            # 创建客户端（配置超时）
            client_kwargs = {
                "api_key": api_key,
                "timeout": 10.0  # 测试超时 10 秒
            }
            if config.base_url:
                client_kwargs["base_url"] = config.base_url

            client = AsyncOpenAI(**client_kwargs)

            # 发送测试请求（翻译"你好"）
            # 使用新版 Responses API
            # 注意：gpt-5-mini 不支持 temperature 参数
            response = await client.responses.create(
                model=config.model_name,
                input=[
                    {
                        "role": "system",
                        "content": config.system_prompt
                    },
                    {
                        "role": "user",
                        "content": "你好"
                    }
                ]
            )

            # 检查响应（使用新版 API 的结构）
            if response.output_text and response.output_text.strip():
                logger.info("ChatGPT翻译连接测试成功")
                return True
            else:
                logger.error("ChatGPT翻译连接测试失败: 响应为空")
                return False

        except OpenAIError as e:
            logger.error(f"ChatGPT连接测试失败: {e}", exc_info=True)
            return False
        except Exception as e:
            logger.error(f"测试连接时发生未知错误: {e}", exc_info=True)
            return False
