# ozon_stock_update_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonStockUpdateLog`
- **用途**: OZON库存更新日志表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| offer_id | String(100) | NO | - | - |
| product_id | BigInteger | YES | - | - |
| warehouse_id | Integer | NO | - | - |
| stock | Integer | NO | - | - |
| state | String(50) | YES | 'pending' | pending/accepted/failed |
| error_message | Text | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_stock_logs_offer` (shop_id, offer_id, created_at)
- `idx_ozon_stock_logs_state` (state, created_at)
- `idx_ozon_stock_logs_warehouse` (warehouse_id, created_at)
