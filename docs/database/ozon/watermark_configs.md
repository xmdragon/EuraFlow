# watermark_configs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/watermark.py`
- **模型类**: `WatermarkConfig`
- **用途**: 水印配置模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 配置ID |
| shop_id | BigInteger | YES | - | FK → ozon_shops.id | 店铺ID（全局配置可为空） |
| name | String(100) | NO | - | 水印名称 |
| storage_provider | String(20) | NO | - | 图床类型：cloudinary/aliyun_oss |
| cloudinary_public_id | Text | NO | - | Cloudinary中的public_id |
| image_url | Text | NO | - | 水印图片URL |
| scale_ratio | Numeric(5, 3) | NO | - | 水印缩放比例 |
| opacity | Numeric(3, 2) | NO | - | 水印透明度 |
| margin_pixels | Integer | NO | 10 | 水印边距(像素) |
| positions | JSON | YES | - | 允许的水印位置 |
| is_active | Boolean | NO | True | 是否激活 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 外键关系

- `shop_id` → `ozon_shops.id`
