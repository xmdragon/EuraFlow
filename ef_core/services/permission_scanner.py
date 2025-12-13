"""
API 权限扫描器

自动扫描 FastAPI 应用的所有路由，生成权限配置。
"""
import re
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ef_core.models.permission import APIPermission
from ef_core.utils.logger import get_logger


logger = get_logger(__name__)


# API 前缀
API_PREFIX = "/api/ef/v1"

# 公开路由（无需权限）
PUBLIC_PATHS = {
    "/healthz",
    "/docs",
    "/redoc",
    "/openapi.json",
    f"{API_PREFIX}/auth/login",
    f"{API_PREFIX}/auth/refresh",
    f"{API_PREFIX}/auth/captcha",
    f"{API_PREFIX}/auth/captcha/verify",
    f"{API_PREFIX}/ozon/webhook",
}

# 模块中文名称（按页面/功能区域组织）
MODULE_NAMES_CN = {
    "ozon": "🛒 OZON电商",
    "auth": "🔑 用户认证",
    "system": "⚙️ 系统管理",
    "finance": "💰 财务管理",
    "orders": "📦 订单管理",
    "shipments": "🚚 发货管理",
    "inventory": "📊 库存管理",
    "listings": "📝 商品上架",
    "settings": "⚙️ 系统设置",
    "permissions": "🔐 权限管理",
    "notifications": "🔔 通知中心",
    "exchange-rates": "💱 汇率管理",
    "credit": "💳 额度管理",
    "admin": "👑 超级管理",
    "audit": "📋 审计日志",
    "api-keys": "🔑 API密钥",
    "api": "🔧 内部API",
    "account-levels": "👔 主账号级别",
    "sync-services": "🔄 同步服务",
}

# 分类中文名称（按页面组织）
CATEGORY_NAMES_CN = {
    # ========== OZON 模块 ==========
    # 订单管理页
    "orders": "📦 订单管理页",
    # 商品管理页
    "products": "🏷️ 商品管理页",
    # 店铺设置（系统配置-店铺Tab）
    "shops": "🏪 店铺设置",
    # 促销活动页
    "promotions": "🎉 促销活动页",
    # 财务管理页
    "finance": "💰 财务管理页",
    # 打包发货页
    "packing": "📤 打包发货页",
    # 面单（打包发货页-打印面单）
    "labels": "🏷️ 打包发货页-面单",
    # 聊天页
    "chats": "💬 聊天页",
    # 水印管理页
    "watermark": "🖼️ 水印管理页",
    # Webhook（系统配置）
    "webhook": "🔗 系统配置-Webhook",
    # 选品页
    "product-selection": "🔍 选品页",
    # 采集记录（选品页-采集Tab）
    "collection-records": "🔍 选品页-采集记录",
    "collection-sources": "🔍 选品页-采集地址",
    # 浏览器扩展 API（统一入口）
    "extension": "🔌 浏览器扩展",
    # 类目管理（系统配置）
    "categories": "📂 系统配置-类目",
    # 佣金（财务相关）
    "commission": "💰 财务-佣金查询",
    # 草稿模板（商品创建页）
    "draft-templates": "📝 商品创建页-草稿模板",
    # 取消退货页
    "cancel-return": "↩️ 取消退货页",
    # 库存（商品管理页-库存）
    "stock": "📊 商品管理页-库存",
    # 扫描发货页
    "scan-shipping": "📱 扫描发货页",
    # 统计（Dashboard）
    "stats": "📈 Dashboard统计",
    # 全局设置（系统配置）
    "global-settings": "⚙️ 系统配置-全局设置",

    # ========== 认证模块 ==========
    "users": "👥 用户管理页",
    "me": "👤 个人中心",
    "clone": "🔄 身份克隆",
    "logout": "🚪 登出",
    "register": "📝 注册",

    # ========== 权限模块 ==========
    "roles": "🔐 权限管理页-角色",
    "apis": "🔐 权限管理页-API权限",

    # ========== 系统模块 ==========
    "health": "🏥 系统健康检查",
    "metrics": "📊 系统指标",
    "info": "ℹ️ 系统信息",
    "handlers": "⚙️ 同步服务-处理器",
    "logs": "📋 日志管理页",
    "trigger": "▶️ 同步服务-触发",
    "reset-stats": "🔄 同步服务-重置统计",

    # ========== 财务模块 ==========
    "balance": "💳 额度管理-余额",
    "transactions": "📜 额度管理-交易记录",
    "module-configs": "⚙️ 额度管理-模块配置",
    "calculate": "🧮 额度管理-计算",
    "mute-alert": "🔕 额度管理-静音提醒",

    # ========== 汇率模块 ==========
    "config": "⚙️ 汇率设置-配置",
    "rate": "💱 汇率设置-当前汇率",
    "convert": "🔄 汇率设置-转换",
    "refresh": "🔄 汇率设置-刷新",
    "history": "📈 汇率设置-历史",
    "test-connection": "🔗 汇率设置-测试连接",

    # ========== 管理员模块 ==========
    "credit": "💳 额度充值管理",

    # ========== API密钥模块 ==========
    "regenerate": "🔑 API密钥-重新生成",

    # ========== 审计模块 ==========
    "webhooks": "🔗 审计-Webhook日志",

    # ========== 其他/默认 ==========
    "其他": "📁 其他",
    "ef": "🔧 内部API",
    "scan": "🔍 权限扫描",
    "shipping": "🚚 运费计算",
    "rates": "💱 汇率查询",

    # ========== OZON 补充 ==========
    "category-commissions": "💰 财务-类目佣金",
    "daily-stats": "📊 Dashboard-每日统计",
    "invoice-payments": "🧾 财务-发票支付",
    "listings": "📝 商品上架",
    "postings": "📤 发货单管理",
    "shop-balance": "💰 财务-店铺余额",
    "reports": "📈 报表页",

    # ========== 系统补充 ==========
    "session": "🔐 会话管理",
    "statistics": "📊 统计数据",
    "sync": "🔄 数据同步",
    "sync-logs": "📋 同步日志",
    "sync-status": "📊 同步状态",
    "pending": "⏳ 待处理",

    # ========== 翻译服务 ==========
    "translation": "🌐 翻译服务",
    "xiangjifanyi": "🌐 象寄翻译",

    # ========== 利润计算 ==========
    "profit": "💵 利润计算",
}

