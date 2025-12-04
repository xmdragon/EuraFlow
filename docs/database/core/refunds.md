# refunds

## 基本信息

- **模型文件**: `ef_core/models/returns.py`
- **模型类**: `Refund`
- **用途**: 退款表（只读）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| platform | Text | NO | - | 平台标识 |
| shop_id | BigInteger | NO | - | 店铺ID |
| order_external_id | Text | NO | - | 关联订单外部ID |
| amount_rub | CheckConstraint(amount_rub >= 0) | NO | - | 退款金额（卢布） |
| created_at | DateTime | NO | - | 退款创建时间 |
