# watermark_tasks

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/watermark.py`
- **模型类**: `WatermarkTask`
- **用途**: 水印任务模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | UUID | PK | - | 任务ID |
| shop_id | BigInteger | NO | - | FK → ozon_shops.id | 店铺ID |
| product_id | BigInteger | NO | - | FK → ozon_products.id | 商品ID |
| watermark_config_id | BigInteger | YES | - | FK → watermark_configs.id | 水印配置ID |
| task_type | String(20) | NO | - | 任务类型: apply(应用水印), restore(还原原图) |
| status | String(20) | NO | 'pending' | 任务状态: pending, processing, completed, failed, cancelled |
| original_images | JSON | YES | - | 原始图片URL备份 |
| processed_images | JSON | YES | - | 处理后图片URL |
| cloudinary_public_ids | JSON | YES | - | Cloudinary public_id列表(用于清理) |
| processing_metadata | JSON | YES | - | 处理详情(位置选择、参数等) |
| error_message | Text | YES | - | 错误信息 |
| retry_count | Integer | NO | 0 | 重试次数 |
| max_retries | Integer | NO | 3 | 最大重试次数 |
| batch_id | UUID | YES | - | 批次ID(用于批量操作) |
| batch_total | Integer | YES | - | 批次总数 |
| batch_position | Integer | YES | - | 批次中的位置 |
| processing_started_at | DateTime | YES | - | 处理开始时间 |
| completed_at | DateTime | YES | - | 完成时间 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `ix_watermark_task_processing` (shop_id, product_id, status)

## 外键关系

- `shop_id` → `ozon_shops.id`
- `product_id` → `ozon_products.id`
- `watermark_config_id` → `watermark_configs.id`
