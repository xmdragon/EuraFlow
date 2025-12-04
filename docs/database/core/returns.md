# returns

## 基本信息

- **模型文件**: `ef_core/models/returns.py`
- **模型类**: `Return`
- **用途**: 退货表（只读）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| platform | Text | NO | - | 平台标识 |
| shop_id | BigInteger | NO | - | 店铺ID |
| external_id | Text | NO | - | 平台退货ID |
| order_external_id | Text | NO | - | 关联订单外部ID |
| reason_code | Text | YES | - | 退货原因代码 |
| status | Text | YES | - | 退货状态 |
| created_at | DateTime | NO | - | 退货创建时间 |
| updated_at | DateTime | NO | - | 退货更新时间 |
