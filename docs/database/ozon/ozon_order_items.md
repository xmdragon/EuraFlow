# ozon_order_items

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/orders.py`
- **模型类**: `OzonOrderItem`
- **用途**: 订单商品明细

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| order_id | BigInteger | NO | - | FK → ozon_orders.id |
| offer_id | String(100) | NO | - | - |
| ozon_sku | BigInteger | YES | - | - |
| name | String(500) | YES | - | - |
| quantity | Integer | NO | - | - |
| price | Numeric(18, 4) | NO | - | - |
| discount | Numeric(18, 4) | YES | - | - |
| total_amount | Numeric(18, 4) | NO | - | - |
| status | String(50) | YES | - | - |
| created_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_order_items_offer_id` (offer_id)
- `idx_ozon_order_items_order` (order_id, status)

## 外键关系

- `order_id` → `ozon_orders.id`
