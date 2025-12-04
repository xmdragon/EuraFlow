# audit_logs_archive

## 基本信息

- **模型文件**: `ef_core/models/audit_log.py`
- **模型类**: `AuditLogArchive`
- **用途**: 审计日志归档表

用于存储超过6个月的历史日志
结构与 audit_logs 完全相同

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| user_id | Integer | NO | - | - |
| username | String(100) | NO | - | - |
| module | String(50) | NO | - | - |
| action | String(50) | NO | - | - |
| action_display | String(100) | YES | - | - |
| table_name | String(100) | NO | - | - |
| record_id | String(100) | NO | - | - |
| changes | JSONB | YES | - | - |
| ip_address | INET | YES | - | - |
| user_agent | String(500) | YES | - | - |
| request_id | String(100) | YES | - | - |
| notes | Text | YES | - | - |
| created_at | DateTime | NO | - | - |

## 索引

- `idx_audit_logs_archive_time` (created_at)
- `idx_audit_logs_archive_record` (table_name, record_id)
