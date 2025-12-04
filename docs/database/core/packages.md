# packages

## 基本信息

- **模型文件**: `ef_core/models/shipments.py`
- **模型类**: `Package`
- **用途**: 包裹信息表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shipment_id | BigInteger | NO | - | FK → shipments.id | 关联发运ID |
| weight_kg | CheckConstraint(weight_kg >= 0) | YES | - | 重量（公斤） |
| dim_l_cm | CheckConstraint(dim_l_cm > 0) | YES | - | 长度（厘米） |
| dim_w_cm | CheckConstraint(dim_w_cm > 0) | YES | - | 宽度（厘米） |
| dim_h_cm | CheckConstraint(dim_h_cm > 0) | YES | - | 高度（厘米） |

## 索引

- `ix_packages_shipment` (shipment_id)

## 外键关系

- `shipment_id` → `shipments.id`
