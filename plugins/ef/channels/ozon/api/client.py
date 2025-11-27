"""
Ozon API 客户端
处理与 Ozon API 的所有交互

采用 Mixin 模式组织代码，各功能模块在 client_mixins/ 目录下：
- base.py: 基础配置、连接管理、核心请求方法
- products.py: 商品相关 API
- orders.py: 订单/发货相关 API
- finance.py: 财务相关 API
- chat.py: 聊天相关 API
- catalog.py: 类目/属性/商品导入相关 API
- warehouse.py: 仓库/促销/退货/Webhook相关 API
- media.py: 图片导入相关 API
"""

from .client_mixins import (
    CatalogMixin,
    ChatMixin,
    FinanceMixin,
    MediaMixin,
    OrdersMixin,
    OzonAPIClientBase,
    ProductsMixin,
    WarehouseMixin,
)


class OzonAPIClient(
    OzonAPIClientBase,
    ProductsMixin,
    OrdersMixin,
    FinanceMixin,
    ChatMixin,
    CatalogMixin,
    WarehouseMixin,
    MediaMixin,
):
    """
    Ozon API 客户端 - 完整功能

    使用方式:
        async with OzonAPIClient(client_id, api_key, shop_id) as client:
            products = await client.get_products()
            orders = await client.get_orders(date_from, date_to)

    主要功能模块:
        - 商品管理: get_products, update_prices, update_stocks 等
        - 订单管理: get_orders, get_posting_details, ship_posting 等
        - 财务管理: get_finance_transaction_list, get_finance_transaction_totals
        - 聊天管理: get_chat_list, send_chat_message 等
        - 类目管理: get_category_tree, get_category_attributes 等
        - 仓库/促销: get_warehouses, get_actions, activate_action_products 等
        - 图片管理: import_product_pictures, import_pictures_by_url 等
    """

    pass
