"""
商品错误处理器

负责管理商品同步错误记录的 CRUD 操作。
"""

from typing import Optional, List
import logging

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ....models.products import OzonProductSyncError
from ....utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class ProductErrorHandler:
    """商品错误处理器"""

    async def save_error(
        self,
        db: AsyncSession,
        shop_id: int,
        product_id: Optional[int],
        offer_id: str,
        task_id: Optional[int],
        status: Optional[str],
        errors: list
    ) -> None:
        """
        保存商品错误信息（OZON平台返回的商品审核错误）

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            product_id: 商品ID（可能为None，如果是新商品）
            offer_id: 商品offer_id
            task_id: 任务ID（可选）
            status: 商品状态
            errors: OZON返回的错误列表
        """
        if not errors:
            return

        try:
            # 查找现有错误记录
            existing_error_result = await db.execute(
                select(OzonProductSyncError).where(
                    and_(
                        OzonProductSyncError.shop_id == shop_id,
                        OzonProductSyncError.offer_id == offer_id
                    )
                ).order_by(OzonProductSyncError.created_at.desc()).limit(1)
            )
            existing_error = existing_error_result.scalar_one_or_none()

            if existing_error:
                # 更新现有错误记录
                existing_error.product_id = product_id
                existing_error.task_id = task_id
                existing_error.status = status
                existing_error.errors = errors
                existing_error.updated_at = utcnow()
                logger.info(f"Updated product error for {offer_id}: {len(errors)} errors")
            else:
                # 创建新错误记录
                sync_error = OzonProductSyncError(
                    shop_id=shop_id,
                    product_id=product_id,
                    offer_id=offer_id,
                    task_id=task_id,
                    status=status,
                    errors=errors,
                    created_at=utcnow(),
                    updated_at=utcnow()
                )
                db.add(sync_error)
                logger.info(f"Created product error record for {offer_id}: {len(errors)} errors")

        except Exception as e:
            logger.error(f"Failed to save product error for {offer_id}: {e}")

    async def clear_error(
        self,
        db: AsyncSession,
        shop_id: int,
        offer_id: str
    ) -> None:
        """
        清除商品错误信息（当商品错误已修复时）

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            offer_id: 商品offer_id
        """
        try:
            # 查找并删除现有错误记录
            existing_error_result = await db.execute(
                select(OzonProductSyncError).where(
                    and_(
                        OzonProductSyncError.shop_id == shop_id,
                        OzonProductSyncError.offer_id == offer_id
                    )
                )
            )
            existing_errors = existing_error_result.scalars().all()

            if existing_errors:
                for error in existing_errors:
                    await db.delete(error)
                logger.info(f"Cleared {len(existing_errors)} product error(s) for {offer_id}")

        except Exception as e:
            logger.error(f"Failed to clear product error for {offer_id}: {e}")

    async def get_errors(
        self,
        db: AsyncSession,
        shop_id: int,
        product_id: Optional[int] = None,
        offer_id: Optional[str] = None
    ) -> List[OzonProductSyncError]:
        """
        获取商品的所有错误

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            product_id: 商品ID（可选）
            offer_id: 商品offer_id（可选）

        Returns:
            错误记录列表
        """
        try:
            conditions = [OzonProductSyncError.shop_id == shop_id]

            if product_id:
                conditions.append(OzonProductSyncError.product_id == product_id)
            if offer_id:
                conditions.append(OzonProductSyncError.offer_id == offer_id)

            result = await db.execute(
                select(OzonProductSyncError).where(and_(*conditions))
            )
            return list(result.scalars().all())

        except Exception as e:
            logger.error(f"Failed to get product errors: {e}")
            return []
