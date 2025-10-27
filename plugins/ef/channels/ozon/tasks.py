"""
Ozon 插件的 Celery 后台任务
"""
import os
import base64
from ef_core.tasks.celery_app import celery_app
from ef_core.database import get_db_manager
from ef_core.utils.logger import get_logger
from sqlalchemy import select, update

logger = get_logger(__name__)


@celery_app.task(bind=True, name="ef.ozon.download_label_pdf")
def download_label_pdf_task(self, posting_number: str, shop_id: int):
    """
    下载并保存标签PDF的后台任务

    Args:
        posting_number: 货件编号
        shop_id: 店铺ID
    """
    import asyncio

    # 在同步任务中运行异步代码
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(_download_label_pdf_async(posting_number, shop_id))
    finally:
        loop.close()


async def _download_label_pdf_async(posting_number: str, shop_id: int):
    """异步下载标签PDF（内部实现）"""
    from .models import OzonShop, OzonPosting
    from .utils.datetime_utils import utcnow

    try:
        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            # 获取店铺信息
            shop_result = await db.execute(
                select(OzonShop).where(OzonShop.id == shop_id)
            )
            shop = shop_result.scalar_one_or_none()

            if not shop:
                logger.error(f"Shop {shop_id} not found for label download")
                return

            # 检查posting是否已有缓存的标签
            posting_result = await db.execute(
                select(OzonPosting).where(OzonPosting.posting_number == posting_number)
            )
            posting = posting_result.scalar_one_or_none()

            if not posting:
                logger.error(f"Posting {posting_number} not found for label download")
                return

            # 如果已有标签文件且文件存在，跳过下载
            if posting.label_pdf_path and os.path.exists(posting.label_pdf_path):
                logger.info(f"Posting {posting_number} 标签PDF已存在，跳过下载")
                return

            # 调用OZON API下载标签
            from .api.client import OzonAPIClient

            async with OzonAPIClient(shop.client_id, shop.api_key_enc, shop.id) as client:
                try:
                    result = await client.get_package_labels([posting_number])

                    # 解析PDF数据
                    pdf_content_base64 = result.get('file_content', '')
                    if not pdf_content_base64:
                        logger.warning(f"OZON API返回的标签PDF内容为空: {posting_number}")
                        return

                    pdf_content = base64.b64decode(pdf_content_base64)

                    # 保存PDF文件
                    label_dir = f"web/dist/downloads/labels/{shop_id}"
                    os.makedirs(label_dir, exist_ok=True)
                    pdf_path = f"{label_dir}/{posting_number}.pdf"

                    with open(pdf_path, 'wb') as f:
                        f.write(pdf_content)

                    # 更新数据库
                    await db.execute(
                        update(OzonPosting)
                        .where(OzonPosting.posting_number == posting_number)
                        .values(label_pdf_path=pdf_path, updated_at=utcnow())
                    )
                    await db.commit()

                    logger.info(f"✅ 成功自动下载并保存标签PDF: {pdf_path}")

                except Exception as e:
                    logger.warning(f"自动下载标签PDF失败 {posting_number}: {e}")
                    # 不抛出异常，避免任务重试

    except Exception as e:
        logger.error(f"下载标签PDF任务异常 {posting_number}: {e}")
