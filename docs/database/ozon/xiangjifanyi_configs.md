# xiangjifanyi_configs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/xiangjifanyi.py`
- **模型类**: `XiangjifanyiConfig`
- **用途**: 象寄图片翻译配置表（单例模式，只有一条记录）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | 主键（固定为1） |
| phone | String(20) | YES | - | 手机号 |
| password | Text | YES | - | 密码 (TODO: 实现加密) |
| api_url | String(255) | YES | - | API地址 |
| user_key | Text | YES | - | 私人密钥 (TODO: 实现加密) |
| video_trans_key | Text | YES | - | 视频翻译密钥 (TODO: 实现加密) |
| fetch_key | Text | YES | - | 商品解析密钥 (TODO: 实现加密) |
| img_trans_key_ali | Text | YES | - | 图片翻译-阿里标识码 (TODO: 实现加密) |
| img_trans_key_google | Text | YES | - | 图片翻译-谷歌标识码 (TODO: 实现加密) |
| img_trans_key_papago | Text | YES | - | 图片翻译-Papago标识码 (TODO: 实现加密) |
| img_trans_key_deepl | Text | YES | - | 图片翻译-DeepL标识码 (TODO: 实现加密) |
| img_trans_key_chatgpt | Text | YES | - | 图片翻译-ChatGPT标识码 (TODO: 实现加密) |
| img_trans_key_baidu | Text | YES | - | 图片翻译-百度标识码 (TODO: 实现加密) |
| img_matting_key | Text | YES | - | 智能抠图密钥 (TODO: 实现加密) |
| text_trans_key | Text | YES | - | 文本翻译密钥 (TODO: 实现加密) |
| aigc_key | Text | YES | - | 智能生成密钥 (TODO: 实现加密) |
| enabled | Boolean | NO | - | 是否启用 |
| last_test_at | DateTime | YES | - | 最后测试连接时间 |
| last_test_success | Boolean | YES | - | 最后测试是否成功 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
