# ozon_product_sync_errors

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/products.py`
- **模型类**: `OzonProductSyncError`
- **用途**: Ozon 商品错误记录（OZON平台返回的商品错误信息）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | 店铺ID |
| product_id | BigInteger | YES | - | FK → ozon_products.id | 关联的商品ID |
| offer_id | String(100) | NO | - | 商品 offer_id |
| task_id | BigInteger | YES | - | OZON 任务ID |
| status | String(50) | YES | - | 同步状态 |
| errors | JSONB | YES | - | 错误详情数组 |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_product_sync_errors_composite` (shop_id, product_id, created_at)

## 外键关系

- `product_id` → `ozon_products.id`
