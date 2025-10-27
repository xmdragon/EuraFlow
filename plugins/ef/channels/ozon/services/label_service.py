"""
标签服务
负责标签PDF的下载、保存和管理
"""
import os
import base64
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.orders import OzonPosting
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class LabelService:
    """标签管理服务"""

    # 标签存储根目录（使用 public 目录，避免重新构建时丢失）
    LABEL_ROOT_DIR = "web/public/downloads/labels"

    def __init__(self, db: AsyncSession):
        self.db = db

    @classmethod
    def get_label_dir(cls, shop_id: int) -> str:
        """
        获取标签存储目录

        Args:
            shop_id: 店铺ID

        Returns:
            标签存储目录路径
        """
        return f"{cls.LABEL_ROOT_DIR}/{shop_id}"

    @classmethod
    def get_label_path(cls, shop_id: int, posting_number: str) -> str:
        """
        获取标签文件路径

        Args:
            shop_id: 店铺ID
            posting_number: 货件编号

        Returns:
            标签文件完整路径
        """
        return f"{cls.get_label_dir(shop_id)}/{posting_number}.pdf"

    @classmethod
    def get_label_url(cls, shop_id: int, posting_number: str) -> str:
        """
        获取标签访问URL

        Args:
            shop_id: 店铺ID
            posting_number: 货件编号

        Returns:
            标签访问URL（相对路径）
        """
        return f"/downloads/labels/{shop_id}/{posting_number}.pdf"

    async def download_and_save_label(
        self,
        posting_number: str,
        shop_id: int,
        api_client: OzonAPIClient,
        force: bool = False
    ) -> Dict[str, Any]:
        """
        下载并保存标签PDF

        Args:
            posting_number: 货件编号
            shop_id: 店铺ID
            api_client: OZON API客户端
            force: 是否强制重新下载（默认False，如果已有缓存则跳过）

        Returns:
            操作结果，包含：
            - success: 是否成功
            - cached: 是否使用了缓存
            - pdf_path: PDF文件路径
            - error: 错误信息（如果失败）
        """
        try:
            # 1. 检查是否已有缓存
            if not force:
                from sqlalchemy import select
                result = await self.db.execute(
                    select(OzonPosting).where(OzonPosting.posting_number == posting_number)
                )
                posting = result.scalar_one_or_none()

                if posting and posting.label_pdf_path and os.path.exists(posting.label_pdf_path):
                    logger.info(f"使用缓存的标签PDF: {posting_number}")
                    return {
                        "success": True,
                        "cached": True,
                        "pdf_path": posting.label_pdf_path
                    }

            # 2. 调用OZON API下载标签
            api_result = await api_client.get_package_labels([posting_number])

            # 3. 解析PDF数据
            pdf_content_base64 = api_result.get('file_content', '')
            if not pdf_content_base64:
                error_msg = "OZON API返回的PDF内容为空"
                logger.error(f"{error_msg}: {posting_number}, result keys: {list(api_result.keys())}")
                return {
                    "success": False,
                    "error": error_msg
                }

            pdf_content = base64.b64decode(pdf_content_base64)

            # 4. 保存PDF文件
            label_dir = self.get_label_dir(shop_id)
            os.makedirs(label_dir, exist_ok=True)
            pdf_path = self.get_label_path(shop_id, posting_number)

            with open(pdf_path, 'wb') as f:
                f.write(pdf_content)

            logger.info(f"成功保存标签PDF: {pdf_path}")

            # 5. 更新数据库
            await self.db.execute(
                update(OzonPosting)
                .where(OzonPosting.posting_number == posting_number)
                .values(label_pdf_path=pdf_path, updated_at=utcnow())
            )

            return {
                "success": True,
                "cached": False,
                "pdf_path": pdf_path
            }

        except Exception as e:
            error_msg = f"下载标签失败: {str(e)}"
            logger.error(f"{error_msg}, posting_number: {posting_number}")
            return {
                "success": False,
                "error": error_msg
            }

    async def check_label_exists(self, posting_number: str) -> bool:
        """
        检查标签文件是否存在

        Args:
            posting_number: 货件编号

        Returns:
            标签文件是否存在
        """
        from sqlalchemy import select
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if posting and posting.label_pdf_path:
            return os.path.exists(posting.label_pdf_path)

        return False
