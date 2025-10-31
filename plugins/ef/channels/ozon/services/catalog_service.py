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
            from datetime import datetime, timezone
            logger.info(f"Starting category tree sync, root={root_category_id}, force={force_refresh}")

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

            # 标记废弃的类目（未在本次同步中更新的类目）
            from sqlalchemy import update
            result = await self.db.execute(
                update(OzonCategory)
                .where(OzonCategory.last_updated_at < sync_start_time)
                .where(OzonCategory.is_deprecated == False)
                .values(is_deprecated=True)
            )
            deprecated_count = result.rowcount

            await self.db.commit()

            if deprecated_count > 0:
                logger.info(f"Marked {deprecated_count} categories as deprecated")

            logger.info(f"Category tree sync completed: {synced_count} categories, {deprecated_count} deprecated")

            # 生成前端可用的 JS 文件
            await self._generate_category_tree_js()

            return {
                "success": True,
                "total_categories": synced_count,
                "synced_count": synced_count,
                "deprecated_count": deprecated_count,
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
        # 兼容两种字段名：
        # 1-2级使用 description_category_id 和 category_name
        # 3级（叶子）使用 type_id 和 type_name
        category_id = category_data.get("description_category_id") or category_data.get("type_id")
        if not category_id:
            return 0

        # 检查类目是否已存在
        existing = await self.db.get(OzonCategory, category_id)

        # 兼容两种字段名
        category_name = category_data.get("category_name") or category_data.get("type_name", "")
        children = category_data.get("children", [])
        is_disabled = category_data.get("disabled", False)

        # 判断是否叶子类目：初步判断，后续可能更新
        is_leaf = len(children) == 0

        if existing:
            # 更新现有类目
            existing.name = category_name
            existing.is_leaf = is_leaf
            existing.is_disabled = is_disabled
            existing.level = level
            existing.last_updated_at = datetime.utcnow()
        else:
            # 创建新类目
            category = OzonCategory(
                category_id=category_id,
                parent_id=parent_id,
                name=category_name,
                is_leaf=is_leaf,
                is_disabled=is_disabled,
                level=level
            )
            self.db.add(category)
            # 立即flush确保后续查询能找到此记录，避免重复插入
            await self.db.flush()

        count = 1

        # 递归处理子类目（OZON API已在第一次调用时返回完整树结构）
        if children:
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
        force_refresh: bool = False,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        同步类目属性

        Args:
            category_id: 类目ID
            force_refresh: 是否强制刷新
            language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）

        Returns:
            同步结果
        """
        try:
            # 检查缓存
            if not force_refresh:
                cached_result = await self.db.execute(
                    select(OzonCategoryAttribute).where(
                        OzonCategoryAttribute.category_id == category_id
                    )
                )
                cached_attrs = cached_result.scalars().all()
                cached_count = len(cached_attrs)
                if cached_count > 0:
                    logger.info(f"Category {category_id} attributes cached ({cached_count}), skipping")
                    return {"success": True, "cached": True, "count": cached_count}

            # 查询类目信息（获取parent_id作为description_category_id）
            cat_stmt = select(OzonCategory).where(OzonCategory.category_id == category_id)
            cat_result = await self.db.execute(cat_stmt)
            category = cat_result.scalar_one_or_none()

            if not category or not category.parent_id:
                error_msg = f"Category {category_id} not found or has no parent"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}

            # 调用API（parent_id作为category，category_id作为type）
            response = await self.client.get_category_attributes(
                category_id=category.parent_id,  # 父类别ID
                type_id=category_id,  # 商品类型ID（叶子节点）
                language=language
            )

            if not response.get("result"):
                error_msg = response.get("error", {}).get("message", "Unknown error")

                # 如果是 OZON 类目不存在的错误，返回更友好的提示
                if "is not found" in error_msg or "not found" in error_msg.lower():
                    logger.warning(f"Category {category_id} not available in OZON: {error_msg}")
                    return {
                        "success": False,
                        "error": f"该类目在OZON平台不可用（可能已废弃）",
                        "ozon_error": error_msg
                    }

                logger.error(f"Failed to fetch category attributes: {error_msg}")
                return {"success": False, "error": error_msg}

            attributes = response["result"]
            synced_count = 0

            for attr_data in attributes:
                await self._save_category_attribute(category_id, attr_data)
                synced_count += 1

            # 注意：不在这里commit，由外层调用者统一commit
            # await self.db.flush()

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
        force_refresh: bool = False,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        同步属性字典值（支持分页）

        Args:
            attribute_id: 属性ID
            category_id: 类目ID
            force_refresh: 是否强制刷新
            language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）

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
                    limit=5000,
                    language=language
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

            await self.db.flush()  # 使用flush代替commit，避免事务冲突

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

    async def batch_sync_category_attributes(
        self,
        category_ids: Optional[List[int]] = None,
        sync_all_leaf: bool = False,
        sync_dictionary_values: bool = True,
        language: str = "ZH_HANS",
        max_concurrent: int = 5,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        批量同步类目特征（支持进度跟踪）

        Args:
            category_ids: 类目ID列表（如果为None且sync_all_leaf=True，则同步所有叶子类目）
            sync_all_leaf: 是否同步所有叶子类目
            sync_dictionary_values: 是否同步特征值指南
            language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）
            max_concurrent: 最大并发数

        Returns:
            同步结果
        """
        try:
            # 确定要同步的类目列表
            if sync_all_leaf and not category_ids:
                # 查询所有叶子类目，按同步时间升序（最旧的或未同步的优先）
                stmt = select(OzonCategory).where(
                    OzonCategory.is_leaf == True
                ).order_by(
                    OzonCategory.attributes_synced_at.asc().nullsfirst()
                )
                result = await self.db.execute(stmt)
                categories = result.scalars().all()
                category_ids = [cat.category_id for cat in categories]
                # 同时获取类目名称映射（用于进度显示）
                category_names = {cat.category_id: cat.name for cat in categories}
                logger.info(f"Syncing {len(category_ids)} leaf categories (incremental sync mode)")
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

            # 使用锁确保串行访问数据库（避免 session 并发问题）
            # 注意：虽然限制了并发，但由于共享同一个 session，必须串行访问
            lock = asyncio.Lock()

            async def sync_one_category(category_id: int):
                nonlocal synced_categories, synced_attributes, synced_values
                async with lock:
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
                            return

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

            # 并发同步所有类目
            tasks = [sync_one_category(cat_id) for cat_id in category_ids]
            await asyncio.gather(*tasks, return_exceptions=True)

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
            OzonCategoryAttribute.category_id == category_id
        )

        if required_only:
            stmt = stmt.where(OzonCategoryAttribute.is_required == True)

        result = await self.db.execute(stmt)
        return result.scalars().all()

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

        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def _generate_category_tree_js(self):
        """
        生成前端可直接使用的类目树 JS 文件

        生成文件路径: web/src/data/categoryTree.ts
        """
        try:
            # 查询所有未废弃的类目
            result = await self.db.execute(
                select(OzonCategory)
                .where(OzonCategory.is_deprecated == False)
                .order_by(OzonCategory.level, OzonCategory.category_id)
            )
            all_categories = list(result.scalars().all())

            if not all_categories:
                logger.warning("No categories found, skipping JS generation")
                return

            # 构建 parent_id 到 children 的映射
            children_map: Dict[Optional[int], List[OzonCategory]] = {}
            for cat in all_categories:
                if cat.parent_id not in children_map:
                    children_map[cat.parent_id] = []
                children_map[cat.parent_id].append(cat)

            # 递归构建树形结构
            def build_tree_node(category: OzonCategory) -> Dict[str, Any]:
                node = {
                    "value": category.category_id,
                    "label": category.name,
                    "isLeaf": category.is_leaf,
                    "disabled": category.is_disabled,  # 使用OZON原始的禁用状态
                }

                # 使用映射查找子类目，O(1) 复杂度
                children_cats = children_map.get(category.category_id, [])
                if children_cats:
                    node["children"] = [build_tree_node(child) for child in children_cats]

                return node

            # 找到所有根类目（parent_id为NULL）
            root_categories = children_map.get(None, [])

            # 构建树
            tree_data = [build_tree_node(root) for root in root_categories]

            # 确定文件路径（项目根目录/web/src/data/categoryTree.ts）
            # 假设当前工作目录是项目根目录
            project_root = Path.cwd()
            data_dir = project_root / "web" / "src" / "data"
            data_dir.mkdir(parents=True, exist_ok=True)

            file_path = data_dir / "categoryTree.ts"

            # 生成 TypeScript 文件内容
            ts_content = f"""// Auto-generated by OZON category sync
// Generated at: {datetime.utcnow().isoformat()}Z
// Total categories: {len(all_categories)}

export interface CategoryOption {{
  value: number;
  label: string;
  isLeaf: boolean;
  disabled: boolean;
  children?: CategoryOption[];
}}

export const categoryTree: CategoryOption[] = {json.dumps(tree_data, ensure_ascii=False, indent=2)};
"""

            # 写入文件
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(ts_content)

            logger.info(f"Category tree JS file generated successfully: {file_path} ({len(all_categories)} categories)")

        except Exception as e:
            logger.error(f"Failed to generate category tree JS: {e}", exc_info=True)
            # 不抛出异常，避免影响同步流程


# 导入func用于count
from sqlalchemy import func
