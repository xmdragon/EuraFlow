# cloudinary_configs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/watermark.py`
- **模型类**: `CloudinaryConfig`
- **用途**: Cloudinary配置模型（加密存储凭证）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 配置ID |
| cloud_name | String(100) | NO | - | Cloud Name |
| api_key | String(100) | NO | - | API Key |
| api_secret_encrypted | Text | NO | - | 加密的API Secret |
| product_images_folder | String(100) | NO | 'products' | 商品图片文件夹路径 |
| product_videos_folder | String(100) | NO | 'videos' | 商品视频文件夹路径 |
| watermark_images_folder | String(100) | NO | 'watermarks' | 水印图片文件夹路径 |
| auto_cleanup_days | Integer | NO | 30 | 自动清理天数 |
| last_quota_check | DateTime | YES | - | 最后配额检查时间 |
| storage_used_bytes | BigInteger | YES | - | 已使用存储(字节) |
| bandwidth_used_bytes | BigInteger | YES | - | 已使用带宽(字节) |
| is_active | Boolean | NO | True | 是否激活 |
| is_default | Boolean | NO | False | 是否作为默认图床 |
| last_test_at | DateTime | YES | - | 最后测试连接时间 |
| last_test_success | Boolean | YES | - | 最后测试是否成功 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
