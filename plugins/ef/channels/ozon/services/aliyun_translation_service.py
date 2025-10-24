"""阿里云机器翻译服务"""
import logging
from typing import Optional
from aliyunsdkcore.client import AcsClient
from aliyunsdkalimt.request.v20181012.TranslateGeneralRequest import TranslateGeneralRequest
import json

from ef_core.database import get_db_manager
from ..models.translation import AliyunTranslationConfig

logger = logging.getLogger(__name__)


class AliyunTranslationService:
    """阿里云翻译服务"""

    def __init__(self):
        """初始化翻译服务"""
        self.db_manager = get_db_manager()

    async def get_config(self) -> Optional[AliyunTranslationConfig]:
        """获取翻译配置"""
        async with self.db_manager.get_session() as session:
            from sqlalchemy import select
            stmt = select(AliyunTranslationConfig).where(AliyunTranslationConfig.id == 1)
            config = await session.scalar(stmt)
            return config

    async def translate_text(
        self,
        text: str,
        source_lang: str,
        target_lang: str
    ) -> Optional[str]:
        """
        翻译文本

        Args:
            text: 要翻译的文本
            source_lang: 源语言代码 (zh: 中文, ru: 俄语)
            target_lang: 目标语言代码 (zh: 中文, ru: 俄语)

        Returns:
            翻译后的文本，失败返回None
        """
        if not text or not text.strip():
            return None

        # 获取配置
        config = await self.get_config()
        if not config or not config.enabled:
            logger.warning("阿里云翻译未配置或未启用")
            return None

        if not config.access_key_id or not config.access_key_secret_encrypted:
            logger.warning("阿里云翻译凭证未配置")
            return None

        try:
            # 创建阿里云客户端
            # TODO: access_key_secret_encrypted 需要解密后使用，暂时直接使用
            access_key_secret = config.access_key_secret_encrypted

            client = AcsClient(
                ak=config.access_key_id,
                secret=access_key_secret,
                region_id=config.region_id
            )

            # 构建请求
            request = TranslateGeneralRequest()
            request.set_FormatType('text')
            request.set_SourceLanguage(source_lang)
            request.set_TargetLanguage(target_lang)
            request.set_SourceText(text)
            request.set_Scene('general')

            # 发送请求
            response = client.do_action_with_exception(request)

            # 解析响应
            result = json.loads(response)

            if result.get('Code') == '200':
                translated = result.get('Data', {}).get('Translated')
                logger.info(f"翻译成功: {source_lang} -> {target_lang}, 原文长度: {len(text)}, 译文长度: {len(translated) if translated else 0}")
                return translated
            else:
                logger.error(f"翻译失败: {result.get('Code')} - {result.get('Message')}")
                return None

        except Exception as e:
            logger.error(f"调用阿里云翻译API失败: {e}", exc_info=True)
            return None

    def detect_language_from_sender(self, sender_type: str) -> str:
        """
        根据发送者类型检测语言

        Args:
            sender_type: 发送者类型 (user/support/seller)

        Returns:
            语言代码 (zh/ru)
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
        source_lang = self.detect_language_from_sender(sender_type)

        # 如果是俄语，翻译成中文
        if source_lang == 'ru':
            return await self.translate_text(content, 'ru', 'zh')
        # 如果是中文（卖家），使用自动检测翻译成俄语（支持中文、英文等多种语言）
        elif source_lang == 'zh':
            return await self.translate_text(content, 'auto', 'ru')
        else:
            return None

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
                logger.warning("阿里云翻译未配置")
                return False

            if not config.access_key_id or not config.access_key_secret_encrypted:
                logger.warning("阿里云翻译凭证未配置")
                return False

            # 创建阿里云客户端
            access_key_secret = config.access_key_secret_encrypted

            client = AcsClient(
                ak=config.access_key_id,
                secret=access_key_secret,
                region_id=config.region_id
            )

            # 构建测试请求
            request = TranslateGeneralRequest()
            request.set_FormatType('text')
            request.set_SourceLanguage('zh')
            request.set_TargetLanguage('ru')
            request.set_SourceText('你好')
            request.set_Scene('general')

            # 发送请求
            response = client.do_action_with_exception(request)

            # 解析响应
            result = json.loads(response)

            if result.get('Code') == '200':
                logger.info("阿里云翻译连接测试成功")
                return True
            else:
                logger.error(f"阿里云翻译连接测试失败: {result.get('Code')} - {result.get('Message')}")
                return False

        except Exception as e:
            logger.error(f"测试连接失败: {e}", exc_info=True)
            return False
