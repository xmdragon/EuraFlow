"""
OZON类目服务
负责类目、属性、字典值的拉取、缓存与查询
"""
import asyncio
import json
import os
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, and_, or_, update
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
        force_refresh: bool = False,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        同步类目树（中文+俄文双语）

        Args:
            root_category_id: 根类目ID(None表示从顶层开始)
            force_refresh: 是否强制刷新
            progress_callback: 进度回调函数 (current, total, category_name)

        Returns:
            同步结果
        """
        try:
            from datetime import datetime, timezone
            from sqlalchemy import func
            logger.info(f"Starting bilingual category tree sync, root={root_category_id}, force={force_refresh}")

            # 检查缓存是否过期
            if not force_refresh and root_category_id is None:
                cached_count = await self.db.scalar(
                    select(func.count(OzonCategory.category_id))
                )
                if cached_count and cached_count > 0:
                    logger.info(f"Category cache exists ({cached_count} categories), skipping sync")
                    return {"success": True, "cached": True, "total_categories": cached_count}

            # 记录同步开始时间
            sync_start_time = datetime.now(timezone.utc)

            # 第一步：同步中文
            logger.info("Step 1/2: Syncing Chinese names...")
            zh_response = await self.client.get_category_tree(
                category_id=root_category_id,
                language="ZH_HANS"
            )

            if not zh_response.get("result"):
                error_msg = zh_response.get("error", {}).get("message", "Unknown error")
                logger.error(f"Failed to fetch Chinese category tree: {error_msg}")
                return {"success": False, "error": error_msg}

            zh_categories = zh_response["result"]
            total_count = self._count_categories_recursive(zh_categories)
            logger.info(f"Total categories to sync: {total_count}")

            # 初始化进度追踪
            progress_state = {"current": 0}
            synced_count = 0
            new_count = 0
            updated_count = 0

            # 递归保存中文类目
            for category_data in zh_categories:
                result = await self._save_category_recursive(
                    category_data,
                    parent_id=root_category_id,
                    language="zh",
                    progress_state=progress_state,
                    total_count=total_count,
                    progress_callback=progress_callback
                )
                synced_count += result['count']
                new_count += result['new']
                updated_count += result['updated']

            # 提交中文数据
            await self.db.commit()
            logger.info(f"Chinese sync completed: {synced_count} categories")

            # 第二步：同步俄文
            logger.info("Step 2/2: Syncing Russian names...")
            ru_response = await self.client.get_category_tree(
                category_id=root_category_id,
                language="DEFAULT"  # OZON默认语言为俄文
            )

            if not ru_response.get("result"):
                logger.warning("Failed to fetch Russian category tree, skipping Russian names")
            else:
                ru_categories = ru_response["result"]
                progress_state = {"current": 0}

                # 递归保存俄文类目
                for category_data in ru_categories:
                    await self._save_category_recursive(
                        category_data,
                        parent_id=root_category_id,
                        language="ru",
                        progress_state=progress_state,
                        total_count=total_count,
                        progress_callback=progress_callback
                    )

                await self.db.commit()
                logger.info("Russian sync completed")

            # 第三步：更新主显示字段（name = name_zh or name_ru）
            logger.info("Step 3/3: Updating primary display fields...")
            await self.db.execute(
                update(OzonCategory)
                .values(name=func.coalesce(OzonCategory.name_zh, OzonCategory.name_ru))
            )
            await self.db.commit()

            # 标记废弃的类目（未在本次同步中更新的类目）
            deprecated_result = await self.db.execute(
                update(OzonCategory)
                .where(OzonCategory.last_updated_at < sync_start_time)
                .where(OzonCategory.is_deprecated == False)
                .values(is_deprecated=True)
            )
            deprecated_count = deprecated_result.rowcount
            await self.db.commit()

            if deprecated_count > 0:
                logger.info(f"Marked {deprecated_count} categories as deprecated")

            logger.info(f"Bilingual category tree sync completed: {synced_count} categories ({new_count} new, {updated_count} updated), {deprecated_count} deprecated")

            # 生成前端可用的 JS 文件
            await self._generate_category_tree_js()

            return {
                "success": True,
                "total_categories": synced_count,
                "new_categories": new_count,
                "updated_categories": updated_count,
                "deprecated_categories": deprecated_count,
                "cached": False
            }

        except Exception as e:
            logger.error(f"Bilingual category tree sync failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    def _count_categories_recursive(self, categories: List[Dict[str, Any]]) -> int:
        """递归计算类目树中的总类目数"""
        count = 0
        for category_data in categories:
            count += 1
            children = category_data.get("children", [])
            if children:
                count += self._count_categories_recursive(children)
        return count

    async def _save_category_recursive(
        self,
        category_data: Dict[str, Any],
        parent_id: Optional[int] = None,
        language: str = "zh",
        level: int = 0,
        progress_state: Optional[Dict] = None,
        total_count: int = 0,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, int]:
        """
        递归保存类目（包含子类目）

        Args:
            category_data: 类目数据
            parent_id: 父类目ID
            language: 语言（zh=中文, ru=俄文）
            level: 层级深度
            progress_state: 进度状态 {'current': 0}
            total_count: 总类目数
            progress_callback: 进度回调函数 (current, total, category_name)

        Returns:
            保存结果 {'count': 总数, 'new': 新增数, 'updated': 更新数}
        """
        # 兼容两种字段名：
        # 1-2级使用 description_category_id 和 category_name
        # 3级（叶子）使用 type_id 和 type_name
        category_id = category_data.get("description_category_id") or category_data.get("type_id")
        if not category_id:
            logger.warning(f"Category data missing ID, skipping: {category_data}")
            return {'count': 0, 'new': 0, 'updated': 0}

        # 检查类目是否已存在（使用 category_id + parent_id 组合查询）
        stmt = select(OzonCategory).where(
            and_(
                OzonCategory.category_id == category_id,
                OzonCategory.parent_id == parent_id if parent_id is not None
                else OzonCategory.parent_id.is_(None)
            )
        )
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()

        # 兼容两种字段名
        category_name = category_data.get("category_name") or category_data.get("type_name", "")
        children = category_data.get("children", [])
        is_disabled = category_data.get("disabled", False)

        # 判断是否叶子类目：初步判断，后续可能更新
        is_leaf = len(children) == 0

        is_new = False
        if existing:
            # 更新现有类目
            if language == "zh":
                existing.name_zh = category_name
            elif language == "ru":
                existing.name_ru = category_name

            # 仅在中文同步时更新结构字段
            if language == "zh":
                existing.is_leaf = is_leaf
                existing.is_disabled = is_disabled
                existing.is_deprecated = False  # 重新激活已废弃的类目
                existing.level = level
                existing.last_updated_at = datetime.now(timezone.utc)
        else:
            # 创建新类目（仅在中文同步时创建）
            if language == "zh":
                category = OzonCategory(
                    category_id=category_id,
                    parent_id=parent_id,
                    name=category_name,  # 主显示字段（临时设置为中文，后续会被COALESCE更新）
                    name_zh=category_name,
                    is_leaf=is_leaf,
                    is_disabled=is_disabled,
                    level=level
                )
                self.db.add(category)
                # 立即flush确保后续查询能找到此记录，避免重复插入
                await self.db.flush()
                is_new = True
            else:
                # 俄文同步时类目应该已存在，记录警告
                logger.warning(f"Category {category_id} not found during Russian sync, skipping")
                return {'count': 0, 'new': 0, 'updated': 0}

        # 更新进度（仅在中文同步时）
        if language == "zh" and progress_state is not None:
            progress_state['current'] += 1
            if progress_callback:
                progress_callback(
                    progress_state['current'],
                    total_count,
                    category_name
                )

        result = {
            'count': 1,
            'new': 1 if is_new else 0,
            'updated': 0 if is_new else 1
        }

        # 递归处理子类目（OZON API已在第一次调用时返回完整树结构）
        if children:
            for child_data in children:
                try:
                    child_result = await self._save_category_recursive(
                        child_data,
                        parent_id=category_id,
                        language=language,
                        level=level + 1,
                        progress_state=progress_state,
                        total_count=total_count,
                        progress_callback=progress_callback
                    )
                    result['count'] += child_result['count']
                    result['new'] += child_result['new']
                    result['updated'] += child_result['updated']
                except Exception as e:
                    child_id = child_data.get("description_category_id") or child_data.get("type_id")
                    child_name = child_data.get("category_name") or child_data.get("type_name")
                    logger.error(f"Failed to save child {child_id} ({child_name}): {e}", exc_info=True)

        return result

    async def sync_category_attributes(
        self,
        category_id: int,
        force_refresh: bool = False,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        同步类目属性（中文+俄文双语）

        Args:
            category_id: 类目ID
            force_refresh: 是否强制刷新
            language: 语言（保留参数以兼容旧代码，实际会同步双语）

        Returns:
            同步结果
        """
        try:
            from datetime import timedelta
            from sqlalchemy import func as sql_func

            # 检查缓存：8 天时间窗口
            needs_ru_sync = False
            sync_start_time = datetime.now(timezone.utc)

            if not force_refresh:
                cached_result = await self.db.execute(
                    select(OzonCategoryAttribute).where(
                        and_(
                            OzonCategoryAttribute.category_id == category_id,
                            OzonCategoryAttribute.is_deprecated == False
                        )
                    )
                )
                cached_attrs = cached_result.scalars().all()
                cached_count = len(cached_attrs)

                if cached_count > 0:
                    # 检查最近 8 天内是否已同步过（基于 cached_at）
                    cache_window = datetime.now(timezone.utc) - timedelta(days=8)
                    recent_count = sum(1 for attr in cached_attrs if attr.cached_at and attr.cached_at >= cache_window)

                    if recent_count == cached_count:
                        # 所有特征都在 8 天内同步过
                        missing_ru = sum(1 for attr in cached_attrs if not attr.name_ru)
                        if missing_ru > 0:
                            # 需要补充俄文同步
                            needs_ru_sync = True
                            logger.info(
                                f"Category {category_id} has {cached_count} attrs but {missing_ru} missing name_ru, "
                                f"will sync Russian only"
                            )
                        else:
                            logger.info(f"Category {category_id} attributes cached ({cached_count}, all within 8 days), skipping")
                            return {"success": True, "cached": True, "count": cached_count}
                    else:
                        # 有过期特征，需要完整同步
                        logger.info(f"Category {category_id} has {cached_count - recent_count} expired attrs, need full sync")

            # 查询类目信息（获取parent_id作为description_category_id）
            cat_stmt = select(OzonCategory).where(OzonCategory.category_id == category_id)
            cat_result = await self.db.execute(cat_stmt)
            category = cat_result.scalar_one_or_none()

            if not category or not category.parent_id:
                error_msg = f"Category {category_id} not found or has no parent"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}

            synced_count = 0

            # 如果只需要补充俄文，跳过中文同步
            if not needs_ru_sync:
                # 第一步：同步中文属性
                logger.info(f"Step 1/2: Syncing Chinese attributes for category {category_id}...")
                zh_response = await self.client.get_category_attributes(
                    category_id=category.parent_id,  # 父类别ID
                    type_id=category_id,  # 商品类型ID（叶子节点）
                    language="ZH_HANS"
                )

                if not zh_response.get("result"):
                    error_msg = zh_response.get("error", {}).get("message", "Unknown error")

                    # 如果是 OZON 类目不存在的错误，返回更友好的提示
                    if "is not found" in error_msg or "not found" in error_msg.lower():
                        logger.warning(f"Category {category_id} not available in OZON: {error_msg}")
                        return {
                            "success": False,
                            "error": f"该类目在OZON平台不可用（可能已废弃）",
                            "ozon_error": error_msg
                        }

                    logger.error(f"Failed to fetch Chinese category attributes: {error_msg}")
                    return {"success": False, "error": error_msg}

                zh_attributes = zh_response["result"]

                for attr_data in zh_attributes:
                    await self._save_category_attribute(category_id, attr_data, language="zh")
                    synced_count += 1

                logger.info(f"Chinese attributes synced: {synced_count}")
            else:
                logger.info(f"Skipping Chinese sync (already cached), syncing Russian only...")

            # 第二步：同步俄文属性
            logger.info(f"Step 2/2: Syncing Russian attributes for category {category_id}...")
            ru_response = await self.client.get_category_attributes(
                category_id=category.parent_id,
                type_id=category_id,
                language="DEFAULT"  # OZON默认语言为俄文
            )

            if ru_response.get("result"):
                ru_attributes = ru_response["result"]
                for attr_data in ru_attributes:
                    await self._save_category_attribute(category_id, attr_data, language="ru")
                logger.info("Russian attributes synced")
            else:
                logger.warning("Failed to fetch Russian attributes, skipping Russian names")

            # 第三步：更新主显示字段
            from sqlalchemy import func
            await self.db.execute(
                update(OzonCategoryAttribute)
                .where(OzonCategoryAttribute.category_id == category_id)
                .values(
                    name=func.coalesce(OzonCategoryAttribute.name_zh, OzonCategoryAttribute.name_ru),
                    description=func.coalesce(OzonCategoryAttribute.description_zh, OzonCategoryAttribute.description_ru),
                    group_name=func.coalesce(OzonCategoryAttribute.group_name_zh, OzonCategoryAttribute.group_name_ru)
                )
            )

            # 第四步：标记废弃的特征（本次同步未更新的）
            deprecated_result = await self.db.execute(
                update(OzonCategoryAttribute)
                .where(
                    and_(
                        OzonCategoryAttribute.category_id == category_id,
                        OzonCategoryAttribute.cached_at < sync_start_time,
                        OzonCategoryAttribute.is_deprecated == False
                    )
                )
                .values(is_deprecated=True)
            )
            deprecated_count = deprecated_result.rowcount
            if deprecated_count > 0:
                logger.info(f"Marked {deprecated_count} attributes as deprecated for category {category_id}")

            # 注意：不在这里commit，由外层调用者统一commit
            # await self.db.flush()

            logger.info(f"Bilingual sync completed: {synced_count} attributes for category {category_id}")

            return {
                "success": True,
                "synced_count": synced_count,
                "deprecated_count": deprecated_count,
                "cached": False
            }

        except Exception as e:
            logger.error(f"Failed to sync category attributes: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _save_category_attribute(
        self,
        category_id: int,
        attr_data: Dict[str, Any],
        language: str = "zh"
    ):
        """保存单个类目属性（支持双语）"""
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

        name = attr_data.get("name", "")
        description = attr_data.get("description", "")
        group_name = attr_data.get("group_name")

        if existing:
            # 更新现有属性
            existing.cached_at = datetime.now(timezone.utc)  # 更新缓存时间
            existing.is_deprecated = False  # 重新激活（如果之前被标记为废弃）

            if language == "zh":
                existing.name_zh = name
                existing.description_zh = description
                existing.group_name_zh = group_name
                # 仅在中文同步时更新结构字段
                existing.attribute_type = attr_data.get("type", "string")
                existing.is_required = attr_data.get("is_required", False)
                existing.is_collection = attr_data.get("is_collection", False)
                existing.is_aspect = attr_data.get("is_aspect", False)
                existing.dictionary_id = attr_data.get("dictionary_id")
                existing.category_dependent = attr_data.get("category_dependent", False)
                existing.group_id = attr_data.get("group_id")
                existing.attribute_complex_id = attr_data.get("attribute_complex_id")
                existing.max_value_count = attr_data.get("max_value_count")
                existing.complex_is_collection = attr_data.get("complex_is_collection", False)
            elif language == "ru":
                existing.name_ru = name
                existing.description_ru = description
                existing.group_name_ru = group_name
        else:
            # 创建新属性（仅在中文同步时创建）
            if language == "zh":
                attr_info = {
                    "category_id": category_id,
                    "attribute_id": attribute_id,
                    "name": name,  # 主显示字段（临时设置为中文）
                    "name_zh": name,
                    "description": description,  # 主显示字段
                    "description_zh": description,
                    "attribute_type": attr_data.get("type", "string"),
                    "is_required": attr_data.get("is_required", False),
                    "is_collection": attr_data.get("is_collection", False),
                    "is_aspect": attr_data.get("is_aspect", False),
                    "dictionary_id": attr_data.get("dictionary_id"),
                    "category_dependent": attr_data.get("category_dependent", False),
                    "group_id": attr_data.get("group_id"),
                    "group_name": group_name,  # 主显示字段
                    "group_name_zh": group_name,
                    "attribute_complex_id": attr_data.get("attribute_complex_id"),
                    "max_value_count": attr_data.get("max_value_count"),
                    "complex_is_collection": attr_data.get("complex_is_collection", False),
                }
                attribute = OzonCategoryAttribute(**attr_info)
                self.db.add(attribute)
            else:
                # 俄文同步时属性应该已存在，记录警告
                logger.warning(f"Attribute {attribute_id} for category {category_id} not found during Russian sync")

    async def sync_attribute_values(
        self,
        attribute_id: int,
        category_id: int,
        force_refresh: bool = False,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        同步属性字典值（中文+俄文双语，支持分页）

        Args:
            attribute_id: 属性ID
            category_id: 类目ID
            force_refresh: 是否强制刷新
            language: 语言（保留参数以兼容旧代码，实际会同步双语）

        Returns:
            同步结果
        """
        try:
            # 先获取类目信息，获取父类目ID（description_category_id）
            cat_stmt = select(OzonCategory).where(OzonCategory.category_id == category_id).limit(1)
            cat_result = await self.db.execute(cat_stmt)
            category = cat_result.scalar_one_or_none()

            if not category:
                logger.warning(f"Category {category_id} not found")
                return {"success": False, "error": f"Category {category_id} not found"}

            parent_id = category.parent_id
            if not parent_id:
                logger.warning(f"Category {category_id} has no parent_id")
                return {"success": False, "error": f"Category {category_id} has no parent_id"}

            # 获取属性信息确认dictionary_id
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

            # 记录同步开始时间（用于标记废弃的字典值）
            sync_start_time = datetime.now(timezone.utc)
            synced_count = 0

            # 检查缓存：使用时间窗口策略，同一字典在 8 天内只同步一次
            # 字典值不会频繁变化，每周同步一次足够（周一 18:30 UTC）
            skip_chinese_sync = False
            if not force_refresh:
                from sqlalchemy import func as sql_func
                from datetime import timedelta

                # 检查最近 8 天内是否已同步过此字典
                cache_window = datetime.now(timezone.utc) - timedelta(days=8)
                recent_sync_count = await self.db.scalar(
                    select(sql_func.count(OzonAttributeDictionaryValue.id)).where(
                        and_(
                            OzonAttributeDictionaryValue.dictionary_id == dictionary_id,
                            OzonAttributeDictionaryValue.cached_at >= cache_window
                        )
                    )
                )

                if recent_sync_count and recent_sync_count > 0:
                    # 8天内已同步，检查是否有俄文缺失
                    missing_ru_count = await self.db.scalar(
                        select(sql_func.count(OzonAttributeDictionaryValue.id)).where(
                            and_(
                                OzonAttributeDictionaryValue.dictionary_id == dictionary_id,
                                or_(
                                    OzonAttributeDictionaryValue.value_ru.is_(None),
                                    OzonAttributeDictionaryValue.value_ru == ""
                                )
                            )
                        )
                    )
                    if missing_ru_count and missing_ru_count > 0:
                        # 有俄文缺失，只同步俄文
                        logger.info(f"Dictionary {dictionary_id} has {missing_ru_count} entries missing Russian, will sync Russian only")
                        skip_chinese_sync = True
                    else:
                        # 完全缓存，跳过
                        cached_count = await self.db.scalar(
                            select(sql_func.count(OzonAttributeDictionaryValue.id)).where(
                                OzonAttributeDictionaryValue.dictionary_id == dictionary_id
                            )
                        )
                        logger.info(f"Dictionary {dictionary_id} recently synced ({cached_count} values), skipping")
                        return {"success": True, "cached": True, "count": cached_count}
                # 如果超过8天或从未同步，继续同步（会合并新值）

            # 第一步：同步中文字典值（如果需要跳过则直接进入俄文同步）
            if not skip_chinese_sync:
                logger.info(f"Step 1/2: Syncing Chinese dictionary values for dict {dictionary_id}...")
                last_value_id = 0
                has_more = True

                while has_more:
                    response = await self.client.get_attribute_values(
                        attribute_id=attribute_id,
                        category_id=category_id,
                        parent_category_id=parent_id,
                        last_value_id=last_value_id,
                        limit=2000,
                        language="ZH_HANS"
                    )

                    if not response.get("result"):
                        break

                    values = response.get("result", [])
                    if not values:
                        break

                    for value_data in values:
                        await self._save_dictionary_value(dictionary_id, value_data, language="zh")
                        synced_count += 1
                        last_value_id = value_data.get("id", 0)

                    has_more = response.get("has_next", False)

                await self.db.flush()
                logger.info(f"Chinese dictionary values synced: {synced_count}")
            else:
                logger.info(f"Step 1/2: Skipping Chinese sync (already cached), proceeding to Russian sync...")

            # 第二步：同步俄文字典值
            logger.info(f"Step 2/2: Syncing Russian dictionary values for dict {dictionary_id}...")
            last_value_id = 0
            has_more = True

            while has_more:
                response = await self.client.get_attribute_values(
                    attribute_id=attribute_id,
                    category_id=category_id,
                    parent_category_id=parent_id,
                    last_value_id=last_value_id,
                    limit=2000,
                    language="DEFAULT"  # OZON默认语言为俄文
                )

                if not response.get("result"):
                    break

                values = response.get("result", [])
                if not values:
                    break

                for value_data in values:
                    await self._save_dictionary_value(dictionary_id, value_data, language="ru")
                    last_value_id = value_data.get("id", 0)

                has_more = response.get("has_next", False)

            await self.db.flush()
            logger.info("Russian dictionary values synced")

            # 第三步：更新主显示字段
            from sqlalchemy import func
            await self.db.execute(
                update(OzonAttributeDictionaryValue)
                .where(OzonAttributeDictionaryValue.dictionary_id == dictionary_id)
                .values(
                    value=func.coalesce(OzonAttributeDictionaryValue.value_zh, OzonAttributeDictionaryValue.value_ru),
                    info=func.coalesce(OzonAttributeDictionaryValue.info_zh, OzonAttributeDictionaryValue.info_ru)
                )
            )

            # 第四步：标记废弃的字典值（本次同步未更新的）
            deprecated_result = await self.db.execute(
                update(OzonAttributeDictionaryValue)
                .where(
                    and_(
                        OzonAttributeDictionaryValue.dictionary_id == dictionary_id,
                        OzonAttributeDictionaryValue.cached_at < sync_start_time,
                        OzonAttributeDictionaryValue.is_deprecated == False
                    )
                )
                .values(is_deprecated=True)
            )
            deprecated_count = deprecated_result.rowcount
            if deprecated_count > 0:
                logger.info(f"Marked {deprecated_count} dictionary values as deprecated for dict {dictionary_id}")

            await self.db.flush()

            logger.info(f"Bilingual sync completed: {synced_count} values for dictionary {dictionary_id}")

            return {
                "success": True,
                "synced_count": synced_count,
                "deprecated_count": deprecated_count,
                "cached": False
            }

        except Exception as e:
            logger.error(f"Failed to sync attribute values: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

    async def _save_dictionary_value(
        self,
        dictionary_id: int,
        value_data: Dict[str, Any],
        language: str = "zh"
    ):
        """保存单个字典值（支持双语）"""
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

        value_text = value_data.get("value", "")
        info_text = value_data.get("info", "")
        picture = value_data.get("picture", "")

        if existing:
            # 更新现有字典值
            existing.cached_at = datetime.now(timezone.utc)  # 更新缓存时间
            existing.is_deprecated = False  # 重新激活（如果之前被标记为废弃）

            if language == "zh":
                existing.value_zh = value_text
                existing.info_zh = info_text
                # 仅在中文同步时更新 picture
                existing.picture = picture
            elif language == "ru":
                existing.value_ru = value_text
                existing.info_ru = info_text
        else:
            # 创建新字典值（仅在中文同步时创建）
            if language == "zh":
                dict_value = OzonAttributeDictionaryValue(
                    dictionary_id=dictionary_id,
                    value_id=value_id,
                    value=value_text,  # 主显示字段（临时设置为中文）
                    value_zh=value_text,
                    info=info_text,  # 主显示字段
                    info_zh=info_text,
                    picture=picture,
                    cached_at=datetime.now(timezone.utc)
                )
                self.db.add(dict_value)
            else:
                # 俄文同步时字典值应该已存在，记录警告
                logger.warning(f"Dictionary value {value_id} for dict {dictionary_id} not found during Russian sync")

    async def batch_sync_category_attributes(
        self,
        category_ids: Optional[List[int]] = None,
        sync_all_leaf: bool = False,
        sync_dictionary_values: bool = True,
        language: str = "ZH_HANS",
        max_concurrent: int = 1,  # 已废弃，保留参数兼容性，实际始终串行执行
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        批量同步类目特征（串行执行，支持进度跟踪）

        注意：此方法强制串行执行，避免并发导致的数据库锁竞争问题。
        max_concurrent 参数已废弃，保留仅为兼容性。

        Args:
            category_ids: 类目ID列表（如果为None且sync_all_leaf=True，则同步所有叶子类目）
            sync_all_leaf: 是否同步所有叶子类目
            sync_dictionary_values: 是否同步特征值指南
            language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）
            max_concurrent: 已废弃，始终串行执行
            progress_callback: 进度回调函数

        Returns:
            同步结果
        """
        try:
            # 确定要同步的类目列表
            if sync_all_leaf and not category_ids:
                # 查询所有叶子类目（去重），按同步时间升序（最旧的或未同步的优先）
                # 注意：由于支持多对多关系，同一个 category_id 可能有多条记录，需要去重
                from sqlalchemy import func

                # 使用 group_by 去重，并获取每个 category_id 的最小同步时间
                stmt = select(
                    OzonCategory.category_id,
                    func.max(OzonCategory.name).label('name'),  # 使用 max 只是为了聚合，实际上同一个 category_id 的 name 都一样
                    func.min(OzonCategory.attributes_synced_at).label('min_synced_at')
                ).where(
                    OzonCategory.is_leaf == True
                ).group_by(
                    OzonCategory.category_id
                ).order_by(
                    func.min(OzonCategory.attributes_synced_at).asc().nullsfirst()
                )

                result = await self.db.execute(stmt)
                rows = result.all()
                category_ids = [row[0] for row in rows]
                # 同时获取类目名称映射（用于进度显示）
                category_names = {row[0]: row[1] for row in rows}
                logger.info(f"Syncing {len(category_ids)} unique leaf categories (incremental sync mode)")
            elif not category_ids:
                return {"success": False, "error": "category_ids or sync_all_leaf is required"}
            else:
                # 如果指定了类目ID列表，也需要获取名称
                stmt = select(OzonCategory).where(OzonCategory.category_id.in_(category_ids))
                result = await self.db.execute(stmt)
                categories = result.scalars().all()
                category_names = {cat.category_id: cat.name for cat in categories}

            total_categories = len(category_ids)
            synced_categories = 0
            synced_attributes = 0
            synced_values = 0
            errors = []

            # 串行同步类目（避免并发导致的锁竞争问题）
            # 原因：多个类目可能共享同一个 dictionary_id，并发更新会导致严重的锁等待（20-60秒）
            # 改为串行执行，虽然总时间更长，但避免了锁竞争导致的超长等待
            for category_id in category_ids:
                try:
                    # 1. 同步类目特征
                    attr_result = await self.sync_category_attributes(
                        category_id=category_id,
                        force_refresh=False,
                        language=language
                    )

                    if not attr_result.get("success"):
                        errors.append({
                            "category_id": category_id,
                            "step": "attributes",
                            "error": attr_result.get("error")
                        })
                        continue

                    synced_attributes += attr_result.get("synced_count", 0)

                    # 2. 如果需要，同步特征值指南（无论属性是否来自缓存）
                    if sync_dictionary_values:
                        # 获取该类目的所有属性
                        attrs = await self.get_category_attributes(category_id, required_only=False)

                        # 提前提取所有需要的属性值，避免循环中的惰性加载
                        attrs_to_sync = [
                            (attr.attribute_id, attr.dictionary_id)
                            for attr in attrs
                            if attr.dictionary_id
                        ]

                        for attribute_id, dictionary_id in attrs_to_sync:
                            value_result = await self.sync_attribute_values(
                                attribute_id=attribute_id,
                                category_id=category_id,
                                force_refresh=False,
                                language=language
                            )

                            if value_result.get("success"):
                                synced_values += value_result.get("synced_count", 0)
                            else:
                                errors.append({
                                    "category_id": category_id,
                                    "attribute_id": attribute_id,
                                    "step": "values",
                                    "error": value_result.get("error")
                                })

                    # 更新类目的特征同步时间戳
                    await self.db.execute(
                        update(OzonCategory)
                        .where(OzonCategory.category_id == category_id)
                        .values(attributes_synced_at=datetime.now(timezone.utc))
                    )

                    synced_categories += 1
                    logger.info(f"Progress: {synced_categories}/{total_categories} categories synced")

                    # 立即提交事务，确保数据实时保存到数据库
                    await self.db.commit()

                    # 调用进度回调（用于实时更新前端显示）
                    if progress_callback:
                        progress_callback(
                            current=synced_categories,
                            total=total_categories,
                            category_id=category_id,
                            category_name=category_names.get(category_id, f"类目 {category_id}"),
                            synced_attributes=synced_attributes,
                            synced_values=synced_values
                        )

                except Exception as e:
                    logger.error(f"Failed to sync category {category_id}: {e}", exc_info=True)
                    errors.append({
                        "category_id": category_id,
                        "step": "sync",
                        "error": str(e)
                    })

            # 注意：每个类目已经单独commit了，这里不需要再commit
            # await self.db.commit()

            return {
                "success": True,
                "synced_categories": synced_categories,
                "synced_attributes": synced_attributes,
                "synced_values": synced_values,
                "total_categories": total_categories,
                "errors": errors,
                "language": language
            }

        except Exception as e:
            logger.error(f"Batch sync failed: {e}", exc_info=True)
            await self.db.rollback()
            return {"success": False, "error": str(e)}

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

        result = await self.db.execute(stmt)
        return result.scalars().all()

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
            and_(
                OzonCategoryAttribute.category_id == category_id,
                OzonCategoryAttribute.is_deprecated == False  # 排除废弃的特征
            )
        )

        if required_only:
            stmt = stmt.where(OzonCategoryAttribute.is_required == True)

        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def search_dictionary_values(
        self,
        category_id: int,
        attribute_id: int,
        query: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        搜索字典值

        - 如果有搜索词：调用OZON API搜索
        - 如果没有搜索词：从本地数据库读取

        Args:
            category_id: 类目ID（叶子类目）
            attribute_id: 属性ID
            query: 搜索关键词（至少2个字符，None或空字符串表示获取所有）
            limit: 返回数量限制

        Returns:
            字典值列表（字典格式）
        """
        # 如果没有搜索词，从本地数据库读取
        if not query or len(query.strip()) < 2:
            return await self._get_dictionary_values_from_db(attribute_id, limit)

        # 有搜索词，调用OZON搜索API
        # 查询类目信息，获取父类目ID
        category = await self.db.scalar(
            select(OzonCategory).where(OzonCategory.category_id == category_id)
        )

        if not category:
            logger.warning(f"Category {category_id} not found")
            return []

        parent_id = category.parent_id

        # 调用OZON搜索API
        try:
            response = await self.client.search_attribute_values(
                attribute_id=attribute_id,
                category_id=category_id,
                parent_category_id=parent_id,
                query=query,
                limit=limit,
                language="ZH_HANS"
            )

            # 提取结果
            result = response.get("result", [])
            return result

        except Exception as e:
            logger.error(f"Failed to search attribute values: {e}", exc_info=True)
            return []

    async def _get_dictionary_values_from_db(
        self,
        attribute_id: int,
        limit: int = 500
    ) -> List[Dict[str, Any]]:
        """
        从本地数据库获取字典值（用于无搜索词的情况）

        Args:
            attribute_id: 属性ID
            limit: 返回数量限制

        Returns:
            字典值列表（字典格式）
        """
        from ..models import OzonAttributeDictionaryValue

        # 查询属性信息，获取dictionary_id
        attr = await self.db.scalar(
            select(OzonCategoryAttribute).where(
                OzonCategoryAttribute.attribute_id == attribute_id
            ).limit(1)
        )

        if not attr or not attr.dictionary_id:
            logger.warning(f"Attribute {attribute_id} not found or no dictionary_id")
            return []

        # 从本地数据库查询字典值（排除废弃的）
        stmt = select(OzonAttributeDictionaryValue).where(
            and_(
                OzonAttributeDictionaryValue.dictionary_id == attr.dictionary_id,
                OzonAttributeDictionaryValue.is_deprecated == False  # 排除废弃的字典值
            )
        ).limit(limit)

        result = await self.db.execute(stmt)
        dict_values = result.scalars().all()

        # 转换为字典格式（匹配OZON API返回格式）
        return [
            {
                "id": dv.value_id,
                "value": dv.value,
                "info": dv.info or "",
                "picture": dv.picture or ""
            }
            for dv in dict_values
        ]

    async def _generate_category_tree_js(self):
        """
        生成前端可直接使用的类目树 JS 文件

        注意：由于支持多对多关系（同一个category_id可有多个parent_id），
        在树中，每个子类目会在其每个父类目下都显示一次。

        生成文件路径: web/src/data/categoryTree.ts
        """
        try:
            # 查询所有未废弃的类目（按内部ID和层级排序）
            result = await self.db.execute(
                select(OzonCategory)
                .where(OzonCategory.is_deprecated == False)
                .order_by(OzonCategory.level, OzonCategory.id)
            )
            all_categories = list(result.scalars().all())

            if not all_categories:
                logger.warning("No categories found, skipping JS generation")
                return

            # 构建 parent_id 到 children 的映射（基于数据库记录，不是category_id）
            # 使用内部ID作为key，避免多对多关系导致的混乱
            children_map: Dict[Optional[int], List[OzonCategory]] = {}
            for cat in all_categories:
                if cat.parent_id not in children_map:
                    children_map[cat.parent_id] = []
                children_map[cat.parent_id].append(cat)

            # 递归构建树形结构（包含双语数据）
            def build_tree_node(category: OzonCategory) -> Dict[str, Any]:
                node = {
                    "value": category.category_id,  # 前端使用 category_id
                    "label": category.name,  # 主显示名称（优先中文）
                    "label_zh": category.name_zh,  # 中文名称
                    "label_ru": category.name_ru,  # 俄文名称
                    "isLeaf": category.is_leaf,
                    "disabled": category.is_disabled,
                }

                # 使用当前记录的 category_id 查找子记录（parent_id == category.category_id）
                children_cats = children_map.get(category.category_id, [])
                if children_cats:
                    node["children"] = [build_tree_node(child) for child in children_cats]

                return node

            # 找到所有根类目（parent_id为NULL）
            root_categories = children_map.get(None, [])

            # 构建树
            tree_data = [build_tree_node(root) for root in root_categories]

            # 统计唯一的 category_id 数量（用于显示）
            unique_category_ids = len(set(cat.category_id for cat in all_categories))

            # 确定文件路径（放在 public 目录，避免编译到 bundle）
            project_root = Path.cwd()
            data_dir = project_root / "web" / "public" / "data"
            data_dir.mkdir(parents=True, exist_ok=True)

            file_path = data_dir / "categoryTree.json"

            # 生成 JSON 数据（包含元信息）
            json_data = {
                "generatedAt": datetime.now(timezone.utc).isoformat() + "Z",
                "totalRecords": len(all_categories),
                "uniqueCategories": unique_category_ids,
                "data": tree_data
            }

            # 写入文件
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(json_data, f, ensure_ascii=False, indent=2)

            logger.info(f"Category tree JSON file generated: {file_path} ({len(all_categories)} records, {unique_category_ids} unique categories)")

        except Exception as e:
            logger.error(f"Failed to generate category tree JS: {e}", exc_info=True)
            # 不抛出异常，避免影响同步流程


# 导入func用于count
from sqlalchemy import func


async def match_attribute_values(
    db,
    category_id: int,
    attributes: list[dict]
) -> list[dict]:
    """
    匹配属性值到字典 value_id

    处理采集的属性数据，将文本值匹配到字典中的 value_id。
    支持多值情况（用 ", " 分隔的多个值）。

    Args:
        db: 数据库会话
        category_id: 类目ID
        attributes: 采集的属性列表，格式: [{key, name, value}, ...]

    Returns:
        匹配后的属性列表，格式: [{attribute_id, values: [{dictionary_value_id, value}]}, ...]
    """
    from ..models import OzonCategoryAttribute, OzonAttributeDictionaryValue

    if not attributes:
        return []

    matched_attributes = []

    for attr in attributes:
        attr_key = attr.get("key", "")
        attr_name = attr.get("name", "")
        attr_value = attr.get("value", "")

        if not attr_value:
            continue

        # 1. 根据 name（俄文）查找 attribute_id（排除废弃的）
        # 采集的 name 是俄文，匹配 name_ru
        attr_def = await db.scalar(
            select(OzonCategoryAttribute).where(
                and_(
                    OzonCategoryAttribute.category_id == category_id,
                    OzonCategoryAttribute.name_ru == attr_name,
                    OzonCategoryAttribute.is_deprecated == False
                )
            )
        )

        if not attr_def:
            # 尝试模糊匹配
            attr_def = await db.scalar(
                select(OzonCategoryAttribute).where(
                    and_(
                        OzonCategoryAttribute.category_id == category_id,
                        OzonCategoryAttribute.name_ru.ilike(f"%{attr_name}%"),
                        OzonCategoryAttribute.is_deprecated == False
                    )
                )
            )

        if not attr_def:
            logger.debug(f"[match_attribute_values] 未找到属性定义: name={attr_name}, key={attr_key}")
            continue

        attribute_id = attr_def.attribute_id
        dictionary_id = attr_def.dictionary_id

        # 2. 如果有字典ID，匹配字典值
        if dictionary_id:
            # 分割多值（用 ", " 分隔）
            value_texts = [v.strip() for v in attr_value.split(", ") if v.strip()]

            matched_values = []
            for value_text in value_texts:
                # 精确匹配字典值（优先匹配中文 value，其次俄文 value_ru，排除废弃的）
                dict_value = await db.scalar(
                    select(OzonAttributeDictionaryValue).where(
                        and_(
                            OzonAttributeDictionaryValue.dictionary_id == dictionary_id,
                            OzonAttributeDictionaryValue.is_deprecated == False,
                            or_(
                                OzonAttributeDictionaryValue.value == value_text,
                                OzonAttributeDictionaryValue.value_zh == value_text,
                                OzonAttributeDictionaryValue.value_ru == value_text
                            )
                        )
                    )
                )

                if dict_value:
                    matched_values.append({
                        "dictionary_value_id": dict_value.value_id,
                        "value": str(dict_value.value_id)
                    })
                    logger.debug(f"[match_attribute_values] 匹配成功: {value_text} -> {dict_value.value_id}")
                else:
                    logger.warning(f"[match_attribute_values] 未找到字典值: {value_text} (dictionary_id={dictionary_id})")

            if matched_values:
                matched_attributes.append({
                    "complex_id": 0,
                    "id": attribute_id,
                    "values": matched_values
                })
        else:
            # 3. 非字典类型，直接使用文本值
            matched_attributes.append({
                "complex_id": 0,
                "id": attribute_id,
                "values": [{"value": attr_value}]
            })

    logger.info(f"[match_attribute_values] 匹配完成: 输入 {len(attributes)} 个属性, 匹配成功 {len(matched_attributes)} 个")
    return matched_attributes
