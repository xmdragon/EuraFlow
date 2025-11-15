"""
商品采集记录管理服务
用于管理跟卖上架和普通采集两种场景
"""
import logging
from typing import Optional, List
from datetime import datetime, timezone

from sqlalchemy import select, and_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.collection_record import OzonProductCollectionRecord
from ..models.products import OzonProduct

logger = logging.getLogger(__name__)


class CollectionRecordService:
    """商品采集记录管理服务（单一服务原则）"""

    @staticmethod
    async def create_collection_record(
        db: AsyncSession,
        user_id: int,
        collection_type: str,
        source_url: str,
        product_data: dict,
        shop_id: Optional[int] = None,
        source_product_id: Optional[str] = None
    ) -> OzonProductCollectionRecord:
        """创建采集记录

        Args:
            db: 数据库会话
            user_id: 用户ID
            collection_type: 采集类型（'follow_pdp' | 'collect_only'）
            source_url: 商品来源URL
            product_data: 完整商品数据
            shop_id: 店铺ID（可选）
            source_product_id: 来源商品ID（可选）

        Returns:
            采集记录对象
        """
        record = OzonProductCollectionRecord(
            user_id=user_id,
            shop_id=shop_id,
            collection_type=collection_type,
            source_url=source_url,
            source_product_id=source_product_id,
            product_data=product_data
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        logger.info(
            f"Created collection record, user_id={user_id}, "
            f"collection_type={collection_type}, record_id={record.id}"
        )
        return record

    @staticmethod
    async def update_listing_status(
        db: AsyncSession,
        record_id: int,
        listing_status: str,
        listing_task_id: Optional[str] = None,
        listing_product_id: Optional[int] = None,
        listing_error_message: Optional[str] = None,
        listing_request_payload: Optional[dict] = None
    ) -> OzonProductCollectionRecord:
        """更新上架状态

        Args:
            db: 数据库会话
            record_id: 采集记录ID
            listing_status: 上架状态
            listing_task_id: OZON任务ID
            listing_product_id: 关联的正式商品ID
            listing_error_message: 错误信息
            listing_request_payload: 上架请求数据

        Returns:
            更新后的记录
        """
        stmt = select(OzonProductCollectionRecord).where(
            OzonProductCollectionRecord.id == record_id
        )
        result = await db.execute(stmt)
        record = result.scalar_one()

        record.listing_status = listing_status
        if listing_task_id:
            record.listing_task_id = listing_task_id
        if listing_product_id:
            record.listing_product_id = listing_product_id
        if listing_error_message:
            record.listing_error_message = listing_error_message
        if listing_request_payload:
            record.listing_request_payload = listing_request_payload

        if listing_status in ('success', 'failed'):
            record.listing_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(record)
        logger.info(
            f"Updated listing status, record_id={record_id}, "
            f"status={listing_status}"
        )
        return record

    @staticmethod
    async def get_records(
        db: AsyncSession,
        user_id: int,
        collection_type: str,
        shop_id: Optional[int] = None,
        page: int = 1,
        page_size: int = 20
    ) -> tuple[List[OzonProductCollectionRecord], int]:
        """查询采集记录列表

        Args:
            db: 数据库会话
            user_id: 用户ID
            collection_type: 采集类型
            shop_id: 店铺ID（可选）
            page: 页码
            page_size: 每页数量

        Returns:
            (记录列表, 总数)
        """
        # 构建查询条件
        conditions = [
            OzonProductCollectionRecord.user_id == user_id,
            OzonProductCollectionRecord.collection_type == collection_type,
            OzonProductCollectionRecord.is_deleted == False  # noqa: E712
        ]
        if shop_id:
            conditions.append(OzonProductCollectionRecord.shop_id == shop_id)

        # 查询总数
        count_stmt = select(func.count()).where(and_(*conditions))
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()

        # 查询列表
        stmt = (
            select(OzonProductCollectionRecord)
            .where(and_(*conditions))
            .order_by(desc(OzonProductCollectionRecord.created_at))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await db.execute(stmt)
        records = list(result.scalars().all())

        return records, total

    @staticmethod
    async def get_record_by_id(
        db: AsyncSession,
        record_id: int,
        user_id: int
    ) -> Optional[OzonProductCollectionRecord]:
        """根据ID查询采集记录

        Args:
            db: 数据库会话
            record_id: 记录ID
            user_id: 用户ID（权限校验）

        Returns:
            采集记录对象或None
        """
        stmt = select(OzonProductCollectionRecord).where(
            and_(
                OzonProductCollectionRecord.id == record_id,
                OzonProductCollectionRecord.user_id == user_id,
                OzonProductCollectionRecord.is_deleted == False  # noqa: E712
            )
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def update_record(
        db: AsyncSession,
        record_id: int,
        user_id: int,
        product_data: dict
    ) -> OzonProductCollectionRecord:
        """更新采集记录

        Args:
            db: 数据库会话
            record_id: 记录ID
            user_id: 用户ID（权限校验）
            product_data: 更新的商品数据

        Returns:
            更新后的记录
        """
        record = await CollectionRecordService.get_record_by_id(db, record_id, user_id)
        if not record:
            raise ValueError(f"Record not found: {record_id}")

        record.product_data = product_data
        record.last_edited_at = datetime.now(timezone.utc)
        record.last_edited_by = user_id

        await db.commit()
        await db.refresh(record)
        logger.info(f"Updated record, record_id={record_id}, user_id={user_id}")
        return record

    @staticmethod
    async def soft_delete(
        db: AsyncSession,
        record_id: int,
        user_id: int
    ) -> bool:
        """软删除采集记录

        Args:
            db: 数据库会话
            record_id: 记录ID
            user_id: 用户ID（权限校验）

        Returns:
            是否成功删除
        """
        record = await CollectionRecordService.get_record_by_id(db, record_id, user_id)
        if not record:
            return False

        record.is_deleted = True
        await db.commit()
        logger.info(f"Soft deleted record, record_id={record_id}, user_id={user_id}")
        return True

    @staticmethod
    def convert_to_draft_data(product_data: dict) -> dict:
        """将采集记录数据转换为草稿数据格式

        Args:
            product_data: 采集记录的商品数据

        Returns:
            草稿数据（符合ProductCreate页面的表单格式）
        """
        # 简单映射（具体字段根据实际需求调整）
        draft_data = {
            "title": product_data.get("title"),
            "title_cn": product_data.get("title_cn"),
            "images": product_data.get("images", []),
            "price": product_data.get("price"),
            "width": product_data.get("width"),
            "height": product_data.get("height"),
            "depth": product_data.get("depth"),
            "weight": product_data.get("weight"),
            "attributes": product_data.get("attributes", {}),
            "variants": product_data.get("variants", []),
        }
        return draft_data
