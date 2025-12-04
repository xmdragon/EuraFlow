# aliyun_oss_configs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/watermark.py`
- **模型类**: `AliyunOssConfig`
- **用途**: 阿里云OSS配置模型（加密存储凭证）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | 配置ID（固定为1） |
| access_key_id | String(100) | YES | - | 阿里云AccessKey ID |
| access_key_secret_encrypted | Text | YES | - | 加密的AccessKey Secret (TODO: 实现加密) |
| bucket_name | String(100) | NO | - | OSS Bucket名称 |
| endpoint | String(255) | NO | - | OSS Endpoint地址 |
| region_id | String(50) | NO | - | 阿里云区域ID |
| product_images_folder | String(100) | NO | 'products' | 商品图片文件夹路径 |
| product_videos_folder | String(100) | NO | 'videos' | 商品视频文件夹路径 |
| watermark_images_folder | String(100) | NO | 'watermarks' | 水印图片文件夹路径 |
| is_default | Boolean | NO | False | 是否作为默认图床 |
| enabled | Boolean | NO | - | 是否启用 |
| last_test_at | DateTime | YES | - | 最后测试连接时间 |
| last_test_success | Boolean | YES | - | 最后测试是否成功 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
