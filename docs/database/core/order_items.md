# order_items

## 基本信息

- **模型文件**: `ef_core/models/orders.py`
- **模型类**: `OrderItem`
- **用途**: 订单行项目表 - 按照 PRD § 3.2

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| order_id | BigInteger | NO | - | FK → orders.id | 关联订单ID |
| sku | Text | NO | - | 商品SKU |
| offer_id | Text | YES | - | Ozon offer_id |
| qty | CheckConstraint(qty > 0) | NO | - | 数量 |
| price_rub | CheckConstraint(price_rub >= 0) | NO | - | 单价（卢布） |

## 索引

- `ix_order_items_order` (order_id)
- `ix_order_items_sku` (sku)

## 外键关系

- `order_id` → `orders.id`
