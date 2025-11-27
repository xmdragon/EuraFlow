"""
水印管理 API 路由

拆分为以下子路由模块：
- watermark/dto.py: 数据传输对象
- watermark/storage_routes.py: Cloudinary/OSS 存储配置
- watermark/config_routes.py: 水印配置 CRUD
- watermark/apply_routes.py: 水印应用（单个/批量/预览）
- watermark/task_routes.py: 任务管理
- watermark/resource_routes.py: 资源管理和上传
"""

from fastapi import APIRouter

from .watermark.apply_routes import router as apply_router
from .watermark.config_routes import router as config_router
from .watermark.resource_routes import router as resource_router
from .watermark.storage_routes import router as storage_router
from .watermark.task_routes import router as task_router

router = APIRouter(prefix="/watermark", tags=["Watermark"])

# 存储配置路由（Cloudinary/阿里云 OSS）
router.include_router(storage_router)

# 水印配置 CRUD 路由
router.include_router(config_router)

# 水印应用路由（预览/单个/批量）
router.include_router(apply_router)

# 任务管理路由
router.include_router(task_router)

# 资源管理路由（清理/列表/删除/上传）
router.include_router(resource_router)
