# ozon_product_import_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonProductImportLog`
- **用途**: OZON商品导入日志表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| offer_id | String(100) | NO | - | - |
| import_mode | String(20) | YES | 'NEW_CARD' | NEW_CARD/FOLLOW_PDP |
| request_payload | JSONB | NO | - | - |
| task_id | String(100) | YES | - | - |
| response_payload | JSONB | YES | - | - |
| state | String(50) | YES | 'submitted' | submitted/processing/created/price_sent/failed |
| error_code | String(100) | YES | - | - |
| error_message | Text | YES | - | - |
| errors | JSONB | YES | - | 详细错误列表 |
| ozon_product_id | BigInteger | YES | - | - |
| ozon_sku | BigInteger | YES | - | - |
| retry_count | Integer | YES | 0 | - |
| last_retry_at | DateTime | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_product_logs_offer` (shop_id, offer_id)
- `idx_ozon_product_logs_state` (state, created_at)
- `idx_ozon_product_logs_task` (task_id)
