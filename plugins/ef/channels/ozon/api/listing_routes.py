"""
商品上架管理 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from decimal import Decimal
import logging
import asyncio

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.middleware.auth import require_role
from ..models import OzonShop
from ..api.client import OzonAPIClient
from ..services.catalog_service import CatalogService
from ..services.media_import_service import MediaImportService
from ..services.product_import_service import ProductImportService
from ..services.product_listing_service import ProductListingService

router = APIRouter(tags=["ozon-listing"])
logger = logging.getLogger(__name__)

# 类目同步全局锁，防止并发同步
_category_sync_lock = asyncio.Lock()


async def get_ozon_client(shop_id: int, db: AsyncSession) -> OzonAPIClient:
    """获取OZON API客户端"""
    shop = await db.scalar(select(OzonShop).where(OzonShop.id == shop_id))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return OzonAPIClient(client_id=shop.client_id, api_key=shop.api_key_enc)


# ============ 类目与属性查询接口 ============

@router.get("/listings/categories/stats")
async def get_category_stats(
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取类目统计信息（调试用）
    """
    try:
        from ..models.listing import OzonCategory
        from sqlalchemy import func

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
        from ..models.listing import OzonCategory

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

        # 构建category_id到对象的映射
        category_map = {cat.category_id: cat for cat in all_categories}

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
        from ..models.listing import OzonCategory

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
                from sqlalchemy import select, func
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
            from ..models.listing import OzonCategory
            from sqlalchemy import delete

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
        from ..tasks.batch_sync_task import sync_category_tree_task

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        force_refresh = request.get("force_refresh", True)

        logger.info(f"Starting async category tree sync: shop_id={shop_id}, force_refresh={force_refresh}")

        # 检查是否有正在执行的类目同步任务
        import redis
        import json
        from celery.result import AsyncResult
        from ef_core.tasks.celery_app import celery_app

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
        from ..tasks.batch_sync_task import batch_sync_category_attributes_task

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
        import redis
        import json
        from celery.result import AsyncResult
        from ef_core.tasks.celery_app import celery_app

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
        from celery.result import AsyncResult
        import redis
        import json

        task = AsyncResult(task_id)

        # 尝试从 Redis 获取进度信息
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        progress_key = f"celery-task-progress:{task_id}"
        progress_data = redis_client.get(progress_key)

        response = {
            "task_id": task_id,
            "state": task.state,
        }

        # 如果有进度数据，使用进度数据
        if progress_data:
            progress_info = json.loads(progress_data)
            response["info"] = progress_info
            response["progress"] = progress_info.get('percent', 0)

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
        from celery.result import AsyncResult
        import redis
        import json

        task = AsyncResult(task_id)

        # 尝试从 Redis 获取进度信息
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        progress_key = f"celery-task-progress:{task_id}"
        progress_data = redis_client.get(progress_key)

        response = {
            "task_id": task_id,
            "state": task.state,
        }

        # 如果有进度数据，使用进度数据
        if progress_data:
            progress_info = json.loads(progress_data)
            response["info"] = progress_info
            response["progress"] = progress_info.get('percent', 0)

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
        from ..api.client import OzonAPIClient
        from ..services.catalog_service import CatalogService
        from ..models.listing import OzonCategory
        from sqlalchemy import select, update
        from datetime import datetime, timezone

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
            from ..models.listing import OzonCategoryAttribute
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


# ============ 商品上架接口 ============

@router.post("/listings/products/import")
async def import_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    导入商品到OZON（完整上架流程）（需要操作员权限）

    支持两种模式：
    - NEW_CARD: 创建新商品卡片
    - FOLLOW_PDP: 跟随已有商品（需要条码）
    """
    try:
        shop_id = request.get("shop_id")
        offer_id = request.get("offer_id")
        mode = request.get("mode", "NEW_CARD")
        auto_advance = request.get("auto_advance", True)

        if not shop_id or not offer_id:
            raise HTTPException(status_code=400, detail="shop_id and offer_id are required")

        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.list_product(
            shop_id=shop_id,
            offer_id=offer_id,
            mode=mode,
            auto_advance=auto_advance
        )

        return result

    except Exception as e:
        logger.error(f"Product import failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/{offer_id}/status")
async def get_listing_status(
    offer_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品上架状态

    返回商品在上架流程中的当前状态和时间戳
    """
    try:
        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.get_listing_status(
            shop_id=shop_id,
            offer_id=offer_id
        )

        return result

    except Exception as e:
        logger.error(f"Get listing status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/products/{offer_id}/price")
