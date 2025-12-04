# ozon_product_collection_records

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/collection_record.py`
- **模型类**: `OzonProductCollectionRecord`
- **用途**: OZON 商品采集记录表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| user_id | Integer | NO | - | FK → users.id | 创建用户ID |
| shop_id | Integer | YES | - | FK → ozon_shops.id | 店铺ID（可选） |
| collection_type | String(20) | NO | - | 采集类型：follow_pdp（跟卖上架）| collect_only（仅采集） |
| source_url | Text | NO | - | 商品来源URL（OZON商品详情页） |
| source_product_id | String(100) | YES | - | 来源商品ID（OZON商品ID） |
| product_data | JSONB | NO | - | 完整商品数据（标题、图片、尺寸、重量、变体等） |
| listing_request_payload | JSONB | YES | - | 发送给 OZON API 的上架请求数据 |
| listing_task_id | String(500) | YES | - | Celery 任务 ID（多变体时逗号分隔） |
| listing_status | String(50) | YES | - | 上架状态：pending | processing | success | failed |
| listing_product_id | BigInteger | YES | - | 上架成功后关联的正式商品ID（ozon_products.id） |
| listing_error_message | Text | YES | - | 上架失败的错误信息 |
| listing_at | DateTime | YES | - | 上架时间（UTC） |
| is_read | Boolean | NO | False | 是否已读 |
| is_deleted | Boolean | NO | False | 是否软删除 |
| last_edited_at | DateTime | YES | - | 最后编辑时间（UTC） |
| last_edited_by | Integer | YES | - | FK → users.id | 最后编辑用户ID |
| created_at | DateTime | NO | utcnow | 创建时间（UTC） |
| updated_at | DateTime | NO | utcnow | 更新时间（UTC） |

## 索引

- `idx_collection_user` (user_id, created_at)
- `idx_collection_type_status` (collection_type, listing_status)
- `idx_collection_shop` (shop_id)
- `idx_collection_not_deleted` (user_id, collection_type)

## 外键关系

- `user_id` → `users.id`
- `shop_id` → `ozon_shops.id`
- `last_edited_by` → `users.id`
