"""
OZON类目服务
负责类目、属性、字典值的拉取、缓存与查询
"""
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ..api.client import OzonAPIClient
from ..models.listing import (
    OzonCategory,
    OzonCategoryAttribute,
    OzonAttributeDictionaryValue
)

logger = get_logger(__name__)


class CatalogService:
    """OZON类目服务"""

    def __init__(self, ozon_client: OzonAPIClient, db: AsyncSession):
        """
        初始化类目服务

        Args:
            ozon_client: OZON API客户端
            db: 数据库会话
        """
        self.client = ozon_client
        self.db = db

    async def sync_category_tree(
        self,
        root_category_id: Optional[int] = None,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        同步类目树

        Args:
            root_category_id: 根类目ID(None表示从顶层开始)
            force_refresh: 是否强制刷新

        Returns:
            同步结果
        """
        try:
            logger.info(f"Starting category tree sync, root={root_category_id}, force={force_refresh}")

            # 检查缓存是否过期
            if not force_refresh and root_category_id is None:
                cached_count = await self.db.scalar(
                    select(func.count(OzonCategory.category_id))
                )
                if cached_count and cached_count > 0:
                    logger.info(f"Category cache exists ({cached_count} categories), skipping sync")
                    return {"success": True, "cached": True, "count": cached_count}

            # 调用OZON API获取类目树
            response = await self.client.get_category_tree(
                category_id=root_category_id
            )

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Failed to fetch category tree: {error_msg}")
                return {"success": False, "error": error_msg}

            categories = response["result"]
            synced_count = 0

            # 递归保存类目
            for category_data in categories:
                synced_count += await self._save_category_recursive(
                    category_data,
                    parent_id=root_category_id
                )

            await self.db.commit()

            logger.info(f"Category tree sync completed: {synced_count} categories")

            return {
                "success": True,
                "synced_count": synced_count,
                "cached": False
            }

        except Exception as e:
            logger.error(f"Category tree sync failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _save_category_recursive(
        self,
        category_data: Dict[str, Any],
        parent_id: Optional[int] = None,
        level: int = 0
    ) -> int:
        """
        递归保存类目（包含子类目）

        Args:
            category_data: 类目数据
            parent_id: 父类目ID
            level: 层级深度

        Returns:
            保存的类目数量
        """
        category_id = category_data.get("category_id")
        if not category_id:
            return 0

        # 检查类目是否已存在
        existing = await self.db.get(OzonCategory, category_id)

        if existing:
            # 更新现有类目
            existing.name = category_data.get("title", "")
            existing.is_leaf = not category_data.get("children")
            existing.is_disabled = category_data.get("disabled", False)
            existing.level = level
            existing.last_updated_at = datetime.utcnow()
        else:
            # 创建新类目
            category = OzonCategory(
                category_id=category_id,
                parent_id=parent_id,
                name=category_data.get("title", ""),
                is_leaf=not category_data.get("children"),
                is_disabled=category_data.get("disabled", False),
                level=level
            )
            self.db.add(category)

        count = 1

        # 递归处理子类目
        children = category_data.get("children", [])
        for child_data in children:
            count += await self._save_category_recursive(
                child_data,
                parent_id=category_id,
                level=level + 1
            )

        return count

    async def sync_category_attributes(
        self,
        category_id: int,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        同步类目属性

        Args:
            category_id: 类目ID
            force_refresh: 是否强制刷新

        Returns:
            同步结果
        """
        try:
            # 检查缓存
            if not force_refresh:
                cached_attrs = await self.db.scalars(
                    select(OzonCategoryAttribute).where(
                        OzonCategoryAttribute.category_id == category_id
                    )
                )
                cached_count = len(list(cached_attrs))
                if cached_count > 0:
                    logger.info(f"Category {category_id} attributes cached ({cached_count}), skipping")
                    return {"success": True, "cached": True, "count": cached_count}

            # 调用API
            response = await self.client.get_category_attributes(
                category_id=category_id,
                attribute_type="ALL"
            )

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Failed to fetch category attributes: {error_msg}")
                return {"success": False, "error": error_msg}

            attributes = response["result"]
            synced_count = 0

            for attr_data in attributes:
                await self._save_category_attribute(category_id, attr_data)
                synced_count += 1

            await self.db.commit()

            logger.info(f"Synced {synced_count} attributes for category {category_id}")

            return {
                "success": True,
                "synced_count": synced_count,
                "cached": False
            }

        except Exception as e:
            logger.error(f"Failed to sync category attributes: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _save_category_attribute(
        self,
        category_id: int,
        attr_data: Dict[str, Any]
    ):
        """保存单个类目属性"""
        attribute_id = attr_data.get("id")
        if not attribute_id:
            return

        # 检查是否存在
        stmt = select(OzonCategoryAttribute).where(
            and_(
                OzonCategoryAttribute.category_id == category_id,
                OzonCategoryAttribute.attribute_id == attribute_id
            )
        )
        existing = await self.db.scalar(stmt)

        attr_info = {
            "category_id": category_id,
            "attribute_id": attribute_id,
            "name": attr_data.get("name", ""),
            "description": attr_data.get("description", ""),
            "attribute_type": attr_data.get("type", "string"),
            "is_required": attr_data.get("is_required", False),
            "is_collection": attr_data.get("is_collection", False),
            "dictionary_id": attr_data.get("dictionary_id"),
        }

        if existing:
            for key, value in attr_info.items():
                setattr(existing, key, value)
        else:
            attribute = OzonCategoryAttribute(**attr_info)
            self.db.add(attribute)

    async def sync_attribute_values(
        self,
        attribute_id: int,
        category_id: int,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        同步属性字典值（支持分页）

        Args:
            attribute_id: 属性ID
            category_id: 类目ID
            force_refresh: 是否强制刷新

        Returns:
            同步结果
        """
        try:
            # 先获取属性信息确认dictionary_id
            stmt = select(OzonCategoryAttribute).where(
                and_(
                    OzonCategoryAttribute.category_id == category_id,
                    OzonCategoryAttribute.attribute_id == attribute_id
                )
            )
            attr = await self.db.scalar(stmt)

            if not attr or not attr.dictionary_id:
                logger.warning(f"Attribute {attribute_id} has no dictionary_id")
                return {"success": True, "skipped": True, "reason": "no_dictionary"}

            dictionary_id = attr.dictionary_id

            # 检查缓存
            if not force_refresh:
                cached_count = await self.db.scalar(
                    select(func.count(OzonAttributeDictionaryValue.id)).where(
                        OzonAttributeDictionaryValue.dictionary_id == dictionary_id
                    )
                )
                if cached_count and cached_count > 0:
                    logger.info(f"Dictionary {dictionary_id} cached ({cached_count}), skipping")
                    return {"success": True, "cached": True, "count": cached_count}

            # 分页拉取字典值
            synced_count = 0
            last_value_id = 0
            has_more = True

            while has_more:
                response = await self.client.get_attribute_values(
                    attribute_id=attribute_id,
                    category_id=category_id,
                    last_value_id=last_value_id,
                    limit=5000
                )

                if not response.get("result"):
                    break

                values = response.get("result", [])
                if not values:
                    break

                for value_data in values:
                    await self._save_dictionary_value(dictionary_id, value_data)
                    synced_count += 1
                    last_value_id = value_data.get("id", 0)

                # 如果返回数量小于limit,说明没有更多数据了
                has_more = len(values) >= 5000

            await self.db.commit()

            logger.info(f"Synced {synced_count} values for dictionary {dictionary_id}")

            return {
                "success": True,
                "synced_count": synced_count,
                "cached": False
            }

        except Exception as e:
            logger.error(f"Failed to sync attribute values: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _save_dictionary_value(
        self,
        dictionary_id: int,
        value_data: Dict[str, Any]
    ):
        """保存单个字典值"""
        value_id = value_data.get("id")
        if not value_id:
            return

        # 检查是否存在
        stmt = select(OzonAttributeDictionaryValue).where(
            and_(
                OzonAttributeDictionaryValue.dictionary_id == dictionary_id,
                OzonAttributeDictionaryValue.value_id == value_id
            )
        )
        existing = await self.db.scalar(stmt)

        value_info = {
            "dictionary_id": dictionary_id,
            "value_id": value_id,
            "value": value_data.get("value", ""),
            "info": value_data.get("info", ""),
            "picture": value_data.get("picture", ""),
        }

        if existing:
            for key, value in value_info.items():
                setattr(existing, key, value)
        else:
            dict_value = OzonAttributeDictionaryValue(**value_info)
            self.db.add(dict_value)

    # ========== 查询接口 ==========

    async def search_categories(
        self,
        query: str,
        only_leaf: bool = True,
        limit: int = 20
    ) -> List[OzonCategory]:
        """
        搜索类目

        Args:
            query: 搜索关键词
            only_leaf: 仅返回叶子类目
            limit: 返回数量限制

        Returns:
            类目列表
        """
        stmt = select(OzonCategory).where(
            OzonCategory.name.ilike(f"%{query}%")
        )

        if only_leaf:
            stmt = stmt.where(OzonCategory.is_leaf == True)

        stmt = stmt.limit(limit)

        result = await self.db.scalars(stmt)
        return list(result)

    async def get_category_attributes(
        self,
        category_id: int,
        required_only: bool = False
    ) -> List[OzonCategoryAttribute]:
        """
        获取类目属性列表

        Args:
            category_id: 类目ID
            required_only: 仅返回必填属性

        Returns:
            属性列表
        """
        stmt = select(OzonCategoryAttribute).where(
            OzonCategoryAttribute.category_id == category_id
        )

        if required_only:
            stmt = stmt.where(OzonCategoryAttribute.is_required == True)

        result = await self.db.scalars(stmt)
        return list(result)

    async def search_dictionary_values(
        self,
        dictionary_id: int,
        query: Optional[str] = None,
        limit: int = 100
    ) -> List[OzonAttributeDictionaryValue]:
        """
        搜索字典值

        Args:
            dictionary_id: 字典ID
            query: 搜索关键词
            limit: 返回数量限制

        Returns:
            字典值列表
        """
        stmt = select(OzonAttributeDictionaryValue).where(
            OzonAttributeDictionaryValue.dictionary_id == dictionary_id
        )

        if query:
            stmt = stmt.where(
                OzonAttributeDictionaryValue.value.ilike(f"%{query}%")
            )

        stmt = stmt.limit(limit)

        result = await self.db.scalars(stmt)
        return list(result)


# 导入func用于count
from sqlalchemy import func
