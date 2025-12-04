# sync_services

## 基本信息

- **模型文件**: `plugins/ef/system/sync_service/models/sync_service.py`
- **模型类**: `SyncService`
- **用途**: 同步服务配置表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | - |
| service_key | String(100) | NO | - | 服务唯一标识 |
| service_name | String(200) | NO | - | 服务显示名称 |
| service_description | Text | YES | - | 服务功能说明 |
| service_type | String(20) | NO | 'interval' | 调度类型: cron定时 | interval周期 |
| schedule_config | String(200) | NO | - | 调度配置：cron表达式或间隔秒数 |
| is_enabled | Boolean | NO | True | 启用开关 |
| last_run_at | DateTime | YES | - | 最后运行时间 |
| last_run_status | String(20) | YES | - | 最后运行状态: success/failed/running |
| last_run_message | Text | YES | - | 最后运行日志摘要 |
| run_count | Integer | NO | 0 | 总运行次数 |
| success_count | Integer | NO | 0 | 成功次数 |
| error_count | Integer | NO | 0 | 失败次数 |
| config_json | JSONB | YES | - | 服务特定配置（如批次大小、超时时间） |
| created_at | DateTime | YES | utcnow | 创建时间 |
| updated_at | DateTime | YES | utcnow | 更新时间 |

## 索引

- `idx_sync_services_enabled` (is_enabled, service_type)
- `idx_sync_services_last_run` (last_run_at)
