# 数据库迁移历史

本文档记录 EuraFlow 项目的数据库迁移历史，帮助理解数据库结构的演进过程。

## 📖 目录

- [迁移概览](#迁移概览)
- [按模块分类](#按模块分类)
- [重要迁移说明](#重要迁移说明)
- [碎片化迁移](#碎片化迁移)
- [迁移最佳实践](#迁移最佳实践)

---

## 📊 迁移概览

**当前 HEAD**: `6638e9d71116` - make_old_order_columns_nullable
**总迁移数**: 37
**最后更新**: 2025-10-09

---

## 🗂️ 按模块分类

### 1. 用户和店铺管理

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-09-08 | 156bb55c528c | 添加用户和店铺表 |
| 2025-09-08 | create_users_and_shops | 创建用户和店铺 |
| 2025-09-09 | fd489cf3cb5a | 添加 Ozon 店铺表 |
| 2025-09-29 | 37613747626c | 添加父用户ID支持多账号 |
| 2025-09-29 | fcd1c4e45967 | 使邮箱可选，用户名必填 |

### 2. OZON 商品管理

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-09-09 | feb576aa7ef5 | 添加 OzonProduct 模型 |
| 2025-09-16 | add_ozon_status_fields | 添加 Ozon 状态字段 |
| 2025-09-17 | 1a9612704fdc | 添加 ozon_created_at 到商品 |
| 2025-09-19 | 948ce22fbbbf | 更新商品状态为五种类型 |
| 2025-10-09 | 97f3b8a541f8 | ⚠️ 添加 currency_code 字段 |
| 2025-10-09 | 7998fa3aaf46 | ⚠️ 添加 raw_payload 字段 |
| 2025-10-09 | b836f9067483 | ⚠️ 添加 ozon_created_at 字段 |
| 2025-10-09 | 2deb27629242 | ⚠️ 添加缺失字段 |

> ⚠️ **注意**: 10月9日的这4个迁移都是对 `ozon_products` 表的修改，应该合并为一个迁移。

### 3. OZON 订单管理

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-09-09 | fe44b4ac0e75 | 创建 Ozon 表 |
| 2025-09-09 | b89c2a4e8abc | 添加 OzonOrder 模型 |
| 2025-09-09 | 609304c8d92c | 增加配送类型字段长度 |
| 2025-09-18 | 14b2ff89f856 | 使订单总价可空 |
| 2025-09-19 | b043d17754d5 | 添加缺失的订单字段 |
| 2025-09-20 | ad51b98f55da | 添加订单报表字段 |
| 2025-10-08 | d7cdcefb56b3 | 添加 ozon_order_id 和 order_number |
| 2025-10-09 | 1ddb8227d228 | 添加 ozon_status 字段 |
| 2025-10-09 | b74b49cec77f | 添加缺失字段 |
| 2025-10-09 | ec9f36ac48db | 创建订单相关表 |
| 2025-10-09 | 6638e9d71116 | 使旧订单列可空 |

### 4. OZON 聊天管理

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-10-09 | cae89191f288 | 添加 Ozon 聊天表 |

### 5. 选品助手

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-09-26 | 8649280daab1 | 添加选品表 |
| 2025-09-26 | 2f69b2da1c54 | 添加竞争对手字段 |
| 2025-09-26 | 43a58fab5db1 | 添加图片数据 |
| 2025-09-28 | f80dfc685db5 | 移除竞争对手数据 |
| 2025-09-29 | ee5dc97e18d9 | 移除商品ID唯一约束 |
| 2025-09-29 | a9519ef9136d | 添加 user_id |

### 6. 水印管理

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-01-24 | add_watermark_tables | 添加水印表 |
| 2025-01-24 | update_cloudinary_global_config | 更新 Cloudinary 全局配置 |
| 2025-09-24 | make_watermark_shop_optional | 使水印店铺可选 |

### 7. API 密钥管理

| 日期 | 迁移ID | 描述 |
|------|--------|------|
| 2025-10-01 | add_api_keys_table | 添加 API 密钥表 |

### 8. DateTime Timezone 修复

| 日期 | 迁移ID | 描述 | 说明 |
|------|--------|------|------|
| 2025-10-09 | bc94f8c80f6a | 转换 DateTime 列为 timezone-aware | 仅处理 ozon_products 表 |
| 2025-10-09 | e199c93e7d25 | 转换 DateTime 列为 timezone-aware | ✅ 完整版，处理所有表 |

> 📝 **说明**: 第一个迁移只处理了 ozon_products 表，第二个是完整版本，处理了所有表（orders, postings, chats等）。

---

## ⚠️ 重要迁移说明

### DateTime Timezone 修复（2025-10-09）

**背景**: 修复 "can't subtract offset-naive and offset-aware datetimes" 错误

**迁移**:
- `bc94f8c80f6a`: 仅转换 ozon_products 表的4个 DateTime 列
- `e199c93e7d25`: 转换所有表的 DateTime 列（orders, postings, chats, product_selection 等）

**影响**:
- 所有 DateTime 列从 `TIMESTAMP` 改为 `TIMESTAMP WITH TIME ZONE`
- 总计修改了 54+ 个列

### 订单列可空修复（2025-10-09）

**迁移**: `6638e9d71116`

**背景**: 解决旧列与新模型定义不一致的问题

**修改**:
- `order_number` → nullable (已改为使用 `ozon_order_number`)
- `posting_number` → nullable (已改为使用 `order_id`)
- `delivery_type` → nullable (已改为使用 `order_type`)
- `total_price`, `status`, `sync_status` → nullable

---

## 📦 碎片化迁移

以下迁移是"碎片化"的，即对同一张表的多次小修改，理想情况下应该合并为一个迁移。

### OZON Products 碎片化迁移（2025-10-09）

这4个迁移都是对 `ozon_products` 表的修改：

| 时间 | 迁移ID | 添加的字段 |
|------|--------|-----------|
| 16:56 | 97f3b8a541f8 | `currency_code` (VARCHAR 10) |
| 17:44 | 7998fa3aaf46 | `raw_payload` (JSONB) |
| 17:58 | b836f9067483 | `ozon_created_at` (TIMESTAMPTZ) |
| 18:34 | 2deb27629242 | 多个缺失字段 |

**建议**: 未来对同一张表的多个字段修改应该在开发完成后一次性创建迁移，而不是每添加一个字段就创建一个迁移。

### OZON Orders 碎片化迁移（2025-10-09）

| 时间 | 迁移ID | 修改内容 |
|------|--------|----------|
| 16:02 | 1ddb8227d228 | 添加 `ozon_status` 字段 |
| 16:16 | b74b49cec77f | 添加缺失字段 |
| 16:38 | ec9f36ac48db | 创建订单相关表 |

**说明**: 这些迁移在不同时间处理了订单表结构的不同方面，虽然是同一天，但涉及不同的功能需求。

---

## 📚 迁移最佳实践

### ✅ 推荐做法

1. **批量修改合并**
   ```bash
   # 开发完一个功能后，一次性创建迁移
   # 不要每添加一个字段就创建一个迁移
   alembic revision --autogenerate -m "add_feature_x_fields"
   ```

2. **清晰的命名**
   - ✅ `add_currency_and_payload_to_products`
   - ❌ `update_products`
   - ✅ `convert_datetime_columns_to_timezone_aware`
   - ❌ `fix_datetime`

3. **添加详细注释**
   ```python
   """add_currency_and_payload_to_products

   Revision ID: abc123
   Revises: def456
   Create Date: 2025-10-09 16:00:00

   添加商品货币代码和原始数据字段：
   - currency_code: 存储商品货币（CNY/RUB/USD等）
   - raw_payload: 存储OZON API返回的原始JSON数据
   """
   ```

4. **测试迁移**
   ```bash
   # 升级测试
   alembic upgrade head

   # 降级测试
   alembic downgrade -1
   alembic upgrade head
   ```

### ❌ 避免的做法

1. **不要频繁创建小迁移**
   - 同一张表的多个字段修改应该合并

2. **不要修改已运行的迁移**
   - 已经在生产环境运行的迁移文件不能修改

3. **不要删除已运行的迁移**
   - 会导致数据库状态不一致

4. **不要使用模糊的命名**
   - 迁移名称应该清晰说明做了什么

### 🔄 迁移工作流

```
开发 → 测试 → 创建迁移 → 审查 → 提交 → 部署
```

1. **开发阶段**: 修改模型，完成功能
2. **测试阶段**: 确保所有修改都经过测试
3. **创建迁移**: `alembic revision --autogenerate -m "描述"`
4. **审查迁移**: 检查生成的迁移文件是否正确
5. **测试迁移**: 测试 upgrade 和 downgrade
6. **提交代码**: 将迁移文件提交到 Git
7. **部署生产**: `alembic upgrade head`

---

## 🔍 查看迁移历史

```bash
# 查看当前版本
alembic current

# 查看迁移历史
alembic history

# 查看详细历史
alembic history --verbose

# 查看从某个版本到现在的迁移
alembic history -r abc123:head
```

---

## 📝 相关文档

- [Alembic 官方文档](https://alembic.sqlalchemy.org/)
- [数据库迁移指南](../docs/database_migration_guide.md)
- [CLAUDE.md - 开发助手角色](../CLAUDE.md)

---

**最后更新**: 2025-10-09
**维护者**: EuraFlow 开发团队
