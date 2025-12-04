# ozon_price_update_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonPriceUpdateLog`
- **用途**: OZON价格更新日志表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| offer_id | String(100) | NO | - | - |
| currency_code | String(10) | YES | 'RUB' | - |
| price | Numeric(18, 4) | NO | - | - |
| old_price | Numeric(18, 4) | YES | - | - |
| min_price | Numeric(18, 4) | YES | - | - |
| auto_action_enabled | Boolean | YES | False | - |
| price_strategy_enabled | Boolean | YES | False | - |
| state | String(50) | YES | 'pending' | pending/accepted/failed |
| error_message | Text | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_price_logs_offer` (shop_id, offer_id, created_at)
- `idx_ozon_price_logs_state` (state, created_at)
