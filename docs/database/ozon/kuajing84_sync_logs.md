# kuajing84_sync_logs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/kuajing84.py`
- **模型类**: `Kuajing84SyncLog`
- **用途**: 跨境巴士同步日志表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 主键ID |
| ozon_order_id | BigInteger | NO | - | FK → ozon_orders.id | OZON订单ID |
| shop_id | Integer | NO | - | 店铺ID |
| order_number | String(100) | NO | - | 订单号 |
| logistics_order | String(100) | NO | - | 国内物流单号 |
| kuajing84_oid | String(100) | YES | - | 跨境巴士订单OID |
| sync_type | String(20) | NO | - | 同步类型: submit_tracking/discard_order |
| posting_id | BigInteger | YES | - | FK → ozon_postings.id | 货件ID（关联ozon_postings表） |
| sync_status | String(20) | NO | - | 同步状态: pending/in_progress/success/failed |
| error_message | Text | YES | - | 错误信息 |
| attempts | Integer | NO | - | 尝试次数 |
| created_at | DateTime | NO | - | 创建时间 |
| started_at | DateTime | YES | - | 开始同步时间 |
| synced_at | DateTime | YES | - | 同步成功时间 |

## 索引

- `ix_kuajing84_sync_logs_order_id` (ozon_order_id)
- `ix_kuajing84_sync_logs_status` (shop_id, sync_status)
- `ix_kuajing84_sync_logs_order_number` (order_number)
- `ix_kuajing84_sync_logs_posting_id` (posting_id)

## 外键关系

- `ozon_order_id` → `ozon_orders.id`
- `posting_id` → `ozon_postings.id`