# 操作中文名称
ACTION_NAMES_CN = {
    "list": "查看列表",
    "detail": "查看详情",
    "create": "创建",
    "update": "更新",
    "delete": "删除",
    "export": "导出",
    "import": "导入",
    "sync": "同步",
    "scan": "扫描",
    "batch": "批量操作",
    "get": "获取",
    "put": "修改",
    "post": "提交",
}

# 特殊权限代码的中文名称（精确匹配）
PERMISSION_NAMES_CN = {
    # 认证模块
    "auth.me.list": "获取当前用户信息",
    "auth.me.update": "修改个人信息",
    "auth.logout.create": "用户登出",
    "auth.users.create": "创建用户",
    "auth.users.list": "获取用户列表",
    "auth.users.update": "修改用户",
    "auth.users.delete": "删除用户",
    "auth.register.create": "用户注册",
    "auth.clone.detail": "获取克隆状态",
    "auth.clone.create": "恢复身份",

    # API 密钥
    "api-keys.create": "创建API密钥",
    "api-keys.list": "获取API密钥列表",
    "api-keys.delete": "删除API密钥",
    "api-keys.regenerate.update": "重新生成API密钥",

    # 主账号级别
    "account-levels.list": "获取主账号级别列表",
    "account-levels.detail": "获取主账号级别详情",
    "account-levels.create": "创建主账号级别",
    "account-levels.put": "修改主账号级别",
    "account-levels.delete": "删除主账号级别",

    # 设置
    "settings.list": "获取设置",
    "settings.put": "修改设置",
    "settings.delete": "重置设置",

    # 汇率
    "exchange-rates.config.create": "保存汇率配置",
    "exchange-rates.config.list": "获取汇率配置",
    "exchange-rates.rate.list": "获取当前汇率",
    "exchange-rates.convert.create": "货币转换",
    "exchange-rates.refresh.create": "刷新汇率",
    "exchange-rates.history.list": "获取汇率历史",
    "exchange-rates.test-connection.create": "测试汇率API连接",

    # 通知
    "notifications.stats.list": "获取通知统计",

    # 审计
    "audit.webhooks.detail": "获取Webhook日志",
    "audit.logs.list": "获取审计日志",
    "audit.stats.list": "获取审计统计",

    # 额度
    "credit.balance.list": "获取额度余额",
    "credit.calculate.create": "计算消费额度",
    "credit.mute-alert.create": "静音额度提醒",
    "credit.transactions.list": "获取额度交易记录",
    "credit.module-configs.list": "获取额度模块配置",

    # 超级管理员额度管理
    "admin.credit.create": "充值额度",
    "admin.credit.detail": "获取额度账户列表",
    "admin.credit.update": "修改额度模块配置",

    # 权限管理
    "permissions.roles.list": "获取角色列表",
    "permissions.roles.create": "创建角色",
    "permissions.roles.detail": "获取角色详情",
    "permissions.roles.update": "修改角色",
    "permissions.roles.delete": "删除角色",
    "permissions.apis.list": "获取API权限列表",
    "permissions.apis.detail": "获取模块列表",
    "permissions.apis.create": "创建API权限",
    "permissions.apis.update": "修改API权限",
    "permissions.apis.delete": "删除API权限",
    "permissions.scan.create": "扫描API权限",

    # 订单/发货/库存/上架（核心接口）
    "orders.list": "获取订单列表",
    "orders.create": "创建订单",
    "shipments.create": "创建发货",
    "shipments.pending.list": "获取待发货列表",
    "inventory.create": "创建库存",
    "listings.create": "创建上架",

    # 系统
    "system.health.list": "系统健康检查",
    "system.metrics.list": "获取系统指标",
    "system.info.list": "获取系统信息",

    # 同步服务
    "sync-services.handlers.list": "获取同步处理器列表",
    "sync-services.list": "获取同步服务列表",
    "sync-services.put": "修改同步服务",
    "sync-services.trigger.create": "触发同步服务",
    "sync-services.logs.list": "获取同步日志",
    "sync-services.logs.delete": "删除同步日志",
    "sync-services.stats.list": "获取同步统计",
    "sync-services.reset-stats.create": "重置同步统计",

    # OZON 模块
    "ozon.watermark.create": "创建水印配置",
    "ozon.watermark.detail": "获取水印配置",
    "ozon.watermark.update": "修改水印配置",
    "ozon.watermark.delete": "删除水印配置",

    "ozon.product-selection.import": "导入选品",
    "ozon.product-selection.create": "预览选品",
    "ozon.product-selection.detail": "获取选品商品",
    "ozon.product-selection.batch": "删除选品批次",

    "ozon.webhook.detail": "Webhook健康检查",
    "ozon.webhook.create": "重试Webhook事件",

    "ozon.chats.detail": "获取聊天列表",
    "ozon.chats.create": "发送聊天消息",

    "ozon.orders.list": "获取OZON订单列表",
    "ozon.orders.detail": "获取OZON订单详情",
    "ozon.orders.create": "创建OZON订单",
    "ozon.orders.update": "修改OZON订单",
    "ozon.orders.sync": "同步OZON订单",
    "ozon.orders.export": "导出OZON订单",

    "ozon.products.list": "获取OZON商品列表",
    "ozon.products.detail": "获取OZON商品详情",
    "ozon.products.create": "创建OZON商品",
    "ozon.products.update": "修改OZON商品",
    "ozon.products.delete": "删除OZON商品",
    "ozon.products.sync": "同步OZON商品",

    "ozon.shops.list": "获取OZON店铺列表",
    "ozon.shops.detail": "获取OZON店铺详情",
    "ozon.shops.create": "创建OZON店铺",
    "ozon.shops.update": "修改OZON店铺",
    "ozon.shops.delete": "删除OZON店铺",

    "ozon.promotions.list": "获取促销活动列表",
    "ozon.promotions.detail": "获取促销活动详情",
    "ozon.promotions.create": "创建促销活动",
    "ozon.promotions.update": "修改促销活动",
    "ozon.promotions.sync": "同步促销活动",

    "ozon.finance.list": "获取OZON财务列表",
    "ozon.finance.detail": "获取OZON财务详情",
    "ozon.finance.sync": "同步OZON财务",
    "ozon.finance.export": "导出OZON财务",

    "ozon.packing.list": "获取打包发货列表",
    "ozon.packing.detail": "获取打包发货详情",
    "ozon.packing.create": "创建打包发货",
    "ozon.packing.update": "修改打包发货",

    "ozon.labels.list": "获取面单列表",
    "ozon.labels.detail": "获取面单详情",
    "ozon.labels.create": "生成面单",

    "ozon.categories.list": "获取OZON类目列表",
    "ozon.categories.detail": "获取OZON类目详情",
    "ozon.categories.sync": "同步OZON类目",

    "ozon.commission.list": "获取佣金列表",
    "ozon.commission.detail": "获取佣金详情",

    "ozon.draft-templates.list": "获取草稿模板列表",
    "ozon.draft-templates.create": "创建草稿模板",
    "ozon.draft-templates.detail": "获取草稿模板详情",
    "ozon.draft-templates.update": "修改草稿模板",
    "ozon.draft-templates.delete": "删除草稿模板",

    "ozon.collection-records.list": "获取采集记录列表",
    "ozon.collection-records.detail": "获取采集记录详情",
    "ozon.collection-records.create": "创建采集记录",
    "ozon.collection-records.update": "修改采集记录",
    "ozon.collection-records.delete": "删除采集记录",

    "ozon.collection-sources.list": "获取采集地址列表",
    "ozon.collection-sources.detail": "获取采集地址详情",
    "ozon.collection-sources.create": "创建采集地址",
    "ozon.collection-sources.update": "修改采集地址",
    "ozon.collection-sources.delete": "删除采集地址",

    "ozon.cancel-return.list": "获取取消退货列表",
    "ozon.cancel-return.detail": "获取取消退货详情",
    "ozon.cancel-return.create": "处理取消退货",
    "ozon.cancel-return.sync": "同步取消退货",

    "ozon.stock.list": "获取库存列表",
    "ozon.stock.detail": "获取库存详情",
    "ozon.stock.create": "创建库存",
    "ozon.stock.update": "修改库存",
    "ozon.stock.sync": "同步库存",

    "ozon.scan-shipping.detail": "扫描发货查询",
    "ozon.scan-shipping.list": "获取扫描发货列表",
    "ozon.scan-shipping.create": "扫描发货",

    "ozon.stats.list": "获取OZON统计",
    "ozon.stats.detail": "获取OZON统计详情",

    "ozon.global-settings.list": "获取全局设置",
    "ozon.global-settings.update": "修改全局设置",
}


