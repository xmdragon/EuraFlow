# aliyun_translation_configs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/translation.py`
- **模型类**: `AliyunTranslationConfig`
- **用途**: 阿里云翻译配置表（单例模式，只有一条记录）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | 主键（固定为1） |
| access_key_id | String(100) | YES | - | 阿里云AccessKey ID |
| access_key_secret_encrypted | Text | YES | - | 加密的AccessKey Secret (TODO: 实现加密) |
| region_id | String(50) | NO | - | 阿里云区域ID |
| enabled | Boolean | NO | - | 是否启用 |
| is_default | Boolean | NO | - | 是否为默认翻译引擎 |
| last_test_at | DateTime | YES | - | 最后测试连接时间 |
| last_test_success | Boolean | YES | - | 最后测试是否成功 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
