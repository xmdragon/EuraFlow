# ozon_promotion_products

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/promotion.py`
- **模型类**: `OzonPromotionProduct`
- **用途**: 商品活动关联表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| action_id | BigInteger | NO | - | 关联的活动ID |
| product_id | BigInteger | YES | - | FK → ozon_products.id | 本地商品ID |
| ozon_product_id | BigInteger | YES | - | OZON商品ID |
| status | String(50) | NO | 'candidate' | 状态: candidate候选/active参与中/deactivated已取消 |
| promotion_price | Numeric(18, 4) | YES | - | 促销价格 |
| promotion_stock | Integer | YES | - | 促销库存 |
| add_mode | String(50) | NO | 'automatic' | 加入方式: manual手动/automatic自动 |
| activated_at | DateTime | YES | - | 参与时间 |
| deactivated_at | DateTime | YES | - | 取消时间 |
| last_sync_at | DateTime | YES | - | 最后同步时间 |
| created_at | DateTime | NO | utcnow | - |
| updated_at | DateTime | NO | utcnow | - |
| raw_data | JSONB | YES | - | OZON API返回的原始数据 |

## 索引

- `idx_ozon_promotion_products_shop_action_status` (shop_id, action_id, status)
- `idx_ozon_promotion_products_shop_action_mode` (shop_id, action_id, add_mode)
- `idx_ozon_promotion_products_product` (product_id)
- `idx_ozon_promotion_products_ozon_product` (ozon_product_id)

## 唯一约束

- uq_ozon_promotion_products_shop_action_product: (shop_id, action_id, product_id)

## 外键关系

- `product_id` → `ozon_products.id`
