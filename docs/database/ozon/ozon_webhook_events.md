# ozon_webhook_events

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/sync.py`
- **模型类**: `OzonWebhookEvent`
- **用途**: Webhook 事件记录

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| event_id | String(200) | NO | - | - |
| event_type | String(100) | NO | - | - |
| shop_id | Integer | NO | - | - |
| payload | JSONB | NO | - | - |
| headers | JSONB | YES | - | - |
| signature | String(500) | YES | - | - |
| is_verified | Boolean | YES | False | - |
| status | String(50) | YES | 'pending' | - |
| processed_at | DateTime | YES | - | - |
| retry_count | Integer | YES | 0 | - |
| idempotency_key | String(200) | YES | - | - |
| error_message | String(1000) | YES | - | - |
| result_message | String(500) | YES | - | - |
| processing_duration_ms | Integer | YES | - | - |
| entity_type | String(50) | YES | - | - |
| entity_id | String(100) | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_webhook_status` (status, created_at)
- `idx_ozon_webhook_shop` (shop_id, event_type, created_at)
- `idx_ozon_webhook_idempotency` (idempotency_key)
- `idx_ozon_webhook_entity` (entity_type, entity_id)
