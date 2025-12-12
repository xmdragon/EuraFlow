#!/usr/bin/env python3
"""
初始化 API 权限脚本

功能：
1. 扫描并注册所有 API 路由到 api_permissions 表
2. 为系统角色分配默认权限

使用方法：
    PYTHONPATH=. ./venv/bin/python scripts/init_permissions.py
"""

import asyncio
import logging
import sys
from pathlib import Path

# 确保可以导入项目模块
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# 默认权限配置
# 每个角色的默认权限代码列表（支持通配符）
DEFAULT_ROLE_PERMISSIONS = {
    'admin': [
        # 基础权限
        'auth.login.*',
        'auth.logout.*',
        'auth.refresh.*',
        'auth.me.*',
        'settings.*',
        # 管理权限（专注管理，不参与业务）
        'auth.users.*',
        'account-levels.*',
        'permissions.*',
        'system.*',
        'admin.credit.*',
        'sync-services.*',
        'audit.*',
    ],

    'main_account': [
        # 基础权限
        'auth.login.*',
        'auth.logout.*',
        'auth.refresh.*',
        'auth.me.*',
        'settings.*',
        # 业务权限
        'credit.*',
        'api-keys.*',
        'auth.users.*',  # 用户管理（不含级别）
        # OZON 全部业务（除 extension）
        'ozon.cancel-return.*',
        'ozon.category-commissions.*',
        'ozon.chats.*',
        'ozon.collection-records.*',
        'ozon.collection-sources.*',
        'ozon.daily-stats.*',
        'ozon.finance.*',
        'ozon.global-settings.*',
        'ozon.invoice-payments.*',
        'ozon.listings.*',
        'ozon.orders.*',
        'ozon.packing.*',
        'ozon.postings.*',
        'ozon.product-selection.*',
        'ozon.products.*',
        'ozon.reports.*',
        'ozon.scan-shipping.*',
        'ozon.session.*',
        'ozon.shop-balance.*',
        'ozon.shops.*',
        'ozon.statistics.*',
        'ozon.stock.*',
        'ozon.sync.*',
        'ozon.sync-logs.*',
        'ozon.sync-status.*',
        'ozon.test-connection.*',
        'ozon.translation.*',
        'ozon.watermark.*',
        'ozon.webhook.*',
        'ozon.xiangjifanyi.*',
        # 其他业务
        'finance.*',
        'inventory.*',
        'shipments.*',
    ],

    'sub_account': [
        # 基础权限
        'auth.login.*',
        'auth.logout.*',
        'auth.refresh.*',
        'auth.me.*',
        'settings.*',
        # 业务权限
        'credit.*',
        'api-keys.*',
        # OZON 全部业务（除 extension）- 与 manager 相同
        'ozon.cancel-return.*',
        'ozon.category-commissions.*',
        'ozon.chats.*',
        'ozon.collection-records.*',
        'ozon.collection-sources.*',
        'ozon.daily-stats.*',
        'ozon.finance.*',
        'ozon.global-settings.*',
        'ozon.invoice-payments.*',
        'ozon.listings.*',
        'ozon.orders.*',
        'ozon.packing.*',
        'ozon.postings.*',
        'ozon.product-selection.*',
        'ozon.products.*',
        'ozon.reports.*',
        'ozon.scan-shipping.*',
        'ozon.session.*',
        'ozon.shop-balance.*',
        'ozon.shops.*',
        'ozon.statistics.*',
        'ozon.stock.*',
        'ozon.sync.*',
        'ozon.sync-logs.*',
        'ozon.sync-status.*',
        'ozon.test-connection.*',
        'ozon.translation.*',
        'ozon.watermark.*',
        'ozon.webhook.*',
        'ozon.xiangjifanyi.*',
        # 其他业务
        'finance.*',
        'inventory.*',
        'shipments.*',
    ],

    'shipper': [
        # 基础权限
        'auth.login.*',
        'auth.logout.*',
        'auth.refresh.*',
        'auth.me.*',
        'settings.*',
        # 业务权限
        'credit.*',
        'ozon.scan-shipping.*',
    ],

    'extension': [
        # 仅扩展 API
        'ozon.extension.*',
    ],
}


async def scan_and_register_permissions(db):
    """扫描并注册所有 API 权限"""
    from ef_core.app import create_app
    from ef_core.services.permission_scanner import scan_and_register_permissions as do_scan

    logger.info("创建 FastAPI 应用实例...")
    app = create_app()

    logger.info("开始扫描 API 路由...")
    result = await do_scan(app, db)

    logger.info(
        f"API 权限扫描完成: 创建 {result['created']} 个, "
        f"更新 {result['updated']} 个, "
        f"跳过 {result['skipped']} 个, "
        f"共 {result['total']} 个"
    )
    return result


async def assign_role_permissions(db, role_name: str, permission_patterns: list[str]):
    """为角色分配权限"""
    from ef_core.models.permission import Role, APIPermission, RolePermission

    if not permission_patterns:
        return 0

    # 获取角色
    result = await db.execute(
        select(Role).where(Role.name == role_name)
    )
    role = result.scalar_one_or_none()

    if not role:
        logger.warning(f"未找到角色: {role_name}")
        return 0

    # 获取所有活跃权限
    result = await db.execute(
        select(APIPermission).where(APIPermission.is_active == True)
    )
    all_permissions = result.scalars().all()

    # 获取角色已有的权限
    result = await db.execute(
        select(RolePermission.permission_id).where(RolePermission.role_id == role.id)
    )
    existing_permission_ids = set(row[0] for row in result.fetchall())

    # 匹配权限
    def matches_pattern(code: str, patterns: list[str]) -> bool:
        for pattern in patterns:
            if pattern.endswith('.*'):
                prefix = pattern[:-2]
                if code.startswith(prefix + '.'):
                    return True
            elif pattern == code:
                return True
        return False

    # 分配匹配的权限
    added_count = 0
    for perm in all_permissions:
        if perm.id not in existing_permission_ids:
            if matches_pattern(perm.code, permission_patterns):
                db.add(RolePermission(
                    role_id=role.id,
                    permission_id=perm.id
                ))
                added_count += 1

    await db.commit()
    logger.info(f"为 {role_name} 角色分配了 {added_count} 个新权限")
    return added_count


async def main():
    """主函数"""
    from ef_core.database import get_db_manager

    logger.info("=" * 50)
    logger.info("开始初始化权限系统")
    logger.info("=" * 50)

    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 1. 扫描并注册 API 权限
        await scan_and_register_permissions(db)

        # 2. 为所有角色分配默认权限（包括 admin）
        for role_name, patterns in DEFAULT_ROLE_PERMISSIONS.items():
            if patterns:  # 有配置权限的角色才分配
                await assign_role_permissions(db, role_name, patterns)

    logger.info("=" * 50)
    logger.info("权限系统初始化完成!")
    logger.info("=" * 50)


if __name__ == '__main__':
    asyncio.run(main())
