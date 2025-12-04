# ozon_refunds

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/orders.py`
- **模型类**: `OzonRefund`
- **用途**: 退款/退货记录

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| order_id | BigInteger | NO | - | FK → ozon_orders.id |
| shop_id | Integer | NO | - | - |
| refund_id | String(100) | NO | - | - |
| refund_type | String(50) | YES | - | - |
| posting_id | BigInteger | YES | - | FK → ozon_postings.id |
| refund_amount | Numeric(18, 4) | NO | - | - |
| commission_refund | Numeric(18, 4) | YES | - | - |
| refund_items | JSONB | YES | - | - |
| reason_id | Integer | YES | - | - |
| reason | String(500) | YES | - | - |
| customer_comment | String(1000) | YES | - | - |
| status | String(50) | YES | - | - |
| requested_at | DateTime | NO | - | - |
| approved_at | DateTime | YES | - | - |
| completed_at | DateTime | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_refunds_status` (shop_id, status)
- `idx_ozon_refunds_date` (shop_id, requested_at)

## 外键关系

- `order_id` → `ozon_orders.id`
- `posting_id` → `ozon_postings.id`
