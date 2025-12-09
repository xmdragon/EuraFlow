#!/usr/bin/env python3
"""
生成统一初始化迁移脚本

从当前数据库 schema 生成一个干净的初始化迁移，用于新部署。
"""

import os
import sys
import subprocess
from datetime import datetime, timezone

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()


def get_db_url():
    """获取数据库连接 URL"""
    host = os.getenv('EF__DB_HOST', 'localhost')
    port = os.getenv('EF__DB_PORT', '5432')
    user = os.getenv('EF__DB_USER', 'euraflow')
    password = os.getenv('EF__DB_PASSWORD', '')
    database = os.getenv('EF__DB_NAME', 'euraflow')
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def get_table_order():
    """
    返回表的创建顺序（考虑外键依赖）
    """
    # 基础表（无外键依赖）
    base_tables = [
        'users',
        'ozon_shops',
        'ozon_categories',
        'ozon_warehouses',
        'exchange_rate_config',
        'exchange_rates',
        'ozon_global_settings',
        'sync_services',
    ]

    # 依赖 users 的表
    user_dependent = [
        'user_settings',
        'api_keys',
        'user_shops',  # 依赖 users 和 ozon_shops
    ]

    # 依赖 ozon_shops 的表
    shop_dependent = [
        'ozon_products',
        'ozon_orders',
        'ozon_postings',
        'ozon_chats',
        'ozon_sync_checkpoints',
        'ozon_sync_logs',
        'ozon_daily_stats',
        'ozon_product_templates',
        'ozon_collection_sources',
    ]

    # 依赖 ozon_products 的表
    product_dependent = [
        'ozon_product_sync_errors',
        'ozon_price_update_logs',
        'ozon_stock_update_logs',
        'listings',
        'inventories',
    ]

    # 依赖 ozon_orders 的表
    order_dependent = [
        'ozon_order_items',
        'ozon_refunds',
        'ozon_cancellations',
        'ozon_returns',
    ]

    # 依赖 ozon_postings 的表
    posting_dependent = [
        'ozon_shipment_packages',
        'ozon_domestic_tracking_numbers',
    ]

    # 依赖 ozon_chats 的表
    chat_dependent = [
        'ozon_chat_messages',
    ]

    # 依赖 ozon_categories 的表
    category_dependent = [
        'ozon_category_attributes',
        'ozon_category_commissions',
        'ozon_attribute_dictionary_values',
    ]

    # 促销相关表
    promotion_tables = [
        'ozon_promotion_actions',
        'ozon_promotion_products',
    ]

    # 财务相关表
    finance_tables = [
        'ozon_finance_transactions',
        'ozon_finance_sync_watermarks',
    ]

    # 配置表（无复杂依赖）
    config_tables = [
        'aliyun_oss_configs',
        'aliyun_translation_configs',
        'chatgpt_translation_configs',
        'cloudinary_configs',
        'watermark_configs',
        'watermark_tasks',
        'xiangjifanyi_configs',
    ]

    # 选品相关表
    selection_tables = [
        'ozon_product_selection_items',
        'ozon_product_selection_import_history',
        'ozon_product_collection_records',
    ]

    # 其他业务表
    other_tables = [
        'orders',
        'order_items',
        'shipments',
        'packages',
        'returns',
        'refunds',
        'audit_logs',
        'audit_logs_archive',
        'sync_service_logs',
        'ozon_webhook_events',
        'ozon_media_import_logs',
        'ozon_product_import_logs',
    ]

    return (
        base_tables +
        config_tables +
        user_dependent +
        shop_dependent +
        category_dependent +
        product_dependent +
        order_dependent +
        posting_dependent +
        chat_dependent +
        promotion_tables +
        finance_tables +
        selection_tables +
        other_tables
    )


def main():
    """主函数"""
    print("=" * 60)
    print("生成统一初始化迁移脚本")
    print("=" * 60)

    # 使用 Alembic 的 autogenerate 功能
    # 但由于表已存在，我们需要基于 schema dump 手动生成

    schema_file = '/tmp/euraflow_schema.sql'
    if not os.path.exists(schema_file):
        print(f"错误：找不到 schema 文件 {schema_file}")
        print("请先运行: pg_dump --schema-only > /tmp/euraflow_schema.sql")
        return 1

    print(f"读取 schema 文件: {schema_file}")

    # 生成迁移脚本
    revision_id = 'init_001'
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')
    filename = f"{timestamp}_{revision_id}_initial_schema.py"
    filepath = f"/home/grom/EuraFlow/alembic/versions/{filename}"

    migration_content = generate_migration_from_schema(schema_file)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(migration_content)

    print(f"✓ 生成迁移脚本: {filepath}")
    print("\n下一步:")
    print("1. 检查生成的迁移脚本")
    print("2. 创建空数据库测试: createdb euraflow_test")
    print("3. 运行迁移: alembic upgrade head")

    return 0


