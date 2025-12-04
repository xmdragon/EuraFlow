# audit_logs

## 基本信息

- **模型文件**: `ef_core/models/audit_log.py`
- **模型类**: `AuditLog`
- **用途**: 全局审计日志表

用于记录用户的数据修改操作，包括：
- 打印标签
- 价格修改
- 订单操作
- 数据删除
等

设计原则：
1. 全系统统一日志格式
2. 支持字段级变更追踪
3. 记录请求上下文（IP、User Agent、Trace ID）
4. 支持定期归档

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| user_id | Integer | NO | - | 用户ID |
| username | String(100) | NO | - | 用户名 |
| module | String(50) | NO | - | 模块名（ozon/finance/user/system） |
| action | String(50) | NO | - | 操作类型（create/update/delete/print） |
| action_display | String(100) | YES | - | 操作显示名称（打印标签/修改价格/删除商品） |
| table_name | String(100) | NO | - | 表名 |
| record_id | String(100) | NO | - | 记录ID（posting_number或主键ID） |
| changes | JSONB | YES | - | 变更详情（字段级） |
| ip_address | INET | YES | - | 客户端IP地址 |
| user_agent | String(500) | YES | - | User Agent |
| request_id | String(100) | YES | - | 请求ID（trace_id用于追踪） |
| notes | Text | YES | - | 备注信息 |
| created_at | DateTime | NO | utcnow | 创建时间 |

## 索引

- `idx_audit_logs_user_time` (user_id, created_at)
- `idx_audit_logs_module_time` (module, created_at)
- `idx_audit_logs_action_time` (action, created_at)
- `idx_audit_logs_record_lookup` (table_name, record_id)
