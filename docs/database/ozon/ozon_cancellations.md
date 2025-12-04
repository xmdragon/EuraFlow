# ozon_cancellations

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/cancel_return.py`
- **模型类**: `OzonCancellation`
- **用途**: OZON 取消申请表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | 店铺ID |
| posting_id | BigInteger | YES | - | FK → ozon_postings.id | 关联的货件ID |
| order_id | BigInteger | YES | - | FK → ozon_orders.id | 关联的订单ID |
| cancellation_id | BigInteger | NO | - | OZON取消申请ID |
| posting_number | String(100) | NO | - | 货件编号 |
| state | String(50) | NO | - | 状态：ALL/ON_APPROVAL/APPROVED/REJECTED |
| state_name | String(200) | YES | - | 状态名称 |
| cancellation_initiator | String(50) | YES | - | 发起人：CLIENT/SELLER/OZON/SYSTEM/DELIVERY |
| cancellation_reason_id | Integer | YES | - | 取消原因ID |
| cancellation_reason_name | String(500) | YES | - | 取消原因名称 |
| cancellation_reason_message | Text | YES | - | 取消备注（发起人填写） |
| approve_comment | Text | YES | - | 确认/拒绝备注 |
| approve_date | DateTime | YES | - | 确认/拒绝日期 |
| auto_approve_date | DateTime | YES | - | 自动确认日期 |
| order_date | DateTime | NO | - | 订单创建日期 |
| cancelled_at | DateTime | NO | - | 取消申请创建日期 |
| raw_payload | JSONB | YES | - | OZON原始数据 |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_cancellations_shop_state` (shop_id, state)
- `idx_ozon_cancellations_shop_date` (shop_id, cancelled_at)
- `idx_ozon_cancellations_posting` (posting_number)

## 唯一约束

- uq_ozon_cancellations_shop_id: (shop_id, cancellation_id)

## 外键关系

- `posting_id` → `ozon_postings.id`
- `order_id` → `ozon_orders.id`
