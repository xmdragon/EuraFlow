# ozon_outbox_events

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/sync.py`
- **模型类**: `OzonOutboxEvent`
- **用途**: Outbox 模式事件表（保证分布式事务）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| event_id | String(100) | NO | - | - |
| event_type | String(100) | NO | - | - |
| aggregate_type | String(50) | NO | - | - |
| aggregate_id | String(100) | NO | - | - |
| event_data | JSONB | NO | - | - |
| status | String(50) | YES | 'pending' | - |
| sent_at | DateTime | YES | - | - |
| retry_count | Integer | YES | 0 | - |
| next_retry_at | DateTime | YES | - | - |
| error_message | String(1000) | YES | - | - |
| created_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_outbox_status` (status, next_retry_at)
- `idx_ozon_outbox_aggregate` (aggregate_type, aggregate_id)