@dataclass
class RouteInfo:
    """路由信息"""
    path: str
    method: str
    name: Optional[str]
    summary: Optional[str]
    tags: List[str]


def extract_module_from_path(path: str) -> str:
    """从路径提取模块名"""
    # 移除 API 前缀
    path = path.replace(API_PREFIX + "/", "")

    # 获取第一段
    parts = [p for p in path.split("/") if p and not p.startswith("{")]
    if parts:
        return parts[0]
    return "unknown"


def extract_category_from_path(path: str) -> Optional[str]:
    """从路径提取分类"""
    path = path.replace(API_PREFIX + "/", "")
    parts = [p for p in path.split("/") if p and not p.startswith("{")]

    if len(parts) >= 2:
        return parts[1]
    return None


def generate_permission_code(method: str, path: str) -> str:
    """生成权限代码

    规则：{module}.{category}.{action}

    示例：
    GET /api/ef/v1/ozon/orders → ozon.orders.list
    POST /api/ef/v1/ozon/orders → ozon.orders.create
    GET /api/ef/v1/ozon/orders/{id} → ozon.orders.detail
    PUT /api/ef/v1/ozon/orders/{id} → ozon.orders.update
    DELETE /api/ef/v1/ozon/orders/{id} → ozon.orders.delete
    """
    # 移除 API 前缀
    path = path.replace(API_PREFIX + "/", "")

    # 分割路径，过滤参数
    parts = [p for p in path.split("/") if p and not p.startswith("{")]

    if not parts:
        return "unknown"

    module = parts[0]

    # 确定分类和操作
    if len(parts) >= 2:
        category = parts[1]

        # 根据路径结构和方法确定操作
        has_id = "{" in path.split("/")[-1] if "/" in path else False

        if method == "GET":
            if has_id or len(parts) > 2:
                action = "detail"
            else:
                action = "list"
        elif method == "POST":
            action = "create"
        elif method in ("PUT", "PATCH"):
            action = "update"
        elif method == "DELETE":
            action = "delete"
        else:
            action = method.lower()

        # 如果有更多路径部分，可能是特定操作
        if len(parts) > 2:
            extra = parts[-1]
            if extra in ("export", "import", "sync", "scan", "batch"):
                action = extra

        return f"{module}.{category}.{action}"
    else:
        # 单级路径
        if method == "GET":
            action = "list"
        elif method == "POST":
            action = "create"
        else:
            action = method.lower()

        return f"{module}.{action}"


