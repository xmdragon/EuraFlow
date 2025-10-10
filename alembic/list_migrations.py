#!/usr/bin/env python3
"""
迁移索引工具

按模块分类列出所有数据库迁移，帮助理解迁移历史。

使用方法:
    python alembic/list_migrations.py
    python alembic/list_migrations.py --module orders
    python alembic/list_migrations.py --fragmented
"""
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple
from datetime import datetime


class MigrationInfo:
    """迁移信息"""

    def __init__(self, filepath: Path):
        self.filepath = filepath
        self.filename = filepath.name
        self.parse_filename()
        self.parse_content()

    def parse_filename(self):
        """解析文件名"""
        # 格式: 20251009_1656_97f3b8a541f8_add_currency_code_to_ozon_products.py
        parts = self.filename.replace('.py', '').split('_')
        if len(parts) >= 3:
            self.date_str = parts[0]
            self.time_str = parts[1]
            self.revision_id = parts[2]
            self.description = '_'.join(parts[3:])

            # 解析日期
            try:
                self.date = datetime.strptime(self.date_str, '%Y%m%d')
            except ValueError:
                self.date = None
        else:
            self.date_str = None
            self.time_str = None
            self.revision_id = None
            self.description = self.filename.replace('.py', '')
            self.date = None

    def parse_content(self):
        """解析文件内容，提取描述和分类信息"""
        with open(self.filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # 提取文档字符串
        docstring_match = re.search(r'"""(.*?)"""', content, re.DOTALL)
        if docstring_match:
            self.docstring = docstring_match.group(1).strip()
        else:
            self.docstring = ''

        # 判断分类
        self.category = self.categorize()

        # 检查是否是碎片化迁移
        self.is_fragmented = '碎片化迁移' in content or '⚠️ 注意：本迁移是碎片化迁移的一部分' in content

    def categorize(self) -> str:
        """根据文件名和内容判断所属分类"""
        desc_lower = self.description.lower() if self.description else ''
        content_lower = (self.filename + self.docstring).lower()

        if 'user' in content_lower or 'shop' in content_lower and 'ozon_shop' not in content_lower:
            return '用户和店铺'
        elif 'product' in content_lower and 'product_selection' not in content_lower:
            return 'OZON商品'
        elif 'order' in content_lower:
            return 'OZON订单'
        elif 'chat' in content_lower:
            return 'OZON聊天'
        elif 'product_selection' in content_lower or 'selection' in content_lower:
            return '选品助手'
        elif 'watermark' in content_lower or 'cloudinary' in content_lower:
            return '水印管理'
        elif 'api_key' in content_lower:
            return 'API密钥'
        elif 'datetime' in content_lower and 'timezone' in content_lower:
            return 'DateTime修复'
        else:
            return '其他'

    def __str__(self) -> str:
        fragmented_mark = ' ⚠️' if self.is_fragmented else ''
        return f"{self.date_str} {self.time_str} {self.revision_id[:8]} {self.description}{fragmented_mark}"


def get_all_migrations(versions_dir: str = 'alembic/versions') -> List[MigrationInfo]:
    """获取所有迁移文件信息"""
    migrations = []
    versions_path = Path(versions_dir)

    if not versions_path.exists():
        print(f"错误: 目录不存在 {versions_dir}")
        return migrations

    for filepath in versions_path.glob('*.py'):
        if filepath.name == '__init__.py' or filepath.name == '__pycache__':
            continue
        try:
            migration = MigrationInfo(filepath)
            migrations.append(migration)
        except Exception as e:
            print(f"警告: 解析文件 {filepath.name} 失败: {e}")

    # 按日期时间排序
    migrations.sort(key=lambda m: (m.date_str or '', m.time_str or ''))
    return migrations


def group_by_category(migrations: List[MigrationInfo]) -> Dict[str, List[MigrationInfo]]:
    """按分类分组"""
    groups = {}
    for migration in migrations:
        category = migration.category
        if category not in groups:
            groups[category] = []
        groups[category].append(migration)
    return groups


def print_migrations(migrations: List[MigrationInfo], title: str = '所有迁移'):
    """打印迁移列表"""
    print(f"\n{'='*80}")
    print(f"{title} (共 {len(migrations)} 个)")
    print('='*80)

    groups = group_by_category(migrations)

    # 固定的分类顺序
    category_order = [
        '用户和店铺', 'OZON商品', 'OZON订单', 'OZON聊天',
        '选品助手', '水印管理', 'API密钥', 'DateTime修复', '其他'
    ]

    for category in category_order:
        if category in groups:
            print(f"\n## {category}")
            print('-'*80)
            for migration in groups[category]:
                print(f"  {migration}")


def print_fragmented_migrations(migrations: List[MigrationInfo]):
    """打印碎片化迁移"""
    fragmented = [m for m in migrations if m.is_fragmented]

    if not fragmented:
        print("\n未发现碎片化迁移")
        return

    print(f"\n{'='*80}")
    print(f"碎片化迁移 (共 {len(fragmented)} 个)")
    print('='*80)
    print("\n这些迁移应该合并为单个迁移以提高可维护性：\n")

    for migration in fragmented:
        print(f"  {migration}")


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description='列出数据库迁移')
    parser.add_argument('--module', '-m', help='只显示特定模块的迁移')
    parser.add_argument('--fragmented', '-f', action='store_true', help='只显示碎片化迁移')
    parser.add_argument('--stats', '-s', action='store_true', help='显示统计信息')

    args = parser.parse_args()

    # 获取所有迁移
    migrations = get_all_migrations()

    if not migrations:
        print("未找到任何迁移文件")
        return

    # 显示统计信息
    if args.stats:
        groups = group_by_category(migrations)
        fragmented_count = sum(1 for m in migrations if m.is_fragmented)

        print(f"\n{'='*80}")
        print("迁移统计")
        print('='*80)
        print(f"总迁移数: {len(migrations)}")
        print(f"碎片化迁移: {fragmented_count}")
        print("\n按模块分布:")
        for category, migs in sorted(groups.items(), key=lambda x: -len(x[1])):
            print(f"  {category}: {len(migs)} 个")
        return

    # 只显示碎片化迁移
    if args.fragmented:
        print_fragmented_migrations(migrations)
        return

    # 按模块过滤
    if args.module:
        filtered = [m for m in migrations if args.module.lower() in m.category.lower()]
        print_migrations(filtered, f"{args.module} 模块的迁移")
    else:
        # 显示所有迁移
        print_migrations(migrations)

        # 额外显示碎片化迁移警告
        fragmented = [m for m in migrations if m.is_fragmented]
        if fragmented:
            print(f"\n⚠️  发现 {len(fragmented)} 个碎片化迁移（使用 --fragmented 查看详情）")


if __name__ == '__main__':
    main()
