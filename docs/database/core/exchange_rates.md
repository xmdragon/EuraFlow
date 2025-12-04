# exchange_rates

## 基本信息

- **模型文件**: `ef_core/models/exchange_rate.py`
- **模型类**: `ExchangeRate`
- **用途**: 汇率缓存表 - 存储历史汇率数据

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | - |
| from_currency | String(3) | NO | - | 源货币 |
| to_currency | String(3) | NO | - | 目标货币 |
| rate | Numeric(18, 6) | NO | - | 汇率（6位小数精度） |
| fetched_at | DateTime | NO | - | 获取时间（UTC） |
| expires_at | DateTime | NO | - | 过期时间（24小时后） |
| source | String(50) | NO | 'exchangerate-api' | 数据来源 |
| created_at | DateTime | NO | - | 创建时间 |
| updated_at | DateTime | NO | - | 更新时间 |

## 索引

- `idx_exchange_rates_currency_time` (from_currency, to_currency, fetched_at)
