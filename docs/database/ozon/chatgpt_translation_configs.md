# chatgpt_translation_configs

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/chatgpt_translation.py`
- **模型类**: `ChatGPTTranslationConfig`
- **用途**: ChatGPT翻译配置表（单例模式，只有一条记录）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | 主键（固定为1） |
| api_key_encrypted | Text | YES | - | 加密的 OpenAI API Key (TODO: 实现加密) |
| base_url | String(255) | YES | - | API Base URL（可选，默认为官方地址） |
| model_name | String(100) | NO | - | 模型名称（默认 gpt-5-mini） |
| system_prompt | Text | NO | server: text() | System Prompt（翻译规则） |
| enabled | Boolean | NO | - | 是否启用 |
| is_default | Boolean | NO | - | 是否为默认翻译引擎 |
| last_test_at | DateTime | YES | - | 最后测试连接时间 |
| last_test_success | Boolean | YES | - | 最后测试是否成功 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
