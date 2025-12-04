#!/usr/bin/env python3
"""
数据库结构文档生成器

从 SQLAlchemy 模型自动生成 Markdown 文档。

用法:
    python scripts/generate_db_docs.py

输出:
    docs/database/README.md       - 索引文件
    docs/database/core/*.md       - 核心表文档
    docs/database/ozon/*.md       - OZON 插件表文档
    docs/database/system/*.md     - 系统插件表文档
"""

import ast
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent
DOCS_DIR = PROJECT_ROOT / "docs" / "database"

# 模型目录配置
MODEL_CONFIGS = [
    {
        "path": PROJECT_ROOT / "ef_core" / "models",
        "category": "core",
        "label": "核心表",
        "description": "ef_core 基础数据模型",
    },
    {
        "path": PROJECT_ROOT / "plugins" / "ef" / "channels" / "ozon" / "models",
        "category": "ozon",
        "label": "OZON 插件表",
        "description": "OZON 渠道插件数据模型",
    },
    {
        "path": PROJECT_ROOT / "plugins" / "ef" / "system" / "sync_service" / "models",
        "category": "system",
        "label": "系统插件表",
        "description": "系统级插件数据模型",
    },
]


@dataclass
class ColumnInfo:
    """字段信息"""
    name: str
    col_type: str
    nullable: bool = True
    default: Optional[str] = None
    comment: Optional[str] = None
    is_primary_key: bool = False
    is_foreign_key: bool = False
    foreign_key_ref: Optional[str] = None


@dataclass
class IndexInfo:
    """索引信息"""
    name: str
    columns: list[str] = field(default_factory=list)
    unique: bool = False


@dataclass
class TableInfo:
    """表信息"""
    table_name: str
    class_name: str
    file_path: str
    docstring: Optional[str] = None
    columns: list[ColumnInfo] = field(default_factory=list)
    indexes: list[IndexInfo] = field(default_factory=list)
    unique_constraints: list[str] = field(default_factory=list)
    category: str = "core"