def generate_permission_name_cn(code: str, method: str, path: str) -> str:
    """生成权限的中文名称

    优先级：
    1. 精确匹配 PERMISSION_NAMES_CN
    2. 根据模块+分类+操作组合生成
    """
    # 1. 精确匹配
    if code in PERMISSION_NAMES_CN:
        return PERMISSION_NAMES_CN[code]

    # 2. 根据代码结构生成
    parts = code.split(".")
    if len(parts) < 2:
        return code

    module = parts[0]
    category = parts[1] if len(parts) > 1 else None
    action = parts[-1] if len(parts) > 2 else None

    # 获取模块名称
    module_name = MODULE_NAMES_CN.get(module, module.upper())

    # 获取分类名称
    category_name = ""
    if category:
        category_name = CATEGORY_NAMES_CN.get(category, category)

    # 获取操作名称
    action_name = ""
    if action:
        action_name = ACTION_NAMES_CN.get(action, action)

    # 组合名称
    if category_name and action_name:
        # 如果是 OZON 模块，简化显示
        if module == "ozon":
            return f"{action_name}{category_name}"
        return f"{module_name}-{action_name}{category_name}"
    elif category_name:
        return f"{module_name}-{category_name}"
    else:
        return f"{module_name}"


def scan_routes(app: FastAPI) -> List[RouteInfo]:
    """扫描所有 API 路由"""
    routes = []

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue

        path = route.path
        methods = route.methods or {"GET"}

        # 过滤非 API 路由
        if not path.startswith(API_PREFIX) and path not in ("/healthz",):
            continue

        # 过滤公开路由
        if path in PUBLIC_PATHS:
            continue

        for method in methods:
            if method in ("HEAD", "OPTIONS"):
                continue

            routes.append(RouteInfo(
                path=path,
                method=method,
                name=route.name,
                summary=getattr(route, "summary", None) or (
                    route.endpoint.__doc__.split("\n")[0].strip()
                    if route.endpoint.__doc__ else None
                ),
                tags=list(route.tags) if route.tags else []
            ))

    return routes


