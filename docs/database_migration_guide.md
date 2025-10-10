# 数据库迁移指南

> 本指南规定了 EuraFlow 项目中创建和管理 Alembic 数据库迁移的标准流程和最佳实践。

---

## 📋 目录

1. [创建迁移](#创建迁移)
2. [命名规范](#命名规范)
3. [迁移内容规范](#迁移内容规范)
4. [测试流程](#测试流程)
5. [常见场景](#常见场景)
6. [禁止事项](#禁止事项)
7. [故障排查](#故障排查)

---

## 创建迁移

### 基础流程

```bash
# 1. 修改 SQLAlchemy 模型（models.py）
# 2. 生成迁移文件
./venv/bin/alembic revision -m "描述性的迁移名称"

# 3. 编辑生成的迁移文件，实现 upgrade() 和 downgrade()
# 4. 测试迁移
./venv/bin/alembic upgrade head
./venv/bin/alembic downgrade -1
./venv/bin/alembic upgrade head

# 5. 提交到版本控制
git add alembic/versions/...
git commit -m "添加数据库迁移: 描述"
```

### 何时创建迁移

**应该创建迁移的情况**：
- ✅ 添加新表
- ✅ 添加/删除/修改列
- ✅ 添加/删除索引
- ✅ 添加/删除约束（外键、唯一性、检查约束）
- ✅ 修改列类型或属性
- ✅ 数据迁移（填充默认值、转换数据格式）

**不需要迁移的情况**：
- ❌ 仅修改 Python 代码逻辑
- ❌ 修改注释或文档字符串（不影响数据库 schema）
- ❌ 重构代码但不改变数据库结构

---

## 命名规范

### 迁移文件命名

Alembic 自动生成的格式：
```
{timestamp}_{revision_id}_{description}.py
```

示例：
```
20251009_1656_97f3b8a541f8_add_currency_code_to_ozon_products.py
```

### 描述命名规则

使用**动词_对象_表名**格式，全小写，下划线分隔：

**推荐的命名**：
- ✅ `add_currency_code_to_ozon_products`
- ✅ `create_product_selections_table`
- ✅ `remove_deprecated_order_fields`
- ✅ `update_user_email_to_unique`
- ✅ `add_indexes_to_ozon_orders`

**不推荐的命名**：
- ❌ `update_database` （太模糊）
- ❌ `fix_bug` （不说明修改了什么）
- ❌ `migration_2` （无意义）
- ❌ `AddCurrencyCode` （使用了驼峰命名）

### 常用动词

| 动作 | 动词 | 示例 |
|------|------|------|
| 创建表 | `create` | `create_users_table` |
| 删除表 | `drop` | `drop_temp_table` |
| 添加列 | `add` | `add_status_to_orders` |
| 删除列 | `remove` | `remove_deprecated_fields` |
| 修改列 | `modify`/`update` | `modify_price_precision` |
| 重命名 | `rename` | `rename_user_to_account` |
| 添加索引 | `add_index` | `add_index_to_order_number` |
| 添加约束 | `add_constraint` | `add_unique_constraint_to_sku` |

---

## 迁移内容规范

### 文档字符串

每个迁移文件**必须**包含清晰的文档字符串：

```python
"""add_currency_code_to_ozon_products

Revision ID: 97f3b8a541f8
Revises: ec9f36ac48db
Create Date: 2025-10-09 16:56:23.984634

## 目的
为 ozon_products 表添加货币代码字段，支持多货币价格展示。

## 变更内容
- 添加 currency_code 列（String(10)，可为空）
- 默认值：NULL（后续数据同步时填充）

## 影响
- 表：ozon_products
- 影响行数：~50000
- 预计执行时间：< 1秒
- 向后兼容：是（新字段可为空）

## 测试
- 本地测试：通过
- 回滚测试：通过
"""
```

### upgrade() 函数规范

```python
def upgrade() -> None:
    """Upgrade database schema"""
    # 1. 添加列时使用明确的类型和注释
    op.add_column('ozon_products',
                  sa.Column('currency_code',
                           sa.String(length=10),
                           nullable=True,
                           comment='货币代码(CNY/RUB/USD等)'))

    # 2. 添加索引时指定名称
    op.create_index('ix_ozon_products_currency_code',
                    'ozon_products',
                    ['currency_code'])

    # 3. 数据迁移时使用批量操作
    # connection = op.get_bind()
    # connection.execute(
    #     sa.text("UPDATE ozon_products SET currency_code = 'RUB' WHERE currency_code IS NULL")
    # )
```

### downgrade() 函数规范

**必须**实现 downgrade，确保可回滚：

```python
def downgrade() -> None:
    """Downgrade database schema"""
    # 按相反顺序撤销操作
    op.drop_index('ix_ozon_products_currency_code', table_name='ozon_products')
    op.drop_column('ozon_products', 'currency_code')
```

### 数据类型约定

遵循项目硬性约束：

```python
# ✅ 金额字段：使用 Decimal
sa.Column('price', sa.Numeric(precision=18, scale=4), nullable=False)

# ✅ 时间字段：DateTime，存储 UTC
sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now())

# ✅ JSON 字段：使用 JSONB（PostgreSQL）
from sqlalchemy.dialects.postgresql import JSONB
sa.Column('metadata', JSONB, nullable=True)

# ❌ 禁止：金额使用 Float
# sa.Column('price', sa.Float(), nullable=False)  # 精度丢失！

# ❌ 禁止：时间使用 String
# sa.Column('created_at', sa.String(50), nullable=False)  # 无法排序/比较！
```

---

## 测试流程

### 本地测试清单

**在提交迁移前，必须完成以下测试**：

```bash
# 1. 检查当前数据库状态
./venv/bin/alembic current

# 2. 升级到新迁移
./venv/bin/alembic upgrade head

# 3. 验证数据库结构
psql $DATABASE_URL -c "\d+ ozon_products"  # 检查表结构

# 4. 测试回滚
./venv/bin/alembic downgrade -1

# 5. 再次升级
./venv/bin/alembic upgrade head

# 6. 运行应用测试
pytest tests/test_models.py -v
```

### 大表迁移测试

对于大表（> 100万行），需要额外测试：

```python
# 1. 使用 EXPLAIN 分析执行计划
connection = op.get_bind()
result = connection.execute(sa.text(
    "EXPLAIN ANALYZE ALTER TABLE ozon_products ADD COLUMN currency_code VARCHAR(10)"
))
print(result.fetchall())

# 2. 使用 CONCURRENTLY 创建索引（避免锁表）
op.create_index('ix_ozon_products_currency_code',
                'ozon_products',
                ['currency_code'],
                postgresql_concurrently=True)
```

### 生产环境测试策略

```bash
# 1. 在测试环境执行
DATABASE_URL=postgresql://test_db ./venv/bin/alembic upgrade head

# 2. 验证数据完整性
./venv/bin/python scripts/validate_migration.py

# 3. 性能测试
./venv/bin/python scripts/benchmark_queries.py

# 4. 回滚测试
DATABASE_URL=postgresql://test_db ./venv/bin/alembic downgrade -1
```

---

## 常见场景

### 场景 1：批量添加多个字段

**❌ 错误做法**：创建多个迁移

```bash
# 不要这样做！
alembic revision -m "add_field_a"
alembic revision -m "add_field_b"
alembic revision -m "add_field_c"
```

**✅ 正确做法**：合并为一个迁移

```bash
alembic revision -m "add_multiple_fields_to_ozon_products"
```

```python
def upgrade() -> None:
    """添加多个相关字段"""
    op.add_column('ozon_products',
                  sa.Column('currency_code', sa.String(10), nullable=True))
    op.add_column('ozon_products',
                  sa.Column('raw_payload', JSONB, nullable=True))
    op.add_column('ozon_products',
                  sa.Column('ozon_created_at', sa.DateTime(), nullable=True))
```

**何时可以分开**：
- 字段属于不同的功能模块
- 迁移跨越多个表
- 某个字段需要复杂的数据迁移逻辑

### 场景 2：修改列类型

```python
def upgrade() -> None:
    """将 price 从 Float 改为 Decimal"""
    # 1. 添加新列
    op.add_column('ozon_products',
                  sa.Column('price_new', sa.Numeric(18, 4), nullable=True))

    # 2. 迁移数据
    op.execute("UPDATE ozon_products SET price_new = price::numeric(18,4)")

    # 3. 删除旧列
    op.drop_column('ozon_products', 'price')

    # 4. 重命名新列
    op.alter_column('ozon_products', 'price_new', new_column_name='price')

def downgrade() -> None:
    """回滚到 Float"""
    op.alter_column('ozon_products', 'price', new_column_name='price_new')
    op.add_column('ozon_products',
                  sa.Column('price', sa.Float(), nullable=True))
    op.execute("UPDATE ozon_products SET price = price_new::float")
    op.drop_column('ozon_products', 'price_new')
```

### 场景 3：添加外键约束

```python
def upgrade() -> None:
    """添加外键约束"""
    # 1. 确保引用完整性（先清理脏数据）
    op.execute("""
        DELETE FROM ozon_orders
        WHERE shop_id NOT IN (SELECT id FROM ozon_shops)
    """)

    # 2. 添加外键
    op.create_foreign_key(
        'fk_ozon_orders_shop_id',  # 约束名称
        'ozon_orders',              # 源表
        'ozon_shops',               # 目标表
        ['shop_id'],                # 源列
        ['id'],                     # 目标列
        ondelete='CASCADE'          # 删除策略
    )

def downgrade() -> None:
    """删除外键约束"""
    op.drop_constraint('fk_ozon_orders_shop_id', 'ozon_orders', type_='foreignkey')
```

### 场景 4：数据迁移

```python
def upgrade() -> None:
    """迁移旧数据到新结构"""
    from sqlalchemy import table, column

    # 1. 添加新列
    op.add_column('ozon_products',
                  sa.Column('status_enum', sa.Enum('active', 'archived', name='product_status'), nullable=True))

    # 2. 定义临时表结构
    products = table('ozon_products',
                     column('id', sa.Integer),
                     column('is_active', sa.Boolean),
                     column('status_enum', sa.String))

    # 3. 批量更新数据
    connection = op.get_bind()
    connection.execute(
        products.update()
        .where(products.c.is_active == True)
        .values(status_enum='active')
    )
    connection.execute(
        products.update()
        .where(products.c.is_active == False)
        .values(status_enum='archived')
    )

    # 4. 删除旧列
    op.drop_column('ozon_products', 'is_active')

def downgrade() -> None:
    """回滚数据迁移"""
    # 类似逆向操作
    pass
```

---

## 禁止事项

### ❌ 绝对禁止

1. **修改已应用的迁移文件**
   ```bash
   # 已经 upgrade 的迁移不能修改！
   # 如果发现错误，应该创建新的迁移来修正
   ```

2. **删除已提交的迁移文件**
   ```bash
   # 删除迁移会导致版本链断裂
   # 如果需要撤销，使用 downgrade 和新的迁移
   ```

3. **跳过迁移测试**
   ```bash
   # 未测试回滚的迁移可能导致生产事故
   ```

4. **在迁移中硬编码敏感信息**
   ```python
   # ❌ 不要这样做
   op.execute("INSERT INTO api_keys VALUES ('sk-hardcoded-key')")

   # ✅ 应该这样做
   # 敏感数据通过环境变量或数据导入脚本处理
   ```

5. **使用 DROP COLUMN 删除生产数据**
   ```python
   # ❌ 危险：直接删除可能导致数据丢失
   op.drop_column('users', 'email')

   # ✅ 安全：先标记为废弃，观察一段时间后再删除
   op.add_column('users', sa.Column('email_deprecated', sa.String(), nullable=True))
   # 数据迁移...
   # 等待 1-2 个版本后再删除旧列
   ```

### ⚠️ 谨慎操作

1. **大表添加 NOT NULL 列**
   ```python
   # ⚠️ 可能锁表很久
   op.add_column('ozon_products',
                 sa.Column('new_field', sa.String(), nullable=False, server_default='default'))

   # ✅ 分两步：先允许 NULL，填充数据后再改为 NOT NULL
   ```

2. **重命名列/表**
   ```python
   # ⚠️ 可能导致应用代码报错
   # 需要先部署兼容旧名称的代码，再执行迁移
   ```

3. **复杂的数据转换**
   ```python
   # ⚠️ 可能执行很久，阻塞其他操作
   # 考虑使用后台任务分批处理
   ```

---

## 故障排查

### 常见问题

#### 1. "Target database is not up to date"

```bash
# 问题：本地数据库版本落后
# 解决：
./venv/bin/alembic upgrade head
```

#### 2. "Can't locate revision identified by 'xxxx'"

```bash
# 问题：迁移链断裂或文件丢失
# 解决：检查 alembic/versions/ 目录，确保所有迁移文件存在
git pull origin master  # 拉取缺失的迁移文件
```

#### 3. 迁移执行卡住

```bash
# 问题：可能是表被锁定
# 诊断：
psql $DATABASE_URL -c "SELECT * FROM pg_locks WHERE NOT granted;"

# 解决：等待锁释放或终止阻塞的查询
```

#### 4. downgrade 失败

```python
# 问题：downgrade() 实现不完整
# 解决：确保 downgrade() 完全撤销 upgrade() 的所有操作
# 按相反顺序撤销，删除添加的内容，恢复删除的内容
```

### 检查工具

```bash
# 查看当前版本
./venv/bin/alembic current

# 查看迁移历史
./venv/bin/alembic history

# 查看特定迁移详情
./venv/bin/alembic show <revision_id>

# 使用项目工具查看分类迁移
python alembic/list_migrations.py
python alembic/list_migrations.py --module orders
python alembic/list_migrations.py --fragmented
python alembic/list_migrations.py --stats
```

---

## 参考资料

- [Alembic 官方文档](https://alembic.sqlalchemy.org/)
- [项目迁移历史](../alembic/MIGRATIONS.md)
- [EuraFlow 代码规范](../CODESTYLE.md)
- [EuraFlow 开发指南](../CLAUDE.md)

---

## 更新日志

- **2025-10-10**: 创建初始版本
- 定期更新：根据项目实践持续完善

---

> 💡 **提示**：遇到复杂的迁移场景时，先在测试环境验证，必要时咨询团队成员。数据库迁移无小事，谨慎为上！
