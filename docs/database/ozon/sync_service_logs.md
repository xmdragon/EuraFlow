# sync_service_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/sync_service.py`
- **模型类**: `SyncServiceLog`
- **用途**: 同步服务执行日志表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| service_key | String(100) | NO | - | 服务标识 |
| run_id | String(100) | NO | - | 运行批次ID |
| started_at | DateTime | NO | - | 开始时间 |
| finished_at | DateTime | YES | - | 完成时间 |
| status | String(20) | NO | - | 运行状态: success/failed |
| records_processed | Integer | YES | 0 | 处理记录数 |
| records_updated | Integer | YES | 0 | 更新记录数 |
| execution_time_ms | Integer | YES | - | 执行耗时（毫秒） |
| error_message | Text | YES | - | 错误详情 |
| error_stack | Text | YES | - | 错误堆栈 |
| extra_data | JSONB | YES | - | 附加元数据 |

## 索引

- `idx_sync_logs_service` (service_key, started_at)
- `idx_sync_logs_status` (status, started_at)
- `idx_sync_logs_run_id` (run_id)
