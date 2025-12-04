# ozon_sync_checkpoints

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/sync.py`
- **模型类**: `OzonSyncCheckpoint`
- **用途**: 同步检查点（断点续传）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| entity_type | String(50) | NO | - | - |
| last_cursor | String(500) | YES | - | - |
| last_sync_at | DateTime | YES | - | - |
| last_modified_at | DateTime | YES | - | - |
| status | String(50) | YES | 'idle' | - |
| error_message | String(5000) | YES | - | - |
| retry_count | Integer | YES | 0 | - |
| total_processed | BigInteger | YES | 0 | - |
| total_success | BigInteger | YES | 0 | - |
| total_failed | BigInteger | YES | 0 | - |
| config | JSONB | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_checkpoint_status` (status, last_sync_at)

## 唯一约束

- uq_ozon_checkpoint: (shop_id, entity_type)
