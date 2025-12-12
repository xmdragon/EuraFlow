# account_levels

## 基本信息

- **模型文件**: `ef_core/models/account_level.py`
- **模型类**: `AccountLevel`
- **用途**: 主账号级别模型

用于定义不同级别的主账号配额限制，包括：
- 子账号数量限额
- 店铺数量限额
- 扩展配置（预留）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 级别ID |
| name | String(50) | NO | - | 级别名称（唯一标识） |
| alias | String(50) | YES | - | 级别别名（显示用） |
| max_sub_accounts | Integer | NO | 5 | 子账号数量限额 |
| max_shops | Integer | NO | 10 | 店铺数量限额 |
| default_expiration_days | Integer | NO | 30 | 默认过期周期（天数）：7/30/90/365/0 |
| extra_config | JSON | NO | dict | 扩展配置 |
| is_default | Boolean | NO | False | 是否为默认级别 |
| sort_order | Integer | NO | 0 | 排序顺序 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