class ModelParser(ast.NodeVisitor):
    """SQLAlchemy 模型解析器"""

    def __init__(self, file_path: str, category: str):
        self.file_path = file_path
        self.category = category
        self.tables: list[TableInfo] = []
        self.current_class: Optional[TableInfo] = None

    def visit_ClassDef(self, node: ast.ClassDef):
        """解析类定义"""
        # 检查是否继承 Base
        base_names = [self._get_name(b) for b in node.bases]
        if "Base" not in base_names:
            return

        # 获取表名
        table_name = None
        unique_constraints = []
        indexes = []

        for item in node.body:
            # 查找 __tablename__
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name) and target.id == "__tablename__":
                        if isinstance(item.value, ast.Constant):
                            table_name = item.value.value

            # 查找 __table_args__
            if isinstance(item, ast.Assign):
                for target in item.targets:
                    if isinstance(target, ast.Name) and target.id == "__table_args__":
                        constraints, idxs = self._parse_table_args(item.value)
                        unique_constraints.extend(constraints)
                        indexes.extend(idxs)

        if not table_name:
            return

        # 获取 docstring
        docstring = ast.get_docstring(node)

        self.current_class = TableInfo(
            table_name=table_name,
            class_name=node.name,
            file_path=self.file_path,
            docstring=docstring,
            category=self.category,
            unique_constraints=unique_constraints,
            indexes=indexes,
        )

        # 解析字段
        for item in node.body:
            # mapped_column 风格（带类型注解）
            if isinstance(item, ast.AnnAssign) and item.value:
                col = self._parse_column(item)
                if col:
                    self.current_class.columns.append(col)
            # 经典 Column 风格（无类型注解）
            elif isinstance(item, ast.Assign):
                col = self._parse_classic_column(item)
                if col:
                    self.current_class.columns.append(col)

        self.tables.append(self.current_class)
        self.current_class = None

    def _get_name(self, node) -> str:
        """获取节点名称"""
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        return ""

    def _parse_table_args(self, node) -> tuple[list[str], list[IndexInfo]]:
        """解析 __table_args__"""
        constraints = []
        indexes = []

        if isinstance(node, ast.Tuple):
            for elt in node.elts:
                if isinstance(elt, ast.Call):
                    func_name = self._get_name(elt.func)
                    if func_name == "UniqueConstraint":
                        cols = []
                        name = None
                        for arg in elt.args:
                            if isinstance(arg, ast.Constant):
                                cols.append(arg.value)
                        for kw in elt.keywords:
                            if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                                name = kw.value.value
                        if cols:
                            constraints.append(f"{name}: ({', '.join(cols)})")
                    elif func_name == "Index":
                        idx_name = None
                        cols = []
                        for arg in elt.args:
                            if isinstance(arg, ast.Constant):
                                if idx_name is None:
                                    idx_name = arg.value
                                else:
                                    cols.append(arg.value)
                        if idx_name and cols:
                            indexes.append(IndexInfo(name=idx_name, columns=cols))

        return constraints, indexes

    def _parse_column(self, node: ast.AnnAssign) -> Optional[ColumnInfo]:
        """解析字段定义（mapped_column 风格）"""
        if not isinstance(node.target, ast.Name):
            return None

        col_name = node.target.id
        if col_name.startswith("_"):
            return None

        # 解析 mapped_column 调用
        if not isinstance(node.value, ast.Call):
            return None

        func_name = self._get_name(node.value.func)
        if func_name != "mapped_column":
            return None

        col_type = "Unknown"
        nullable = True
        default = None
        comment = None
        is_pk = False
        is_fk = False
        fk_ref = None

        # 解析位置参数
        for arg in node.value.args:
            if isinstance(arg, ast.Name):
                col_type = arg.id
            elif isinstance(arg, ast.Call):
                arg_name = self._get_name(arg.func)
                if arg_name == "ForeignKey":
                    is_fk = True
                    if arg.args and isinstance(arg.args[0], ast.Constant):
                        fk_ref = arg.args[0].value
                else:
                    col_type = arg_name
                    # 提取类型参数
                    type_args = []
                    for sub_arg in arg.args:
                        if isinstance(sub_arg, ast.Constant):
                            type_args.append(str(sub_arg.value))
                    if type_args:
                        col_type = f"{arg_name}({', '.join(type_args)})"

        # 解析关键字参数
        for kw in node.value.keywords:
            if kw.arg == "primary_key" and isinstance(kw.value, ast.Constant):
                is_pk = kw.value.value
            elif kw.arg == "nullable" and isinstance(kw.value, ast.Constant):
                nullable = kw.value.value
            elif kw.arg == "default":
                if isinstance(kw.value, ast.Constant):
                    default = repr(kw.value.value)
                elif isinstance(kw.value, ast.Name):
                    default = kw.value.id
            elif kw.arg == "server_default":
                if isinstance(kw.value, ast.Call):
                    default = f"server: {self._get_name(kw.value.func)}()"
            elif kw.arg == "comment" and isinstance(kw.value, ast.Constant):
                comment = kw.value.value

        # 从类型注解提取 Optional
        if isinstance(node.annotation, ast.Subscript):
            if isinstance(node.annotation.value, ast.Name):
                if node.annotation.value.id == "Optional":
                    nullable = True

        return ColumnInfo(
            name=col_name,
            col_type=col_type,
            nullable=nullable,
            default=default,
            comment=comment,
            is_primary_key=is_pk,
            is_foreign_key=is_fk,
            foreign_key_ref=fk_ref,
        )

    def _parse_classic_column(self, node: ast.Assign) -> Optional[ColumnInfo]:
        """解析经典 Column 风格字段定义"""
        if len(node.targets) != 1:
            return None
        if not isinstance(node.targets[0], ast.Name):
            return None

        col_name = node.targets[0].id
        if col_name.startswith("_") or col_name in ("__tablename__", "__table_args__"):
            return None

        # 解析 Column 调用
        if not isinstance(node.value, ast.Call):
            return None

        func_name = self._get_name(node.value.func)
        if func_name != "Column":
            return None

        col_type = "Unknown"
        nullable = True
        default = None
        comment = None
        is_pk = False
        is_fk = False
        fk_ref = None

        # 解析位置参数
        for arg in node.value.args:
            if isinstance(arg, ast.Name):
                col_type = arg.id
            elif isinstance(arg, ast.Attribute):
                col_type = arg.attr
            elif isinstance(arg, ast.Call):
                arg_name = self._get_name(arg.func)
                if arg_name == "ForeignKey":
                    is_fk = True
                    if arg.args and isinstance(arg.args[0], ast.Constant):
                        fk_ref = arg.args[0].value
                else:
                    col_type = arg_name
                    # 提取类型参数
                    type_args = []
                    for sub_arg in arg.args:
                        if isinstance(sub_arg, ast.Constant):
                            type_args.append(str(sub_arg.value))
                    if type_args:
                        col_type = f"{arg_name}({', '.join(type_args)})"

        # 解析关键字参数
        for kw in node.value.keywords:
            if kw.arg == "primary_key" and isinstance(kw.value, ast.Constant):
                is_pk = kw.value.value
            elif kw.arg == "nullable" and isinstance(kw.value, ast.Constant):
                nullable = kw.value.value
            elif kw.arg == "default":
                if isinstance(kw.value, ast.Constant):
                    default = repr(kw.value.value)
                elif isinstance(kw.value, ast.Name):
                    default = kw.value.id
            elif kw.arg == "comment" and isinstance(kw.value, ast.Constant):
                comment = kw.value.value

        return ColumnInfo(
            name=col_name,
            col_type=col_type,
            nullable=nullable,
            default=default,
            comment=comment,
            is_primary_key=is_pk,
            is_foreign_key=is_fk,
            foreign_key_ref=fk_ref,
        )


