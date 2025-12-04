# ozon_media_import_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonMediaImportLog`
- **用途**: OZON媒体导入日志表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| offer_id | String(100) | NO | - | - |
| source_url | Text | NO | - | Cloudinary URL |
| file_name | String(500) | YES | - | - |
| position | Integer | YES | 0 | 图片位置(0=主图) |
| ozon_file_id | String(100) | YES | - | - |
| ozon_url | Text | YES | - | - |
| task_id | String(100) | YES | - | - |
| state | String(50) | YES | 'pending' | pending/uploading/uploaded/failed |
| error_code | String(100) | YES | - | - |
| error_message | Text | YES | - | - |
| retry_count | Integer | YES | 0 | - |
| last_retry_at | DateTime | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_media_logs_offer` (shop_id, offer_id)
- `idx_ozon_media_logs_state` (state, created_at)
- `idx_ozon_media_logs_task` (task_id)