async def scan_and_register_permissions(
    app: FastAPI,
    db: AsyncSession
) -> Dict[str, Any]:
    """扫描并注册所有 API 权限

    Returns:
        {
            "created": 新创建的权限数量,
            "updated": 更新的权限数量,
            "skipped": 跳过的权限数量,
            "total": 总扫描的路由数量
        }
    """
    routes = scan_routes(app)

    created = 0
    updated = 0
    skipped = 0

    # 先收集所有权限，按 code 去重（保留第一个遇到的）
    permissions_map: Dict[str, Tuple[RouteInfo, str, str, str, Optional[str]]] = {}

    for route in routes:
        code = generate_permission_code(route.method, route.path)

        # 如果此 code 已被收集，跳过（同一个权限代码可能对应多个细分路由）
        if code in permissions_map:
            continue

        # 使用中文名称
        name = generate_permission_name_cn(code, route.method, route.path)
        module = extract_module_from_path(route.path)
        category = extract_category_from_path(route.path)

        permissions_map[code] = (route, name, module, category, code)

    # 处理去重后的权限
    for code, (route, name, module, category, _) in permissions_map.items():
        # 检查是否已存在
        stmt = select(APIPermission).where(APIPermission.code == code)
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # 更新现有记录（如果路径或名称变化）
            changed = False
            if existing.path_pattern != route.path:
                existing.path_pattern = route.path
                existing.http_method = route.method
                changed = True
            if existing.name != name:
                existing.name = name
                changed = True

            if changed:
                updated += 1
            else:
                skipped += 1
        else:
            # 创建新记录
            permission = APIPermission(
                code=code,
                name=name,
                module=module,
                category=category,
                http_method=route.method,
                path_pattern=route.path,
                is_public=False,
                is_active=True,
                sort_order=0
            )
            db.add(permission)
            created += 1

            logger.info(f"Created permission: {code} ({name}) -> {route.method} {route.path}")

    await db.flush()

    logger.info(
        f"Permission scan complete: {created} created, {updated} updated, "
        f"{skipped} skipped, {len(routes)} total routes, "
        f"{len(permissions_map)} unique permissions"
    )

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "total": len(routes)
    }
