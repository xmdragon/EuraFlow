"""
草稿与模板管理服务
"""
import logging
from typing import Optional
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, and_, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from ..models.draft_template import OzonProductTemplate

logger = logging.getLogger(__name__)


class DraftTemplateService:
    """草稿与模板管理服务（单一服务原则）"""

    @staticmethod
    async def save_or_update_draft(
        db: AsyncSession,
        user_id: int,
        form_data: dict,
        shop_id: Optional[int] = None,
        category_id: Optional[int] = None
    ) -> OzonProductTemplate:
        """保存或更新草稿（幂等）

        Args:
            db: 数据库会话
            user_id: 用户ID
            form_data: 完整表单数据
            shop_id: 店铺ID（可选）
            category_id: 类目ID（可选）

        Returns:
            保存的草稿对象
        """
        stmt = insert(OzonProductTemplate).values(
            user_id=user_id,
            template_type="draft",
            shop_id=shop_id,
            category_id=category_id,
            form_data=form_data
        ).on_conflict_do_update(
            index_elements=["user_id"],
            index_where=(OzonProductTemplate.template_type == "draft"),
            set_={
                "shop_id": shop_id,
                "category_id": category_id,
                "form_data": form_data,
                "updated_at": OzonProductTemplate.updated_at
            }
        ).returning(OzonProductTemplate)

        result = await db.execute(stmt)
        await db.commit()
        draft = result.scalar_one()
        logger.info(f"Saved draft for user {user_id}, draft_id={draft.id}")
        return draft

    @staticmethod
    async def get_latest_draft(
        db: AsyncSession,
        user_id: int
    ) -> Optional[OzonProductTemplate]:
        """获取最新草稿

        Args:
            db: 数据库会话
            user_id: 用户ID

        Returns:
            草稿对象或None
        """
        stmt = select(OzonProductTemplate).where(
            and_(
                OzonProductTemplate.user_id == user_id,
                OzonProductTemplate.template_type == "draft"
            )
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def delete_draft(
        db: AsyncSession,
        user_id: int,
        draft_id: int
    ) -> bool:
        """删除草稿

        Args:
            db: 数据库会话
            user_id: 用户ID
            draft_id: 草稿ID

        Returns:
            是否删除成功
        """
        stmt = select(OzonProductTemplate).where(
            and_(
                OzonProductTemplate.id == draft_id,
                OzonProductTemplate.user_id == user_id,
                OzonProductTemplate.template_type == "draft"
            )
        )
        result = await db.execute(stmt)
        draft = result.scalar_one_or_none()

        if not draft:
            return False

        await db.delete(draft)
        await db.commit()
        logger.info(f"Deleted draft {draft_id} for user {user_id}")
        return True

    @staticmethod
    async def create_template(
        db: AsyncSession,
        user_id: int,
        template_name: str,
        form_data: dict,
        shop_id: Optional[int] = None,
        category_id: Optional[int] = None,
        tags: Optional[list[str]] = None
    ) -> OzonProductTemplate:
        """创建模板

        Args:
            db: 数据库会话
            user_id: 用户ID
            template_name: 模板名称
            form_data: 完整表单数据
            shop_id: 店铺ID（可选）
            category_id: 类目ID（可选）
            tags: 模板标签（可选，最多10个）

        Returns:
            创建的模板对象
        """
        template = OzonProductTemplate(
            user_id=user_id,
            template_type="template",
            template_name=template_name,
            shop_id=shop_id,
            category_id=category_id,
            form_data=form_data,
            tags=tags[:10] if tags else None  # 限制最多10个标签
        )
        db.add(template)
        await db.commit()
        await db.refresh(template)
        logger.info(f"Created template '{template_name}' for user {user_id}, template_id={template.id}")
        return template

    @staticmethod
    async def get_templates(
        db: AsyncSession,
        user_id: int,
        shop_id: Optional[int] = None,
        category_id: Optional[int] = None,
        tag: Optional[str] = None
    ) -> list[OzonProductTemplate]:
        """获取模板列表

        Args:
            db: 数据库会话
            user_id: 用户ID
            shop_id: 店铺ID（可选，用于筛选）
            category_id: 类目ID（可选，用于筛选）
            tag: 标签（可选，筛选包含该标签的模板）

        Returns:
            模板列表
        """
        conditions = [
            OzonProductTemplate.user_id == user_id,
            OzonProductTemplate.template_type == "template"
        ]

        if shop_id is not None:
            conditions.append(OzonProductTemplate.shop_id == shop_id)
        if category_id is not None:
            conditions.append(OzonProductTemplate.category_id == category_id)
        if tag is not None:
            # PostgreSQL array contains operator
            conditions.append(OzonProductTemplate.tags.contains([tag]))

        stmt = select(OzonProductTemplate).where(
            and_(*conditions)
        ).order_by(desc(OzonProductTemplate.updated_at))

        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_template_by_id(
        db: AsyncSession,
        user_id: int,
        template_id: int
    ) -> Optional[OzonProductTemplate]:
        """获取模板详情

        Args:
            db: 数据库会话
            user_id: 用户ID
            template_id: 模板ID

        Returns:
            模板对象或None
        """
        stmt = select(OzonProductTemplate).where(
            and_(
                OzonProductTemplate.id == template_id,
                OzonProductTemplate.user_id == user_id,
                OzonProductTemplate.template_type == "template"
            )
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def update_template(
        db: AsyncSession,
        user_id: int,
        template_id: int,
        template_name: Optional[str] = None,
        form_data: Optional[dict] = None,
        tags: Optional[list[str]] = None
    ) -> Optional[OzonProductTemplate]:
        """更新模板

        Args:
            db: 数据库会话
            user_id: 用户ID
            template_id: 模板ID
            template_name: 模板名称（可选）
            form_data: 完整表单数据（可选）
            tags: 模板标签（可选，最多10个）

        Returns:
            更新后的模板对象或None
        """
        template = await DraftTemplateService.get_template_by_id(db, user_id, template_id)
        if not template:
            return None

        if template_name is not None:
            template.template_name = template_name
        if form_data is not None:
            template.form_data = form_data
        if tags is not None:
            template.tags = tags[:10] if tags else None  # 限制最多10个标签

        await db.commit()
        await db.refresh(template)
        logger.info(f"Updated template {template_id} for user {user_id}")
        return template

    @staticmethod
    async def delete_template(
        db: AsyncSession,
        user_id: int,
        template_id: int
    ) -> bool:
        """删除模板

        Args:
            db: 数据库会话
            user_id: 用户ID
            template_id: 模板ID

        Returns:
            是否删除成功
        """
        template = await DraftTemplateService.get_template_by_id(db, user_id, template_id)
        if not template:
            return False

        await db.delete(template)
        await db.commit()
        logger.info(f"Deleted template {template_id} for user {user_id}")
        return True

    @staticmethod
    async def record_template_usage(
        db: AsyncSession,
        user_id: int,
        template_id: int
    ) -> bool:
        """记录模板使用（增加使用次数和更新最后使用时间）

        Args:
            db: 数据库会话
            user_id: 用户ID
            template_id: 模板ID

        Returns:
            是否记录成功
        """
        template = await DraftTemplateService.get_template_by_id(db, user_id, template_id)
        if not template:
            return False

        template.used_count = (template.used_count or 0) + 1
        template.last_used_at = datetime.now(timezone.utc)

        await db.commit()
        logger.info(f"Recorded usage for template {template_id}, total uses: {template.used_count}")
        return True

    @staticmethod
    async def cleanup_old_drafts(
        db: AsyncSession,
        days: int = 30
    ) -> int:
        """清理过期草稿

        Args:
            db: 数据库会话
            days: 清理多少天前的草稿（默认30天）

        Returns:
            清理的草稿数量
        """
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

        stmt = delete(OzonProductTemplate).where(
            and_(
                OzonProductTemplate.template_type == "draft",
                OzonProductTemplate.updated_at < cutoff_date
            )
        ).returning(OzonProductTemplate.id)

        result = await db.execute(stmt)
        deleted_ids = result.scalars().all()
        deleted_count = len(deleted_ids)

        await db.commit()
        logger.info(f"Cleaned up {deleted_count} old drafts (older than {days} days)")
        return deleted_count
