# ozon_finance_sync_watermarks

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/finance.py`
- **模型类**: `OzonFinanceSyncWatermark`
- **用途**: 财务数据同步水位线（记录同步进度）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | - |
| shop_id | Integer | NO | - | FK → ozon_shops.id |
| last_sync_date | DateTime | YES | - | 最后成功同步的日期（UTC） |
| sync_status | String(20) | YES | 'idle' | 同步状态: idle/running/failed |
| sync_error | Text | YES | - | 同步错误信息 |
| total_synced_count | Integer | YES | 0 | 总同步交易数 |
| last_sync_count | Integer | YES | 0 | 最后一次同步的交易数 |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_finance_watermark_shop` (shop_id)

## 外键关系

- `shop_id` → `ozon_shops.id`