def generate_migration_from_schema(schema_file: str) -> str:
    """从 schema 文件生成迁移内容"""

    header = '''"""initial_schema - 统一初始化迁移

Revision ID: init_001
Revises:
Create Date: 2025-12-05

此迁移脚本基于生产数据库结构生成，用于新环境部署。
包含所有表、索引、约束的创建。

对于已有数据的生产环境，只需将 alembic_version 标记为此版本：
    INSERT INTO alembic_version (version_num) VALUES ('init_001');
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'init_001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create all tables"""

    # ========================================
    # 1. 创建扩展
    # ========================================
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')

'''

    # 读取 schema 文件并解析
    with open(schema_file, 'r', encoding='utf-8') as f:
        schema_sql = f.read()

    # 这里简化处理：直接使用 op.execute 执行原始 SQL
    # 生产环境建议进一步优化为 Alembic 原生操作

    tables_sql = extract_create_tables(schema_sql)
    indexes_sql = extract_create_indexes(schema_sql)
    constraints_sql = extract_alter_tables(schema_sql)
    sequences_sql = extract_sequences(schema_sql)

    body = '''    # ========================================
    # 2. 创建序列
    # ========================================
'''
    for seq in sequences_sql:
        body += f"    op.execute('''{seq}''')\n"

    body += '''
    # ========================================
    # 3. 创建表（按依赖顺序）
    # ========================================
'''
    for table_sql in tables_sql:
        body += f"    op.execute('''{table_sql}''')\n\n"

    body += '''
    # ========================================
    # 4. 添加约束和外键
    # ========================================
'''
    for constraint in constraints_sql:
        body += f"    op.execute('''{constraint}''')\n"

    body += '''
    # ========================================
    # 5. 创建索引
    # ========================================
'''
    for idx in indexes_sql:
        body += f"    op.execute('''{idx}''')\n"

    body += '''
    # ========================================
    # 6. 创建默认管理员用户
    # ========================================
    import os
    import bcrypt

    admin_password = os.getenv('EF__ADMIN_PASSWORD', 'admin123')
    password_bytes = admin_password.encode('utf-8')
    password_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode('utf-8')

    conn = op.get_bind()
    conn.execute(
        sa.text(f"""
            INSERT INTO users (username, password_hash, is_active, role, permissions)
            VALUES ('admin', '{password_hash}', true, 'admin', '["*"]')
            ON CONFLICT (username) DO NOTHING
        """)
    )


def downgrade() -> None:
    """Drop all tables (危险操作！)"""
    # 按照依赖的逆序删除表
    tables = [
'''

    # 添加所有表名（逆序）
    all_tables = get_all_tables_from_schema(schema_sql)
    for table in reversed(all_tables):
        body += f"        '{table}',\n"

    body += '''    ]

    for table in tables:
        op.execute(f'DROP TABLE IF EXISTS {table} CASCADE')

    op.execute('DROP EXTENSION IF EXISTS pg_trgm')
'''

    return header + body


def extract_create_tables(schema_sql: str) -> list:
    """提取 CREATE TABLE 语句"""
    import re

    # 匹配 CREATE TABLE 语句
    pattern = r'CREATE TABLE public\.(\w+)\s*\([^;]+\);'
    matches = re.findall(pattern, schema_sql, re.DOTALL)

    tables = []
    for match in re.finditer(pattern, schema_sql, re.DOTALL):
        # 清理 SQL
        sql = match.group(0)
        sql = sql.replace("public.", "")
        tables.append(sql)

    return tables


def extract_create_indexes(schema_sql: str) -> list:
    """提取 CREATE INDEX 语句"""
    import re

    pattern = r'CREATE (?:UNIQUE )?INDEX [^;]+;'
    matches = re.findall(pattern, schema_sql)

    indexes = []
    for sql in matches:
        sql = sql.replace("public.", "")
        if 'alembic_version' not in sql:
            indexes.append(sql)

    return indexes


def extract_alter_tables(schema_sql: str) -> list:
    """提取 ALTER TABLE 语句（外键约束等）"""
    import re

    pattern = r'ALTER TABLE ONLY public\.\w+\s+ADD CONSTRAINT [^;]+;'
    matches = re.findall(pattern, schema_sql)

    constraints = []
    for sql in matches:
        sql = sql.replace("public.", "")
        sql = sql.replace("ALTER TABLE ONLY", "ALTER TABLE")
        if 'alembic_version' not in sql:
            constraints.append(sql)

    return constraints


def extract_sequences(schema_sql: str) -> list:
    """提取 CREATE SEQUENCE 语句"""
    import re

    pattern = r'CREATE SEQUENCE public\.\w+[^;]+;'
    matches = re.findall(pattern, schema_sql)

    sequences = []
    for sql in matches:
        sql = sql.replace("public.", "")
        sequences.append(sql)

    return sequences


def get_all_tables_from_schema(schema_sql: str) -> list:
    """从 schema 获取所有表名"""
    import re

    pattern = r'CREATE TABLE public\.(\w+)'
    matches = re.findall(pattern, schema_sql)

    # 过滤掉 alembic_version
    return [t for t in matches if t != 'alembic_version']


if __name__ == '__main__':
    sys.exit(main())
