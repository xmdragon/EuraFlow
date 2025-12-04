"""
类目管理 API 路由
"""

import asyncio
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

from ...api.client import OzonAPIClient
from ...models import OzonShop
from ...services.catalog_service import CatalogService

router = APIRouter(tags=["ozon-listing-category"])
logger = logging.getLogger(__name__)

# 类目同步全局锁，防止并发同步
_category_sync_lock = asyncio.Lock()


async def get_ozon_client(shop_id: int, db: AsyncSession) -> OzonAPIClient:
    """获取OZON API客户端"""
    shop = await db.scalar(select(OzonShop).where(OzonShop.id == shop_id))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc)


@router.get("/listings/categories/stats")
async def get_category_stats(
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取类目统计信息（调试用）
    """
    try:
        from ...models.listing import OzonCategory

        # 查询所有类目
        result = await db.execute(select(OzonCategory))
        all_categories = list(result.scalars().all())

        # 统计信息
        total = len(all_categories)
        root_count = len([c for c in all_categories if c.parent_id is None])
        leaf_count = len([c for c in all_categories if c.is_leaf])
        max_level = max([c.level for c in all_categories]) if all_categories else 0

        # 获取前10个根类目
        root_categories = [c for c in all_categories if c.parent_id is None][:10]
        root_list = []
        for cat in root_categories:
            # 统计子类目数量
            child_count = len([c for c in all_categories if c.parent_id == cat.category_id])
            root_list.append({
                "category_id": cat.category_id,
                "name": cat.name,
                "is_leaf": cat.is_leaf,
                "is_disabled": cat.is_disabled,
                "level": cat.level,
                "child_count": child_count
            })

        return {
            "success": True,
            "stats": {
                "total": total,
                "root_count": root_count,
                "leaf_count": leaf_count,
                "max_level": max_level
            },
            "root_categories_sample": root_list
        }

    except Exception as e:
        logger.error(f"Get category stats failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/tree")
async def get_category_tree(
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取类目树（用于Cascader三级联动组件）

    返回格式：
    [
      {
        "value": 123,
        "label": "电子产品",
        "children": [...],
        "isLeaf": false,
        "disabled": true  // 非叶子类目不可选
      }
    ]
    """
    try:
        from ...models.listing import OzonCategory

        # 查询所有类目
        result = await db.execute(
            select(OzonCategory).order_by(OzonCategory.level, OzonCategory.category_id)
        )
        all_categories = list(result.scalars().all())

        if not all_categories:
            return {
                "success": True,
                "data": [],
                "total": 0
            }

        # 递归构建树形结构
        def build_tree_node(category: OzonCategory) -> Dict[str, Any]:
            children_cats = [cat for cat in all_categories if cat.parent_id == category.category_id]

            node = {
                "value": category.category_id,
                "label": category.name,
                "isLeaf": category.is_leaf,
                "disabled": not category.is_leaf,  # 非叶子类目不可选
            }

            if children_cats:
                node["children"] = [build_tree_node(child) for child in children_cats]

            return node

        # 找到所有根类目（parent_id为NULL）
        root_categories = [cat for cat in all_categories if cat.parent_id is None]

        # 构建树
        tree_data = [build_tree_node(root) for root in root_categories]

        return {
            "success": True,
            "data": tree_data,
            "total": len(all_categories)
        }

    except Exception as e:
        logger.error(f"Get category tree failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/search")
async def search_categories(
    query: str = Query(..., description="搜索关键词"),
    only_leaf: bool = Query(True, description="仅返回叶子类目"),
    limit: int = Query(20, le=100, description="返回数量限制"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    搜索类目

    只有叶子类目才能用于创建商品
    """
    try:
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        categories = await catalog_service.search_categories(
            query=query,
            only_leaf=only_leaf,
            limit=limit
        )

        return {
            "success": True,
            "data": [
                {
                    "category_id": cat.category_id,
                    "name": cat.name,
                    "parent_id": cat.parent_id,
                    "is_leaf": cat.is_leaf,
                    "level": cat.level
                }
                for cat in categories
            ],
            "total": len(categories)
        }

    except Exception as e:
        logger.error(f"Category search failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/match-by-name")
async def match_category_by_name(
    name_ru: str = Query(..., description="俄文类目名称（从采集记录的 Тип 属性获取）"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    根据俄文名称精确匹配类目

    用于从采集记录自动匹配本地类目：
    1. 从采集记录的 product_data.attributes 中提取 attribute_id=2622298（Тип）的值
    2. 使用该值匹配 ozon_categories 表的 name_ru 字段
    3. 返回匹配的类目信息及完整路径
    """
    try:
        from ...models.listing import OzonCategory

        # 精确匹配俄文名称
        result = await db.execute(
            select(OzonCategory).where(OzonCategory.name_ru == name_ru)
        )
        category = result.scalar_one_or_none()

        if not category:
            # 尝试模糊匹配
            result = await db.execute(
                select(OzonCategory).where(OzonCategory.name_ru.ilike(f"%{name_ru}%")).limit(5)
            )
            fuzzy_matches = list(result.scalars().all())

            if fuzzy_matches:
                return {
                    "success": True,
                    "matched": False,
                    "fuzzy_matches": [
                        {
                            "category_id": cat.category_id,
                            "name_ru": cat.name_ru,
                            "name_zh": cat.name_zh,
                            "name": cat.name,
                            "is_leaf": cat.is_leaf,
                            "level": cat.level
                        }
                        for cat in fuzzy_matches
                    ],
                    "message": f"未找到精确匹配，找到 {len(fuzzy_matches)} 个相似类目"
                }
            else:
                return {
                    "success": True,
                    "matched": False,
                    "fuzzy_matches": [],
                    "message": f"未找到匹配的类目: {name_ru}"
                }

        # 获取类目路径
        category_path = []
        current = category
        while current:
            category_path.insert(0, {
                "category_id": current.category_id,
                "name": current.name,
                "name_zh": current.name_zh,
                "name_ru": current.name_ru,
                "level": current.level
            })
            if current.parent_id:
                result = await db.execute(
                    select(OzonCategory).where(OzonCategory.category_id == current.parent_id)
                )
                current = result.scalar_one_or_none()
            else:
                current = None

        return {
            "success": True,
            "matched": True,
            "category": {
                "category_id": category.category_id,
                "name": category.name,
                "name_zh": category.name_zh,
                "name_ru": category.name_ru,
                "parent_id": category.parent_id,
                "is_leaf": category.is_leaf,
                "level": category.level
            },
            "path": category_path,
            "path_ids": [p["category_id"] for p in category_path]
        }

    except Exception as e:
        logger.error(f"Match category by name failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/{category_id}/attributes")
async def get_category_attributes(
    category_id: int,
    required_only: bool = Query(False, description="仅返回必填属性"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取类目属性列表

    返回指定类目的所有属性，包括必填和选填
    """
    try:
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        attributes = await catalog_service.get_category_attributes(
            category_id=category_id,
            required_only=required_only
        )

        # 构建返回数据，包含字典值
        result_data = []
        for attr in attributes:
            attr_dict = {
                "attribute_id": attr.attribute_id,
                "category_id": attr.category_id,  # 添加 category_id
                "name": attr.name,
                "description": attr.description,
                "attribute_type": attr.attribute_type,
                "is_required": attr.is_required,
                "is_collection": attr.is_collection,
                "is_aspect": attr.is_aspect,
                "dictionary_id": attr.dictionary_id,
                "category_dependent": attr.category_dependent,
                "group_id": attr.group_id,
                "group_name": attr.group_name,
                "attribute_complex_id": attr.attribute_complex_id,
                "max_value_count": attr.max_value_count,
                "complex_is_collection": attr.complex_is_collection,
                "min_value": float(attr.min_value) if attr.min_value else None,
                "max_value": float(attr.max_value) if attr.max_value else None,
                "guide_values": None,
                "dictionary_value_count": None,
                "dictionary_values": None
            }

            # 智能字典值加载策略：
            # - ≤100 条：直接预加载所有值（占 97% 字典）
            # - >100 条：不预加载，前端使用搜索模式
            # - 例外：颜色、国家、品牌国家等常用字段，即使>100也预加载（上限2000）
            if attr.dictionary_id:
                from sqlalchemy import func

                from plugins.ef.channels.ozon.models.listing import OzonAttributeDictionaryValue

                # 查询字典值数量
                count_result = await db.scalar(
                    select(func.count()).select_from(OzonAttributeDictionaryValue)
                    .where(OzonAttributeDictionaryValue.dictionary_id == attr.dictionary_id)
                )
                dict_value_count = count_result or 0
                attr_dict["dictionary_value_count"] = dict_value_count

                # 判断是否为常用字段（例外处理：即使>100也预加载）
                is_common_field = any(keyword in attr.name for keyword in ['颜色', '国家'])

                # 决定是否预加载
                should_preload = dict_value_count <= 100 or (is_common_field and dict_value_count <= 2000)

                if should_preload:
                    # 预加载字典值（常用字段最多2000条，普通字段最多100条）
                    limit = 2000 if is_common_field else 100
                    dict_values_result = await db.execute(
                        select(OzonAttributeDictionaryValue)
                        .where(OzonAttributeDictionaryValue.dictionary_id == attr.dictionary_id)
                        .order_by(OzonAttributeDictionaryValue.value)
                        .limit(limit)
                    )
                    dict_values = dict_values_result.scalars().all()
                    attr_dict["dictionary_values"] = [
                        {
                            "value_id": v.value_id,
                            "value": v.value,
                            "info": v.info or "",
                            "picture": v.picture or ""
                        }
                        for v in dict_values
                    ]

            result_data.append(attr_dict)

        return {
            "success": True,
            "data": result_data,
            "total": len(attributes),
            "type_id": category_id  # 返回type_id（对于叶子类目，type_id = category_id）
        }

    except Exception as e:
        logger.error(f"Get category attributes failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/{category_id}/attributes/{attribute_id}/values/search")
async def search_attribute_values(
    category_id: int,
    attribute_id: int,
    query: Optional[str] = Query(None, description="搜索关键词（至少2个字符）"),
    limit: int = Query(100, le=500, description="返回数量限制"),
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    搜索属性字典值（直接调用OZON API）

    用于属性值选择，如品牌、颜色、尺码等
    """
    try:
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        values = await catalog_service.search_dictionary_values(
            category_id=category_id,
            attribute_id=attribute_id,
            query=query,
            limit=limit
        )

        # values 现在是字典列表，直接使用
        return {
            "success": True,
            "data": [
                {
                    "value_id": val.get("id"),
                    "value": val.get("value"),
                    "info": val.get("info", ""),
                    "picture": val.get("picture", "")
                }
                for val in values
            ],
            "total": len(values)
        }

    except Exception as e:
        logger.error(f"Search attribute values failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/categories/sync")
async def sync_category_tree(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    同步类目树（需要操作员权限）

    从OZON拉取类目数据到本地数据库
    """
    # 使用锁防止并发同步
    if _category_sync_lock.locked():
        return {
            "success": False,
            "error": "类目同步正在进行中，请稍后再试"
        }

    async with _category_sync_lock:
        try:
            from sqlalchemy import delete

            from ...models.listing import OzonCategory

            shop_id = request.get("shop_id")
            if not shop_id:
                raise HTTPException(status_code=400, detail="shop_id is required")

            force_refresh = request.get("force_refresh", False)
            root_category_id = request.get("root_category_id")

            # 如果 force_refresh=True，清空所有现有类目
            if force_refresh:
                logger.info("Force refresh: deleting all existing categories")
                await db.execute(delete(OzonCategory))
                await db.commit()

            client = await get_ozon_client(shop_id, db)
            catalog_service = CatalogService(client, db)

            result = await catalog_service.sync_category_tree(
                root_category_id=root_category_id,
                force_refresh=force_refresh
            )

            return result

        except Exception as e:
            logger.error(f"Sync category tree failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }


@router.post("/listings/categories/sync-async")
async def sync_category_tree_async(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    异步同步类目树（异步后台任务，需要操作员权限）

    从OZON拉取类目数据到本地数据库，使用后台任务执行

    返回：
    - task_id: 任务ID（用于查询任务状态）
    """
    try:
        import json

        import redis
        from celery.result import AsyncResult

        from ef_core.tasks.celery_app import celery_app

        from ...tasks.batch_sync_task import sync_category_tree_task

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        force_refresh = request.get("force_refresh", True)

        logger.info(f"Starting async category tree sync: shop_id={shop_id}, force_refresh={force_refresh}")

        # 检查是否有正在执行的类目同步任务
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

        # 查找所有正在执行的任务
        for key in redis_client.keys("celery-task-progress:*"):
            task_data = redis_client.get(key)
            if task_data:
                progress = json.loads(task_data)
                # 检查是否是类目同步任务（通过字段判断）
                if progress.get('status') in ['starting', 'syncing'] and 'processed_categories' in progress:
                    existing_task_id = key.replace("celery-task-progress:", "")

                    # 检查 Celery 中任务是否真的在运行
                    result = AsyncResult(existing_task_id, app=celery_app)

                    # 如果任务状态是僵尸状态，清理掉
                    if result.state in ['PENDING', 'FAILURE', 'SUCCESS', 'REVOKED']:
                        redis_client.delete(key)
                        logger.warning(
                            f"Cleaned zombie category sync task {existing_task_id} with Celery state {result.state}"
                        )
                        continue

                    # 任务确实在运行，返回已存在的任务
                    logger.info(f"Found existing running category sync task: {existing_task_id}")
                    return {
                        "success": True,
                        "task_id": existing_task_id,
                        "message": "检测到正在执行的类目同步任务，将继续监控该任务"
                    }

        # 启动后台异步任务
        task = sync_category_tree_task.delay(
            shop_id=shop_id,
            force_refresh=force_refresh
        )

        logger.info(f"Category tree sync task started: task_id={task.id}")

        return {
            "success": True,
            "task_id": task.id,
            "message": "类目同步任务已启动，请稍后查询任务状态"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start category sync task: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/categories/batch-sync-attributes")
async def batch_sync_category_attributes(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    批量同步类目特征（异步后台任务，需要操作员权限）

    支持以下模式：
    1. 指定类目列表：category_ids: [123, 456, 789]
    2. 同步所有叶子类目：sync_all_leaf: true

    返回：
    - task_id: 任务ID（用于查询任务状态）
    """
    try:
        import json

        import redis
        from celery.result import AsyncResult

        from ef_core.tasks.celery_app import celery_app

        from ...tasks.batch_sync_task import batch_sync_category_attributes_task

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        category_ids = request.get("category_ids")
        sync_all_leaf = request.get("sync_all_leaf", False)
        sync_dictionary_values = request.get("sync_dictionary_values", True)
        language = request.get("language", "ZH_HANS")
        max_concurrent = request.get("max_concurrent", 5)

        if not category_ids and not sync_all_leaf:
            raise HTTPException(
                status_code=400,
                detail="Either category_ids or sync_all_leaf must be provided"
            )

        logger.info(
            f"Starting batch sync task: shop_id={shop_id}, "
            f"category_ids={category_ids}, sync_all_leaf={sync_all_leaf}, language={language}"
        )

        # 检查是否有正在执行的任务（加强版：同时检查 Celery 任务状态）
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

        # 查找所有正在执行的任务
        for key in redis_client.keys("celery-task-progress:*"):
            task_data = redis_client.get(key)
            if task_data:
                progress = json.loads(task_data)
                if progress.get('status') in ['starting', 'syncing']:
                    existing_task_id = key.replace("celery-task-progress:", "")

                    # 检查 Celery 中任务是否真的在运行
                    result = AsyncResult(existing_task_id, app=celery_app)

                    # 如果任务状态是 PENDING/FAILURE/SUCCESS/REVOKED，说明是僵尸状态，清理掉
                    if result.state in ['PENDING', 'FAILURE', 'SUCCESS', 'REVOKED']:
                        redis_client.delete(key)
                        logger.warning(
                            f"Cleaned zombie task {existing_task_id} with Celery state {result.state}"
                        )
                        continue

                    # 任务确实在运行，返回已存在的任务
                    logger.info(f"Found existing running task: {existing_task_id} (Celery state: {result.state})")
                    return {
                        "success": True,
                        "task_id": existing_task_id,
                        "message": "检测到正在执行的同步任务，将继续监控该任务"
                    }

        # 启动后台异步任务
        task = batch_sync_category_attributes_task.delay(
            shop_id=shop_id,
            category_ids=category_ids,
            sync_all_leaf=sync_all_leaf,
            sync_dictionary_values=sync_dictionary_values,
            language=language,
            max_concurrent=max_concurrent
        )

        logger.info(f"Batch sync task started: task_id={task.id}")

        return {
            "success": True,
            "task_id": task.id,
            "message": "批量同步任务已启动，请稍后查询任务状态"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start batch sync task: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/sync-async/status/{task_id}")
async def get_category_sync_task_status(
    task_id: str,
    current_user: User = Depends(require_role("operator"))
):
    """
    查询类目同步任务状态

    Args:
        task_id: 任务ID

    Returns:
        任务状态信息
    """
    try:
        import json

        import redis
        from celery.result import AsyncResult

        task = AsyncResult(task_id)

        # 尝试从 Redis 获取进度信息
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        progress_key = f"celery-task-progress:{task_id}"
        progress_data = redis_client.get(progress_key)

        response = {
            "task_id": task_id,
            "state": task.state,
        }

        # 如果有进度数据，优先使用 Redis 进度状态（比 Celery 状态更准确）
        if progress_data:
            progress_info = json.loads(progress_data)
            response["info"] = progress_info
            response["progress"] = progress_info.get('percent', 0)

            # 根据 Redis 进度状态覆盖 Celery 状态
            # 因为 Celery 使用 acks_late，任务运行时状态可能仍是 PENDING
            redis_status = progress_info.get('status', '')
            if redis_status == 'syncing':
                response["state"] = "PROGRESS"
                response["status"] = "执行中"
                return response
            elif redis_status == 'completed':
                response["state"] = "SUCCESS"
                response["status"] = "已完成"
                return response
            elif redis_status == 'failed':
                response["state"] = "FAILURE"
                response["status"] = "失败"
                response["error"] = progress_info.get('error', '未知错误')
                return response

        # 如果没有 Redis 进度数据，使用 Celery 状态
        if task.state == 'PENDING':
            response["status"] = "等待执行"
            if "progress" not in response:
                response["progress"] = 0
        elif task.state == 'PROGRESS':
            response["status"] = "执行中"
            if "progress" not in response:
                response["progress"] = 50
        elif task.state == 'SUCCESS':
            response["status"] = "已完成"
            response["result"] = task.result
            if "progress" not in response:
                response["progress"] = 100
        elif task.state == 'FAILURE':
            response["status"] = "失败"
            response["error"] = str(task.info)
            if "progress" not in response:
                response["progress"] = 0
        else:
            response["status"] = task.state
            response["info"] = str(task.info) if task.info else None
            response["progress"] = 0

        return response

    except Exception as e:
        logger.error(f"Get category sync task status failed: {e}", exc_info=True)
        return {
            "task_id": task_id,
            "state": "UNKNOWN",
            "status": "未知",
            "error": str(e),
            "progress": 0
        }


@router.get("/listings/categories/batch-sync-attributes/status/{task_id}")
async def get_batch_sync_task_status(
    task_id: str,
    current_user: User = Depends(require_role("operator"))
):
    """
    查询批量同步特征任务状态

    Args:
        task_id: 任务ID

    Returns:
        任务状态信息
    """
    try:
        import json

        import redis
        from celery.result import AsyncResult

        task = AsyncResult(task_id)

        # 尝试从 Redis 获取进度信息
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        progress_key = f"celery-task-progress:{task_id}"
        progress_data = redis_client.get(progress_key)

        response = {
            "task_id": task_id,
            "state": task.state,
        }

        # 如果有进度数据，优先使用 Redis 进度状态（比 Celery 状态更准确）
        if progress_data:
            progress_info = json.loads(progress_data)
            response["info"] = progress_info
            response["progress"] = progress_info.get('percent', 0)

            # 根据 Redis 进度状态覆盖 Celery 状态
            # 因为 Celery 使用 acks_late，任务运行时状态可能仍是 PENDING
            redis_status = progress_info.get('status', '')
            if redis_status == 'syncing':
                response["state"] = "PROGRESS"
                response["status"] = "执行中"
                return response
            elif redis_status == 'completed':
                response["state"] = "SUCCESS"
                response["status"] = "已完成"
                return response
            elif redis_status == 'failed':
                response["state"] = "FAILURE"
                response["status"] = "失败"
                response["error"] = progress_info.get('error', '未知错误')
                return response

        # 如果没有 Redis 进度数据，使用 Celery 状态
        if task.state == 'PENDING':
            response["status"] = "等待执行"
            if "progress" not in response:
                response["progress"] = 0
        elif task.state == 'PROGRESS':
            response["status"] = "执行中"
            if "progress" not in response:
                response["progress"] = 50
        elif task.state == 'SUCCESS':
            response["status"] = "已完成"
            response["result"] = task.result
            if "progress" not in response:
                response["progress"] = 100
        elif task.state == 'FAILURE':
            response["status"] = "失败"
            response["error"] = str(task.info)
            if "progress" not in response:
                response["progress"] = 0
        else:
            response["status"] = task.state
            response["info"] = str(task.info) if task.info else None
            response["progress"] = 0

        return response

    except Exception as e:
        logger.error(f"Failed to get task status: {e}", exc_info=True)
        return {
            "task_id": task_id,
            "state": "UNKNOWN",
            "status": "查询失败",
            "error": str(e)
        }


@router.post("/listings/categories/{category_id}/sync-attributes")
async def sync_single_category_attributes(
    category_id: int,
    shop_id: int = Query(..., description="店铺ID"),
    language: str = Query("ZH_HANS", description="语言（ZH_HANS/DEFAULT/RU/EN/TR）"),
    force_refresh: bool = Query(False, description="是否强制刷新"),
    sync_dictionary_values: bool = Query(True, description="是否同步特征值指南"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    同步单个类目的特征

    Args:
        category_id: 类目ID
        shop_id: 店铺ID
        language: 语言
        force_refresh: 是否强制刷新
        sync_dictionary_values: 是否同步特征值指南

    Returns:
        同步结果
    """
    try:
        from datetime import timezone

        from sqlalchemy import update

        from ...models.listing import OzonCategory
        from ...services.catalog_service import CatalogService
        from datetime import datetime

        # 检查类目是否存在
        cat_result = await db.execute(
            select(OzonCategory).where(OzonCategory.category_id == category_id)
        )
        category = cat_result.scalar_one_or_none()

        if not category:
            raise HTTPException(
                status_code=404,
                detail={
                    "type": "about:blank",
                    "title": "Not Found",
                    "status": 404,
                    "detail": f"类目 {category_id} 不存在",
                    "code": "CATEGORY_NOT_FOUND"
                }
            )

        if not category.is_leaf:
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "Bad Request",
                    "status": 400,
                    "detail": "只能同步叶子类目的特征",
                    "code": "NOT_LEAF_CATEGORY"
                }
            )

        # 提前保存类目名称，避免后续 ORM 对象过期导致懒加载错误
        category_name = category.name

        # 创建 API 客户端
        client = await get_ozon_client(shop_id, db)
        catalog_service = CatalogService(client, db)

        logger.info(
            f"Starting single category attributes sync: category_id={category_id}, "
            f"shop_id={shop_id}, force_refresh={force_refresh}"
        )

        # 1. 同步类目特征
        attr_result = await catalog_service.sync_category_attributes(
            category_id=category_id,
            force_refresh=force_refresh,
            language=language
        )

        if not attr_result.get("success"):
            return {
                "success": False,
                "error": attr_result.get("error")
            }

        synced_attributes = attr_result.get("synced_count", 0) if not attr_result.get("cached") else 0
        cached_attributes = attr_result.get("count", 0) if attr_result.get("cached") else 0

        # 2. 如果需要，同步特征值指南
        synced_values = 0
        if sync_dictionary_values:
            # 直接查询 attribute_id 和 dictionary_id，避免 ORM 对象懒加载问题
            from ...models.listing import OzonCategoryAttribute
            attrs_result = await db.execute(
                select(OzonCategoryAttribute.attribute_id, OzonCategoryAttribute.dictionary_id)
                .where(
                    OzonCategoryAttribute.category_id == category_id,
                    OzonCategoryAttribute.dictionary_id.isnot(None)
                )
            )
            attrs_to_sync = list(attrs_result.all())

            for attribute_id, dictionary_id in attrs_to_sync:
                value_result = await catalog_service.sync_attribute_values(
                    attribute_id=attribute_id,
                    category_id=category_id,
                    force_refresh=False,
                    language=language
                )

                if value_result.get("success"):
                    synced_values += value_result.get("synced_count", 0)

        # 3. 更新类目的特征同步时间戳
        await db.execute(
            update(OzonCategory)
            .where(OzonCategory.category_id == category_id)
            .values(attributes_synced_at=datetime.now(timezone.utc))
        )
        await db.commit()

        logger.info(
            f"Single category sync completed: category_id={category_id}, "
            f"synced_attributes={synced_attributes}, cached_attributes={cached_attributes}, "
            f"synced_values={synced_values}"
        )

        return {
            "success": True,
            "category_id": category_id,
            "category_name": category_name,
            "synced_attributes": synced_attributes,
            "cached_attributes": cached_attributes,
            "synced_values": synced_values,
            "message": f"类目 '{category_name}' 特征同步完成"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to sync single category attributes: {e}", exc_info=True)
        await db.rollback()
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/categories/names")
async def get_category_names_by_russian(
    name_ru: str = Query(..., description="俄文类目名称，如：Полка"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    根据俄文类目名称查询完整三级类目中文名称（供浏览器扩展使用）

    Args:
        name_ru: 俄文类目名称（商品属性 Тип 的值）

    Returns:
        { "success": true, "data": { "category1": "家具", "category2": "架子和货架", "category3": "置物架", "fullPath": "家具 > 架子和货架 > 置物架" } }
    """
    try:
        from ...models.listing import OzonCategory

        # 查找匹配的类目
        result = await db.execute(
            select(OzonCategory).where(OzonCategory.name_ru == name_ru)
        )
        category = result.scalar_one_or_none()

        if not category:
            return {"success": True, "data": None}

        # 构建三级类目路径
        path = []
        current = category
        while current:
            path.insert(0, {
                "id": current.category_id,
                "name": current.name_zh or current.name,
                "level": current.level
            })
            if current.parent_id:
                parent_result = await db.execute(
                    select(OzonCategory).where(OzonCategory.category_id == current.parent_id)
                )
                current = parent_result.scalar_one_or_none()
            else:
                current = None

        # 提取一二三级类目
        data = {
            "category1": path[0]["name"] if len(path) > 0 else None,
            "category1Id": path[0]["id"] if len(path) > 0 else None,
            "category2": path[1]["name"] if len(path) > 1 else None,
            "category2Id": path[1]["id"] if len(path) > 1 else None,
            "category3": path[2]["name"] if len(path) > 2 else None,
            "category3Id": path[2]["id"] if len(path) > 2 else None,
            "fullPath": " > ".join([p["name"] for p in path])
        }

        logger.info(f"Category by Russian name: {name_ru} -> {data['fullPath']}")
        return {"success": True, "data": data}

    except Exception as e:
        logger.error(f"Get category names failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }
