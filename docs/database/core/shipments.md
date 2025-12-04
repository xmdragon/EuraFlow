# shipments

## 基本信息

- **模型文件**: `ef_core/models/shipments.py`
- **模型类**: `Shipment`
- **用途**: 发运表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| order_id | BigInteger | NO | - | FK → orders.id | 关联订单ID |
| carrier_code | CheckConstraint(carrier_code IN ('CDEK','BOXBERRY','POCHTA')) | NO | - | 承运商代码 |
| tracking_no | Text | NO | - | 运单号 |
| pushed | Boolean | NO | False | 是否已回传到平台 |
| pushed_at | DateTime | YES | - | 回传时间 |
| push_receipt | JSONB | YES | - | 平台回传回执 |
| created_at | DateTime | NO | server: now() | 创建时间 |

## 索引

- `ix_shipments_order` (order_id)
- `ix_shipments_carrier` (carrier_code)
- `ix_shipments_pushed` (pushed, created_at)

## 唯一约束

- uq_shipments_tracking: (tracking_no)

## 外键关系

- `order_id` → `orders.id`
