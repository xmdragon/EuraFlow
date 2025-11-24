"""
打包发货 API路由 - 主路由文件
已按功能拆分为多个子路由模块，提高可维护性

拆分结构：
- operations_routes: 核心打包操作（备货、更新业务信息、国内单号管理、丢弃、标记打印）
- query_routes: 查询和统计（订单列表、采购价格历史、单号搜索、打包统计）
- batch_routes: 批量操作（批量备货、批量打印标签）
- sync_routes: 同步操作（同步物料成本、同步财务信息）
"""
from fastapi import APIRouter

# 导入子路由
from .packing.operations_routes import router as operations_router
from .packing.query_routes import router as query_router
from .packing.batch_routes import router as batch_router
from .packing.sync_routes import router as sync_router

# 创建主路由
router = APIRouter(tags=["ozon-packing"])

# 注册子路由
router.include_router(operations_router)
router.include_router(query_router)
router.include_router(batch_router)
router.include_router(sync_router)
