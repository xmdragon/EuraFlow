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
        listing_task_count: Optional[int] = None,
        listing_product_id: Optional[int] = None,
        listing_error_message: Optional[str] = None,
        listing_request_payload: Optional[dict] = None
    ) -> OzonProductCollectionRecord:
        """更新上架状态

        Args:
            db: 数据库会话
            record_id: 采集记录ID
            listing_status: 上架状态
            listing_task_count: 任务数量（变体数）
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
        if listing_task_count is not None:
            record.listing_task_count = listing_task_count
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
        page_size: int = 20,
        is_admin: bool = False
    ) -> tuple[List[OzonProductCollectionRecord], int]:
        """查询采集记录列表

        Args:
            db: 数据库会话
            user_id: 用户ID
            collection_type: 采集类型，支持逗号分隔的多个类型（如 'follow_pdp,relist'）
            shop_id: 店铺ID（可选）
            page: 页码
            page_size: 每页数量
            is_admin: 是否为管理员（管理员可查看所有用户的记录）

        Returns:
            (记录列表, 总数)
        """
        # 构建查询条件
        # 支持多个 collection_type，用逗号分隔
        type_list = [t.strip() for t in collection_type.split(',') if t.strip()]
        if len(type_list) == 1:
            type_condition = OzonProductCollectionRecord.collection_type == type_list[0]
        else:
            type_condition = OzonProductCollectionRecord.collection_type.in_(type_list)

        conditions = [
            type_condition,
            OzonProductCollectionRecord.is_deleted == False  # noqa: E712
        ]
        # 非管理员只能查看自己的记录
        if not is_admin:
            conditions.append(OzonProductCollectionRecord.user_id == user_id)
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
        import time

        # 提取嵌套的 dimensions 对象
        dimensions = product_data.get("dimensions", {})

        # 处理图片格式：将 {url, is_primary} 格式转换为 URL 字符串数组
        raw_images = product_data.get("images", [])
        images = []
        for img in raw_images:
            if isinstance(img, str):
                images.append(img)
            elif isinstance(img, dict) and img.get("url"):
                images.append(img["url"])

        # 处理变体数据
        source_variants = product_data.get("variants", [])
        variant_dimensions = []
        converted_variants = []
        hidden_fields = []

        if source_variants:
            # 创建一个"规格"维度（因为采集数据只有 specifications 字符串，没有结构化的 spec_details）
            # 使用负数ID表示自定义字段
            spec_dim_id = -1000
            spec_field_key = f"dim_{spec_dim_id}"
            variant_dimensions.append({
                "attribute_id": spec_dim_id,
                "name": "规格",
                "attribute_type": "String",
                "original_field_key": spec_field_key,
            })
            hidden_fields.append(spec_field_key)

            # 转换每个变体
            for i, src_variant in enumerate(source_variants):
                # 提取变体图片
                variant_images = []
                if src_variant.get("image_url"):
                    # 使用高清图片URL（去掉 /wc140/ 等尺寸前缀）
                    image_url = src_variant["image_url"]
                    # 替换缩略图URL为原图URL
                    if "/wc140/" in image_url:
                        image_url = image_url.replace("/wc140/", "/")
                    variant_images.append(image_url)
                for img in src_variant.get("images", []):
                    if isinstance(img, str):
                        if img not in variant_images:
                            variant_images.append(img)
                    elif isinstance(img, dict) and img.get("url"):
                        if img["url"] not in variant_images:
                            variant_images.append(img["url"])

                # 构建 dimension_values - 使用 specifications 字符串作为规格值
                specifications = src_variant.get("specifications", "").strip()
                dimension_values = {spec_dim_id: specifications}

                # 生成 offer_id
                timestamp = str(int(time.time() * 1000))
                random_suffix = str(i).zfill(3)
                offer_id = f"ef_{timestamp}{random_suffix}"

                converted_variants.append({
                    "id": str(int(time.time() * 1000) + i),
                    "dimension_values": dimension_values,
                    "offer_id": offer_id,
                    "images": variant_images,
                    "price": src_variant.get("price"),
                    "old_price": src_variant.get("original_price"),
                })

        # 提取 "Тип" 属性（attribute_id=2622298）用于类目自动匹配
        # 数据库中的 attributes 是数组格式：[{attribute_id, value}, ...]
        source_attributes = product_data.get("attributes", [])
        category_type_ru = None
        if isinstance(source_attributes, list):
            for attr in source_attributes:
                if isinstance(attr, dict) and attr.get("attribute_id") == 2622298:
                    category_type_ru = attr.get("value")
                    break

        # 构建草稿数据
        draft_data = {
            "title": product_data.get("title"),
            "title_cn": product_data.get("title_cn"),
            "images": images,
            "price": product_data.get("price"),
            "old_price": product_data.get("old_price"),
            # 从 dimensions 对象中读取尺寸数据
            "width": dimensions.get("width"),
            "height": dimensions.get("height"),
            "depth": dimensions.get("length"),      # length → depth 字段名转换
            "weight": dimensions.get("weight"),
            # attributes 转换为对象格式，包含用于类目匹配的 _category_type_ru
            "attributes": {
                "_category_type_ru": category_type_ru,  # 俄文类目名称，用于自动匹配
            },
        }

        # 如果有变体，添加变体相关字段
        if converted_variants:
            draft_data["variantDimensions"] = variant_dimensions
            draft_data["variants"] = converted_variants
            draft_data["hiddenFields"] = hidden_fields
            draft_data["variantSectionExpanded"] = True

        return draft_data