async def update_product_price(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    更新商品价格（需要操作员权限）

    可以更新售价、原价、最低价等
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        price = request.get("price")
        old_price = request.get("old_price")
        min_price = request.get("min_price")
        currency_code = request.get("currency_code", "RUB")
        auto_action_enabled = request.get("auto_action_enabled", False)

        if price is None:
            raise HTTPException(status_code=400, detail="price is required")

        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.update_price(
            shop_id=shop_id,
            offer_id=offer_id,
            price=Decimal(str(price)),
            old_price=Decimal(str(old_price)) if old_price else None,
            min_price=Decimal(str(min_price)) if min_price else None,
            currency_code=currency_code,
            auto_action_enabled=auto_action_enabled
        )

        return result

    except Exception as e:
        logger.error(f"Update price failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/products/{offer_id}/stock")
async def update_product_stock(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    更新商品库存（需要操作员权限）

    更新指定仓库的库存数量
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        stock = request.get("stock")
        warehouse_id = request.get("warehouse_id", 1)
        product_id = request.get("product_id")

        if stock is None:
            raise HTTPException(status_code=400, detail="stock is required")

        client = await get_ozon_client(shop_id, db)
        listing_service = ProductListingService(client, db)

        result = await listing_service.update_stock(
            shop_id=shop_id,
            offer_id=offer_id,
            stock=int(stock),
            warehouse_id=warehouse_id,
            product_id=product_id
        )

        return result

    except Exception as e:
        logger.error(f"Update stock failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/products/unarchive")
async def unarchive_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    重新上架商品（从归档中还原）（需要操作员权限）

    将已下架/归档的商品重新激活
    """
    try:
        shop_id = request.get("shop_id")
        product_id = request.get("product_id")

        if not shop_id or not product_id:
            raise HTTPException(status_code=400, detail="shop_id and product_id are required")

        client = await get_ozon_client(shop_id, db)

        # 调用OZON API取消归档
        result = await client.unarchive_products([product_id])

        if result.get("result"):
            # 更新数据库中的商品状态
            from ..models.products import OzonProduct
            stmt = select(OzonProduct).where(
                OzonProduct.shop_id == shop_id,
                OzonProduct.ozon_product_id == product_id
            )
            product = await db.scalar(stmt)

            if product:
                product.ozon_archived = False
                product.status = "on_sale"  # 重新设置为在售状态
                await db.commit()

            return {
                "success": True,
                "message": "商品已重新上架"
            }
        else:
            error_msg = result.get("error", {}).get("message", "Unknown error")
            return {
                "success": False,
                "error": error_msg
            }

    except Exception as e:
        logger.error(f"Unarchive product failed: {e}", exc_info=True)
        await db.rollback()
        return {
            "success": False,
            "error": str(e)
        }


# ============ 图片导入接口 ============

@router.post("/listings/products/{offer_id}/images")
async def import_product_images(
    offer_id: str,
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    导入商品图片（需要操作员权限）

    从Cloudinary URL导入图片到OZON
    """
    try:
        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        image_urls = request.get("image_urls", [])
        validate_properties = request.get("validate_properties", False)

        if not image_urls:
            raise HTTPException(status_code=400, detail="image_urls is required")

        client = await get_ozon_client(shop_id, db)
        media_service = MediaImportService(client, db)

        result = await media_service.import_images_for_product(
            shop_id=shop_id,
            offer_id=offer_id,
            image_urls=image_urls,
            validate_properties=validate_properties
        )

        return result

    except Exception as e:
        logger.error(f"Import images failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/{offer_id}/images/status")
async def get_images_status(
    offer_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    state: Optional[str] = Query(None, description="状态过滤"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品图片导入状态
    """
    try:
        client = await get_ozon_client(shop_id, db)
        media_service = MediaImportService(client, db)

        logs = await media_service.get_import_logs(
            shop_id=shop_id,
            offer_id=offer_id,
            state=state
        )

        return {
            "success": True,
            "data": [
                {
                    "id": log.id,
                    "source_url": log.source_url,
                    "file_name": log.file_name,
                    "position": log.position,
                    "state": log.state,
                    "ozon_file_id": log.ozon_file_id,
                    "ozon_url": log.ozon_url,
                    "error_code": log.error_code,
                    "error_message": log.error_message,
                    "retry_count": log.retry_count,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                }
                for log in logs
            ],
            "total": len(logs)
        }

    except Exception as e:
        logger.error(f"Get images status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============ 导入日志查询接口 ============

@router.get("/listings/logs/products")
async def get_product_import_logs(
    shop_id: int = Query(..., description="店铺ID"),
    offer_id: Optional[str] = Query(None, description="商品Offer ID"),
    state: Optional[str] = Query(None, description="状态过滤"),
    limit: int = Query(50, le=200, description="返回数量限制"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取商品导入日志
    """
    try:
        client = await get_ozon_client(shop_id, db)
        product_service = ProductImportService(client, db)

        logs = await product_service.get_import_logs(
            shop_id=shop_id,
            offer_id=offer_id,
            state=state,
            limit=limit
        )

        return {
            "success": True,
            "data": [
                {
                    "id": log.id,
                    "offer_id": log.offer_id,
                    "import_mode": log.import_mode,
                    "state": log.state,
                    "task_id": log.task_id,
                    "ozon_product_id": log.ozon_product_id,
                    "ozon_sku": log.ozon_sku,
                    "error_code": log.error_code,
                    "error_message": log.error_message,
                    "errors": log.errors,
                    "retry_count": log.retry_count,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                    "updated_at": log.updated_at.isoformat() if log.updated_at else None
                }
                for log in logs
            ],
            "total": len(logs)
        }

    except Exception as e:
        logger.error(f"Get product import logs failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============ 新建商品接口 ============

@router.post("/listings/products/create")
async def create_product(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    上架商品到OZON（需要操作员权限）

    流程：
    1. 先调用OZON API验证并提交商品
    2. API成功后保存到数据库
    3. 返回task_id用于后续轮询状态

    这样可以立即反馈OZON API的验证错误给前端
    """
    try:
        from ..models.products import OzonProduct
        from ..services.product_import_service import ProductImportService
        from datetime import datetime

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        # 必填字段
        offer_id = request.get("offer_id")
        title = request.get("title")
        category_id = request.get("category_id")

        if not offer_id or not title:
            raise HTTPException(status_code=400, detail="offer_id and title are required")

        if not category_id:
            raise HTTPException(status_code=400, detail="category_id is required")

        # 验证 category_id 必须是大于0的整数（OZON API要求type_id > 0）
        try:
            category_id = int(category_id)
            if category_id <= 0:
                raise HTTPException(status_code=400, detail="category_id must be greater than 0")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="category_id must be a valid integer")

        # 检查offer_id是否已存在
        existing = await db.scalar(
            select(OzonProduct).where(
                OzonProduct.shop_id == shop_id,
                OzonProduct.offer_id == offer_id
            )
        )

        if existing:
            return {
                "success": False,
                "error": f"Product with offer_id '{offer_id}' already exists"
            }

        # 获取属性列表，自动添加"类型"属性（attribute_id=8229）
        attributes = request.get("attributes", [])

        # 记录收到的请求数据（调试用）
        logger.info(f"Create product request: offer_id={offer_id}, category_id={category_id}, type_id={request.get('type_id')}, has_dimensions={bool(request.get('height'))}")

        # 如果选择了类目且属性中没有"类型"（8229），自动添加
        has_type_attr = any(attr.get("id") == 8229 or attr.get("attribute_id") == 8229 for attr in attributes)
        if not has_type_attr:
            attributes.append({
                "id": 8229,
                "complex_id": 0,
                "values": [{"value": str(category_id)}]
            })

        # 构建 OZON API payload
        # description_category_id = 父类目ID（第2层）
        # type_id = 叶子类目ID（第3层）
        type_id = category_id  # 叶子类目ID

        # 优先使用前端传递的 description_category_id（避免数据库查询）
        description_category_id = request.get("description_category_id")

        if not description_category_id:
            # 如果前端未传递，则查询数据库获取（向后兼容）
            from ..models.listing import OzonCategory
            category = await db.scalar(
                select(OzonCategory).where(OzonCategory.category_id == category_id)
            )
            if not category:
                return {
                    "success": False,
                    "error": f"类目ID {category_id} 不存在，请刷新类目树后重试"
                }
            if not category.parent_id:
                return {
                    "success": False,
                    "error": f"所选类目无父类目（parent_id为空），请选择正确的叶子类目"
                }
            description_category_id = category.parent_id
            logger.info(f"从数据库查询到 description_category_id={description_category_id}")
        else:
            logger.info(f"使用前端传递的 description_category_id={description_category_id}")

        payload = {
            "offer_id": offer_id,
            "name": title,
            "price": str(request["price"]) if request.get("price") else "0",
            "vat": request.get("vat", "0"),
            "description_category_id": description_category_id,  # 父类目ID（第2层）
            "type_id": type_id,  # 叶子类目ID（第3层，必填）
            "images": request.get("images", []),
            "attributes": attributes,
        }

        # old_price 只在有值时添加
        if request.get("old_price"):
            payload["old_price"] = str(request["old_price"])

        # 可选字段
        if request.get("description"):
            payload["description"] = request.get("description")
        if request.get("barcode"):
            payload["barcode"] = request.get("barcode")

        # v3 API要求尺寸和重量（必填）
        # 验证必填字段
        missing_fields = []
        if not request.get("height"):
            missing_fields.append("高度")
        if not request.get("width"):
            missing_fields.append("宽度")
        if not request.get("depth"):
            missing_fields.append("深度")
        if not request.get("weight"):
            missing_fields.append("重量")

        if missing_fields:
            return {
                "success": False,
                "error": f"请填写必填字段: {', '.join(missing_fields)}"
            }

        # 设置尺寸和重量（前端已传递正确单位：mm 和 g）
        payload["height"] = int(float(request["height"]))
        payload["width"] = int(float(request["width"]))
        payload["depth"] = int(float(request["depth"]))
        payload["dimension_unit"] = request.get("dimension_unit", "mm")
        payload["weight"] = int(float(request["weight"]))
        payload["weight_unit"] = request.get("weight_unit", "g")

        if request.get("currency_code"):
            payload["currency_code"] = request.get("currency_code")

        # 记录发送的payload（调试用）
        logger.info(f"Sending payload to OZON API: {payload}")

        # Step 1: 先调用 OZON API 验证并提交
        client = await get_ozon_client(shop_id, db)
        try:
            response = await client.import_products(products=[payload])

            logger.info(f"OZON API response: {response}")

            if not response.get("result"):
                # OZON 400错误的响应结构：
                # {
                #   "code": 400,
                #   "message": "错误描述",
                #   "details": [{"typeUrl": "...", "value": "..."}]
                # }
                # 或者正常错误响应：
                # {
                #   "error": {"code": "...", "message": "..."}
                # }

                # 先尝试读取根级别的错误（400错误）
                if "code" in response and "message" in response:
                    error_code = response.get("code")
                    error_msg = response.get("message", "Unknown error")
                    error_details = response.get("details", [])
                else:
                    # 否则尝试从error字段读取
                    error_info = response.get("error", {})
                    error_code = error_info.get("code", "")
                    error_msg = error_info.get("message", "Unknown error")
                    error_details = error_info.get("details", [])

                logger.error(f"OZON API validation failed: code={error_code}, message={error_msg}, details={error_details}")

                return {
                    "success": False,
                    "error": f"OZON验证失败: {error_msg}",
                    "error_code": error_code,
                    "error_details": error_details
                }

            task_id = response["result"].get("task_id")
            if not task_id:
                return {
                    "success": False,
                    "error": "OZON API返回缺少task_id"
                }

            logger.info(f"OZON API success, task_id={task_id}")

        except Exception as e:
            logger.error(f"OZON API call failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"OZON API调用失败: {str(e)}"
            }

        # Step 2: API成功后才保存到数据库
        product = OzonProduct(
            shop_id=shop_id,
            offer_id=offer_id,
            title=title,
            description=request.get("description"),
            price=Decimal(str(request["price"])) if request.get("price") else None,
            old_price=Decimal(str(request["old_price"])) if request.get("old_price") else None,
            premium_price=Decimal(str(request["premium_price"])) if request.get("premium_price") else None,
            currency_code=request.get("currency_code", "RUB"),
            barcode=request.get("barcode"),
            category_id=category_id,
            type_id=type_id,  # 叶子类目ID（第3层）
            description_category_id=description_category_id,  # 父类目ID（第2层）
            images=request.get("images", []),  # JSONB field
            images360=request.get("images360"),  # 360度全景图
            color_image=request.get("color_image"),  # 颜色营销图
            videos=request.get("videos", []),  # JSONB field [{url, name, is_cover}]
            pdf_list=request.get("pdf_list"),  # PDF文档列表
            attributes=attributes,  # JSONB field（已自动添加"类型"属性）
            ozon_variants=request.get("variants"),  # OZON原始变体数据
            promotions=request.get("promotions"),  # 促销活动ID数组
            height=request.get("height"),
            width=request.get("width"),
            depth=request.get("depth"),
            dimension_unit=request.get("dimension_unit", "mm"),
            weight=request.get("weight"),
            weight_unit=request.get("weight_unit", "g"),
            vat=request.get("vat", "0"),
            listing_status="import_submitted",  # 已提交到OZON
            listing_mode="NEW_CARD",
            import_submitted_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

        db.add(product)
        await db.commit()
        await db.refresh(product)

        logger.info(f"Product created and submitted to OZON: offer_id={offer_id}, id={product.id}, task_id={task_id}")

        return {
            "success": True,
            "data": {
                "id": product.id,
                "offer_id": product.offer_id,
                "title": product.title,
                "listing_status": product.listing_status,
                "task_id": task_id  # 返回task_id供前端轮询
            },
            "message": "商品已提交到OZON，正在处理中..."
        }

    except Exception as e:
        logger.error(f"Create product failed: {e}", exc_info=True)
        await db.rollback()
        return {
            "success": False,
            "error": str(e)
        }


@router.get("/listings/products/import-status/{task_id}")
async def get_product_import_status(
    task_id: str,
    shop_id: int = Query(..., description="店铺ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    查询商品导入状态（前端轮询使用）

    Args:
        task_id: OZON导入任务ID
        shop_id: 店铺ID

    Returns:
        {
            "success": true,
            "status": "imported" | "failed" | "processing" | "pending",
            "product_id": OZON商品ID（成功时）,
            "sku": OZON SKU（成功时）,
            "errors": 错误列表（失败时）,
            "message": 状态说明
        }
    """
    try:
        from ..models.products import OzonProduct
        from datetime import datetime

        # 调用OZON API查询任务状态
        client = await get_ozon_client(shop_id, db)
        response = await client.get_import_product_info(task_id)

        # 记录OZON API返回的原始数据（调试用）
        logger.info(f"[DEBUG] OZON import status response for task_id={task_id}: {response}")

        if not response.get("result"):
            error_msg = response.get("error", {}).get("message", "Unknown error")
            logger.error(f"Failed to query import task: task_id={task_id}, error={error_msg}")
            return {
                "success": False,
                "error": f"查询导入状态失败: {error_msg}"
            }

        result = response["result"]
        items = result.get("items", [])

        if not items:
            # 任务还在队列中，尚未开始处理
            return {
                "success": True,
                "status": "pending",
                "message": "任务排队中..."
            }

        # 取第一个商品的状态（单商品导入只有一个）
        item = items[0]
        logger.info(f"[DEBUG] First item in import status: {item}")
        status = item.get("status", "").lower()
        offer_id = item.get("offer_id")

        if status == "imported":
            # 导入成功，更新数据库
            product_id = item.get("product_id")
            sku = item.get("sku")

            if offer_id:
                # 查找并更新商品记录
                product = await db.scalar(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.offer_id == offer_id
                    )
                )

                if product:
                    product.ozon_product_id = product_id
                    product.ozon_sku = sku
                    product.listing_status = "created"  # 商品已创建
                    product.ozon_created_at = datetime.utcnow()
                    product.updated_at = datetime.utcnow()
                    await db.commit()

                    logger.info(f"Product import completed: offer_id={offer_id}, product_id={product_id}, sku={sku}")

                    # 商品成功上架后，删除对应的草稿
                    try:
                        from ..services.draft_template_service import DraftTemplateService

                        # 获取最新草稿
                        draft = await DraftTemplateService.get_latest_draft(db, current_user.id)
                        if draft:
                            # 删除草稿
                            deleted = await DraftTemplateService.delete_draft(db, current_user.id, draft.id)
                            if deleted:
                                logger.info(f"Draft deleted after successful import: draft_id={draft.id}, offer_id={offer_id}")
                            else:
                                logger.warning(f"Failed to delete draft after import: draft_id={draft.id}, offer_id={offer_id}")
                    except Exception as e:
                        # 删除草稿失败不影响商品导入成功的结果
                        logger.error(f"Error deleting draft after import: {e}", exc_info=True)

            return {
                "success": True,
                "status": "imported",
                "product_id": product_id,
                "sku": sku,
                "offer_id": offer_id,
                "message": "商品导入成功！"
            }

        elif status == "failed":
            # 导入失败
            errors = item.get("errors", [])
            error_messages = [f"{e.get('code', '')}: {e.get('message', '')}" for e in errors]

            if offer_id:
                # 更新商品状态为失败
                product = await db.scalar(
                    select(OzonProduct).where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.offer_id == offer_id
                    )
                )

                if product:
                    product.listing_status = "error"
                    product.listing_error_message = "; ".join(error_messages) if error_messages else "Unknown error"
                    product.updated_at = datetime.utcnow()
                    await db.commit()

            logger.error(f"Product import failed: offer_id={offer_id}, errors={errors}")

            return {
                "success": False,
                "status": "failed",
                "errors": errors,
                "error_messages": error_messages,
                "offer_id": offer_id,
                "message": "商品导入失败: " + ("; ".join(error_messages) if error_messages else "未知错误")
            }

        elif status in ["processing", "pending"]:
            # 仍在处理中
            return {
                "success": True,
                "status": status,
                "offer_id": offer_id,
                "message": "商品正在处理中，请稍候..."
            }

        else:
            # 未知状态
            logger.warning(f"Unknown import status: {status}, item={item}")
            return {
                "success": True,
                "status": "unknown",
                "raw_status": status,
                "offer_id": offer_id,
                "message": f"未知状态: {status}"
            }

    except Exception as e:
        logger.error(f"Get product import status failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/media/upload")
async def upload_media(
    request: Dict[str, Any],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    上传图片/视频到图床（自动选择当前激活的图床，需要操作员权限）

    支持Base64和URL两种方式上传
    支持图片和视频两种媒体类型
    """
    try:
        from ..services.image_storage_factory import ImageStorageFactory
        import uuid

        shop_id = request.get("shop_id")
        if not shop_id:
            raise HTTPException(status_code=400, detail="shop_id is required")

        # 使用图片存储工厂获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            return {
                "success": False,
                "error": str(e)
            }

        # 获取上传参数
        upload_type = request.get("type", "base64")  # base64 or url
        media_type = request.get("media_type", "image")  # image or video

        # 根据媒体类型选择文件夹
        if media_type == "video":
            default_folder = getattr(service, 'product_videos_folder', 'videos')
        else:
            default_folder = service.product_images_folder or "products"

        folder = request.get("folder", default_folder)

        if upload_type == "base64":
            # Base64上传
            if media_type == "video":
                # 视频暂不支持Base64上传（文件太大）
                return {
                    "success": False,
                    "error": "视频暂不支持Base64上传，请使用URL方式或稍后支持文件上传"
                }

            base64_data = request.get("data")
            if not base64_data:
                raise HTTPException(status_code=400, detail="data is required for base64 upload")

            public_id = request.get("public_id", str(uuid.uuid4()))
            result = await service.upload_base64_image(
                base64_data=base64_data,
                public_id=public_id,
                folder=folder
            )

        elif upload_type == "url":
            # URL上传
            media_url = request.get("url")
            if not media_url:
                raise HTTPException(status_code=400, detail="url is required for url upload")

            if media_type == "video":
                # 视频URL直接返回（不上传到图床，直接使用外部链接）
                # 验证URL格式
                if not (media_url.startswith("http://") or media_url.startswith("https://")):
                    return {
                        "success": False,
                        "error": "视频URL格式不正确，必须以http://或https://开头"
                    }

                result = {
                    "success": True,
                    "url": media_url,
                    "public_id": None,
                    "source": "external_url"
                }
            else:
                # 图片上传到图床
                public_id = request.get("public_id", str(uuid.uuid4()))
                result = await service.upload_image_from_url(
                    image_url=media_url,
                    public_id=public_id,
                    folder=folder
                )

        else:
            return {
                "success": False,
                "error": f"Unsupported upload type: {upload_type}"
            }

        if result["success"]:
            logger.info(f"Image uploaded to image storage: {result['url']}")

        return result

    except Exception as e:
        logger.error(f"Upload media failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/listings/media/upload-file")
async def upload_media_file(
    file: UploadFile = File(...),
    shop_id: int = Form(...),
    media_type: str = Form("image"),
    folder: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    上传文件到图床（支持图片和视频，multipart/form-data方式）

    注意：视频上传较慢，需要经过服务器中转到图床，建议使用URL方式
    """
    try:
        from ..services.image_storage_factory import ImageStorageFactory
        import uuid

        # 验证文件类型
        if media_type == "video":
            # 视频验证
            allowed_video_types = ["video/mp4", "video/quicktime", "video/x-msvideo"]
            if file.content_type not in allowed_video_types:
                return {
                    "success": False,
                    "error": f"不支持的视频格式: {file.content_type}，仅支持 MP4, MOV"
                }

            # 文件大小限制（100MB）
            file_content = await file.read()
            file_size_mb = len(file_content) / 1024 / 1024
            if file_size_mb > 100:
                return {
                    "success": False,
                    "error": f"视频文件过大: {file_size_mb:.1f}MB，最大支持100MB"
                }
        else:
            # 图片验证
            allowed_image_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
            if file.content_type not in allowed_image_types:
                return {
                    "success": False,
                    "error": f"不支持的图片格式: {file.content_type}"
                }

            file_content = await file.read()
            file_size_mb = len(file_content) / 1024 / 1024
            if file_size_mb > 10:
                return {
                    "success": False,
                    "error": f"图片文件过大: {file_size_mb:.1f}MB，最大支持10MB"
                }

        # 获取当前激活的图床服务
        try:
            service = await ImageStorageFactory.create_from_db(db)
        except ValueError as e:
            return {
                "success": False,
                "error": str(e)
            }

        # 确定上传文件夹
        if not folder:
            if media_type == "video":
                folder = getattr(service, 'product_videos_folder', 'videos')
            else:
                folder = service.product_images_folder or "products"

        # 生成文件名
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
        public_id = f"{uuid.uuid4().hex[:12]}"

        # 上传到图床
        if media_type == "video":
            # 视频上传（暂时存储为文件）
            # TODO: 优化为流式上传，避免内存占用过大
            object_key = f"{folder}/{public_id}.{file_ext}"

            # 直接使用OSS/Cloudinary的put_object上传
            from ..services.aliyun_oss_service import AliyunOssService
            from ..services.cloudinary_service import CloudinaryService

            if isinstance(service, AliyunOssService):
                # 阿里云OSS上传视频
                import alibabacloud_oss_v2 as oss
                from io import BytesIO

                put_request = oss.PutObjectRequest(
                    bucket=service.bucket,
                    key=object_key,
                    body=BytesIO(file_content)
                )

                result = await asyncio.to_thread(
                    service.client.put_object,
                    put_request
                )

                video_url = f"https://{service.bucket}.{service.endpoint}/{object_key}"

                logger.info(f"Video uploaded to OSS: {object_key}, size: {file_size_mb:.1f}MB")

                return {
                    "success": True,
                    "url": video_url,
                    "public_id": object_key,
                    "size_mb": round(file_size_mb, 2),
                    "source": "aliyun_oss"
                }

            elif isinstance(service, CloudinaryService):
                # Cloudinary上传视频
                import cloudinary.uploader

                result = await asyncio.to_thread(
                    cloudinary.uploader.upload,
                    file_content,
                    public_id=public_id,
                    folder=folder,
                    resource_type="video",
                    chunk_size=6000000  # 6MB分块上传
                )

                logger.info(f"Video uploaded to Cloudinary: {public_id}, size: {file_size_mb:.1f}MB")

                return {
                    "success": True,
                    "url": result["secure_url"],
                    "public_id": result["public_id"],
                    "size_mb": round(file_size_mb, 2),
                    "source": "cloudinary"
                }
            else:
                return {
                    "success": False,
                    "error": "当前图床服务不支持视频上传"
                }
        else:
            # 图片上传（使用现有方法）
            result = await service.upload_image(
                image_data=file_content,
                public_id=public_id,
                folder=folder
            )

            if result.get("success"):
                result["size_mb"] = round(file_size_mb, 2)

            return result

    except Exception as e:
        logger.error(f"Upload file failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


logger.info("Listing routes initialized successfully")
