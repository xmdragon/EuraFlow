"""
Ozon同步服务 - 兼容层/Facade

保持向后兼容，将调用委托给具体的服务类。

重构说明：
- 原始文件（1981行）已拆分为 sync/ 子模块
- 此文件现在作为 Facade，委托所有调用到具体服务
- 所有现有导入语句继续工作
"""

from typing import Dict, Any, Optional

# 向后兼容：重新导出工具函数
from .sync.utils import safe_int_conversion, safe_decimal_conversion  # noqa: F401

# 向后兼容：重新导出任务状态管理器
from .sync.task_state_manager import (
    TaskStateManager,  # noqa: F401
    SyncTaskState,  # noqa: F401
    get_task_state_manager,
)

# 导入具体实现
from .sync.product_sync import ProductSyncService
from .sync.order_sync import OrderSyncService
from .sync.order_sync.sales_updater import SalesUpdater


# ============ 向后兼容：SYNC_TASKS 全局变量 ============
# 警告：新代码应使用 get_task_state_manager() 而不是直接访问 SYNC_TASKS
# 这个变量仅为了保持现有代码的兼容性

SYNC_TASKS = get_task_state_manager()._tasks_compat


# ============ 向后兼容：模块级函数 ============

async def update_product_sales(db, shop_id: int, products_data: list, delta: int, order_time=None):
    """
    更新商品销量统计

    向后兼容的包装函数，委托给 SalesUpdater。

    Args:
        db: 数据库会话
        shop_id: 店铺ID
        products_data: 订单商品列表
        delta: 销量变化量（+1 新订单, -1 取消订单）
        order_time: 订单时间
    """
    updater = SalesUpdater()
    await updater.update_product_sales(db, shop_id, products_data, delta, order_time)


# ============ OzonSyncService Facade ============

class OzonSyncService:
    """
    Ozon同步服务 - Facade类

    此类委托所有调用到具体的服务类，保持向后兼容。
    所有方法都是静态方法，与原始实现保持一致。
    """

    # 服务实例（延迟初始化）
    _product_service: Optional[ProductSyncService] = None
    _order_service: Optional[OrderSyncService] = None

    @classmethod
    def _get_product_service(cls) -> ProductSyncService:
        if cls._product_service is None:
            cls._product_service = ProductSyncService()
        return cls._product_service

    @classmethod
    def _get_order_service(cls) -> OrderSyncService:
        if cls._order_service is None:
            cls._order_service = OrderSyncService()
        return cls._order_service

    # ============ 商品同步方法 ============

    @staticmethod
    async def sync_products(shop_id: int, db, task_id: str, mode: str = "incremental") -> Dict[str, Any]:
        """
        同步商品

        Args:
            shop_id: 店铺ID
            db: 数据库会话
            task_id: 任务ID
            mode: 同步模式 - 'full' 全量同步, 'incremental' 增量同步

        Returns:
            任务状态字典
        """
        service = OzonSyncService._get_product_service()
        return await service.sync_products(shop_id, db, task_id, mode)

    @staticmethod
    async def _save_product_sync_error(db, shop_id: int, product_id, offer_id: str,
                                       task_id, status, errors: list) -> None:
        """保存商品错误信息（委托给 ProductErrorHandler）"""
        from .sync.product_sync.product_error_handler import ProductErrorHandler
        handler = ProductErrorHandler()
        await handler.save_error(db, shop_id, product_id, offer_id, task_id, status, errors)

    @staticmethod
    async def _clear_product_sync_error(db, shop_id: int, offer_id: str) -> None:
        """清除商品错误信息（委托给 ProductErrorHandler）"""
        from .sync.product_sync.product_error_handler import ProductErrorHandler
        handler = ProductErrorHandler()
        await handler.clear_error(db, shop_id, offer_id)

    # ============ 订单同步方法 ============

    @staticmethod
    async def sync_orders(shop_id: int, db, task_id: str, mode: str = "incremental") -> Dict[str, Any]:
        """
        统一的订单同步入口

        Args:
            shop_id: 店铺ID
            db: 数据库会话
            task_id: 任务ID
            mode: 同步模式 'full' - 全量同步, 'incremental' - 增量同步

        Returns:
            任务状态字典
        """
        service = OzonSyncService._get_order_service()
        return await service.sync_orders(shop_id, db, task_id, mode)

    @staticmethod
    async def _sync_orders_incremental(shop_id: int, db, task_id: str) -> Dict[str, Any]:
        """增量同步订单（委托）"""
        service = OzonSyncService._get_order_service()
        return await service._sync_orders_incremental(shop_id, db, task_id)

    @staticmethod
    async def _sync_orders_full(shop_id: int, db, task_id: str) -> Dict[str, Any]:
        """全量同步订单（委托）"""
        service = OzonSyncService._get_order_service()
        return await service._sync_orders_full(shop_id, db, task_id)

    @staticmethod
    def _calculate_order_amounts(item: Dict[str, Any]) -> tuple:
        """计算订单金额信息（委托给 OrderMapper）"""
        from .sync.order_sync.order_mapper import OrderMapper
        mapper = OrderMapper()
        return mapper.calculate_amounts(item)

    @staticmethod
    def _map_order_fields(item: Dict[str, Any], total_price, products_price,
                          delivery_price, commission_amount, delivery_address,
                          sync_mode: str) -> Dict[str, Any]:
        """映射订单字段（委托给 OrderMapper）"""
        from .sync.order_sync.order_mapper import OrderMapper
        mapper = OrderMapper()
        return mapper.map_to_order(
            item, total_price, products_price,
            delivery_price, commission_amount,
            delivery_address, sync_mode
        )

    @staticmethod
    async def _sync_posting(db, order, posting_data: Dict[str, Any], shop_id: int) -> None:
        """同步posting信息（委托给 PostingProcessor）"""
        from .sync.order_sync.posting_processor import PostingProcessor
        processor = PostingProcessor()
        await processor.sync_posting(db, order, posting_data, shop_id)

    @staticmethod
    async def _sync_order_items(db, order, products_data: list) -> None:
        """同步订单商品明细（委托给 OrderItemsProcessor）"""
        from .sync.order_sync.order_items_processor import OrderItemsProcessor
        processor = OrderItemsProcessor()
        await processor.sync_order_items(db, order, products_data)

    @staticmethod
    async def _sync_packages(db, posting, posting_data: Dict[str, Any], shop) -> None:
        """同步包裹信息（委托给 PostingProcessor）"""
        from .sync.order_sync.posting_processor import PostingProcessor
        processor = PostingProcessor()
        await processor.sync_packages(db, posting, posting_data, shop)

    # ============ 任务管理方法 ============

    @staticmethod
    def get_task_status(task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        return get_task_state_manager().get_task_dict(task_id)

    @staticmethod
    def clear_old_tasks():
        """清理旧任务（超过1小时的）"""
        return get_task_state_manager().clear_expired_tasks()