def parse_model_file(file_path: Path, category: str) -> list[TableInfo]:
    """解析模型文件"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            source = f.read()

        tree = ast.parse(source)
        parser = ModelParser(str(file_path.relative_to(PROJECT_ROOT)), category)
        parser.visit(tree)
        return parser.tables
    except Exception as e:
        print(f"  警告: 解析 {file_path} 失败: {e}")
        return []


def parse_table_definition(file_path: Path, category: str) -> list[TableInfo]:
    """解析 Table 定义（如 user_shops）"""
    tables = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            source = f.read()

        # 匹配 Table 定义
        pattern = r"(\w+)\s*=\s*Table\s*\(\s*['\"](\w+)['\"]"
        for match in re.finditer(pattern, source):
            var_name, table_name = match.groups()

            # 提取列定义
            columns = []
            col_pattern = rf"{var_name}\s*=\s*Table\s*\([^)]+\)"
            table_match = re.search(col_pattern, source, re.DOTALL)
            if table_match:
                table_def = table_match.group()
                # 提取 Column 定义
                col_matches = re.findall(
                    r"Column\s*\(\s*['\"](\w+)['\"].*?comment=['\"]([^'\"]+)['\"]",
                    table_def,
                    re.DOTALL,
                )
                for col_name, comment in col_matches:
                    columns.append(
                        ColumnInfo(
                            name=col_name,
                            col_type="BigInteger",
                            nullable=False,
                            comment=comment,
                            is_primary_key=True,
                        )
                    )

            if columns:
                tables.append(
                    TableInfo(
                        table_name=table_name,
                        class_name=var_name,
                        file_path=str(file_path.relative_to(PROJECT_ROOT)),
                        docstring="关联表",
                        columns=columns,
                        category=category,
                    )
                )
    except Exception as e:
        print(f"  警告: 解析 Table 定义失败: {e}")

    return tables


def generate_table_doc(table: TableInfo) -> str:
    """生成单表文档"""
    lines = [f"# {table.table_name}", ""]

    # 基本信息
    lines.extend(
        [
            "## 基本信息",
            "",
            f"- **模型文件**: `{table.file_path}`",
            f"- **模型类**: `{table.class_name}`",
        ]
    )
    if table.docstring:
        lines.append(f"- **用途**: {table.docstring}")
    lines.append("")

    # 字段结构
    lines.extend(["## 字段结构", "", "| 字段名 | 类型 | 可空 | 默认值 | 说明 |", "|--------|------|:----:|--------|------|"])

    for col in table.columns:
        nullable = "YES" if col.nullable else "NO"
        if col.is_primary_key:
            nullable = "PK"
        default = col.default or "-"
        comment = col.comment or "-"

        # 外键标注
        if col.is_foreign_key and col.foreign_key_ref:
            comment = f"FK → {col.foreign_key_ref}" + (f" | {comment}" if col.comment else "")

        lines.append(f"| {col.name} | {col.col_type} | {nullable} | {default} | {comment} |")

    lines.append("")

    # 索引
    if table.indexes:
        lines.extend(["## 索引", ""])
        for idx in table.indexes:
            cols = ", ".join(idx.columns)
            unique = " (UNIQUE)" if idx.unique else ""
            lines.append(f"- `{idx.name}` ({cols}){unique}")
        lines.append("")

    # 唯一约束
    if table.unique_constraints:
        lines.extend(["## 唯一约束", ""])
        for uc in table.unique_constraints:
            lines.append(f"- {uc}")
        lines.append("")

    # 外键关系
    fks = [col for col in table.columns if col.is_foreign_key and col.foreign_key_ref]
    if fks:
        lines.extend(["## 外键关系", ""])
        for col in fks:
            lines.append(f"- `{col.name}` → `{col.foreign_key_ref}`")
        lines.append("")

    return "\n".join(lines)


def generate_readme(all_tables: dict[str, list[TableInfo]], configs: list[dict]) -> str:
    """生成索引文件"""
    lines = [
        "# EuraFlow 数据库结构",
        "",
        "> 自动生成，请勿手动编辑。运行 `python scripts/generate_db_docs.py` 更新。",
        "",
        "## 快速索引",
        "",
    ]

    # 表清单
    total = sum(len(tables) for tables in all_tables.values())
    lines.append(f"共 **{total}** 张表，分为以下类别：")
    lines.append("")

    for config in configs:
        cat = config["category"]
        tables = all_tables.get(cat, [])
        lines.append(f"- [{config['label']}](#{cat}) ({len(tables)} 张)")
    lines.append("")

    # 分类详情
    for config in configs:
        cat = config["category"]
        tables = all_tables.get(cat, [])
        if not tables:
            continue

        lines.extend([f"## {config['label']} {{{cat}}}", "", f"{config['description']}", "", "| 表名 | 说明 | 文档 |", "|------|------|------|"])

        for table in sorted(tables, key=lambda t: t.table_name):
            desc = table.docstring or "-"
            # 截断过长描述
            if len(desc) > 50:
                desc = desc[:47] + "..."
            doc_link = f"[查看](./{cat}/{table.table_name}.md)"
            lines.append(f"| {table.table_name} | {desc} | {doc_link} |")

        lines.append("")

    # 表关系图
    lines.extend(
        [
            "## 核心表关系图",
            "",
            "```mermaid",
            "erDiagram",
            "    users ||--o{ user_settings : has",
            "    users ||--o{ api_keys : owns",
            "    users ||--o{ ozon_shops : owns",
            "    users }o--o{ ozon_shops : user_shops",
            "",
            "    ozon_shops ||--o{ ozon_products : contains",
            "    ozon_shops ||--o{ ozon_orders : receives",
            "    ozon_shops ||--o{ ozon_postings : ships",
            "    ozon_shops ||--o{ ozon_finance_transactions : records",
            "",
            "    ozon_orders ||--o{ ozon_order_items : contains",
            "    ozon_orders ||--o{ ozon_postings : generates",
            "    ozon_orders ||--o{ ozon_cancellations : may_have",
            "",
            "    ozon_postings ||--o{ ozon_shipment_packages : packages",
            "    ozon_postings ||--o{ ozon_domestic_tracking_numbers : tracks",
            "```",
            "",
        ]
    )

    return "\n".join(lines)


def main():
    """主函数"""
    print("=" * 60)
    print("EuraFlow 数据库文档生成器")
    print("=" * 60)

    # 收集所有表
    all_tables: dict[str, list[TableInfo]] = {}

    for config in MODEL_CONFIGS:
        model_dir = config["path"]
        category = config["category"]
        print(f"\n扫描 {category}: {model_dir}")

        if not model_dir.exists():
            print(f"  目录不存在，跳过")
            continue

        tables = []
        for py_file in model_dir.glob("*.py"):
            if py_file.name.startswith("_"):
                continue
            print(f"  解析 {py_file.name}...")

            # 解析类定义
            file_tables = parse_model_file(py_file, category)
            tables.extend(file_tables)

            # 解析 Table 定义
            table_defs = parse_table_definition(py_file, category)
            tables.extend(table_defs)

        all_tables[category] = tables
        print(f"  找到 {len(tables)} 张表")

    # 创建输出目录
    print(f"\n创建输出目录: {DOCS_DIR}")
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    for config in MODEL_CONFIGS:
        cat_dir = DOCS_DIR / config["category"]
        cat_dir.mkdir(exist_ok=True)

    # 生成单表文档
    print("\n生成表文档...")
    for category, tables in all_tables.items():
        cat_dir = DOCS_DIR / category
        for table in tables:
            doc_path = cat_dir / f"{table.table_name}.md"
            doc_content = generate_table_doc(table)
            with open(doc_path, "w", encoding="utf-8") as f:
                f.write(doc_content)
            print(f"  {category}/{table.table_name}.md")

    # 生成索引文件
    print("\n生成索引文件...")
    readme_content = generate_readme(all_tables, MODEL_CONFIGS)
    readme_path = DOCS_DIR / "README.md"
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(readme_content)
    print(f"  README.md")

    # 统计
    total = sum(len(tables) for tables in all_tables.values())
    print(f"\n完成！共生成 {total} 个表文档 + 1 个索引文件")
    print(f"输出目录: {DOCS_DIR}")


if __name__ == "__main__":
    main()
