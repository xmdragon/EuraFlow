# ozon_sync_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/sync.py`
- **模型类**: `OzonSyncLog`
- **用途**: 同步日志

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| entity_type | String(50) | NO | - | - |
| sync_type | String(50) | YES | - | - |
| batch_id | String(100) | YES | - | - |
| batch_size | Integer | YES | - | - |
| status | String(50) | NO | - | - |
| processed_count | Integer | YES | 0 | - |
| success_count | Integer | YES | 0 | - |
| failed_count | Integer | YES | 0 | - |
| skipped_count | Integer | YES | 0 | - |
| error_message | String(2000) | YES | - | - |
| error_details | JSONB | YES | - | - |
| duration_ms | Integer | YES | - | - |
| api_calls | Integer | YES | - | - |
| rate_limit_hits | Integer | YES | 0 | - |
| started_at | DateTime | NO | - | - |
| completed_at | DateTime | YES | - | - |
| created_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_sync_log_shop` (shop_id, entity_type, started_at)
- `idx_ozon_sync_log_status` (status, started_at)
- `idx_ozon_sync_log_batch` (batch_id)
