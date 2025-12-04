# ozon_global_settings

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/global_settings.py`
- **模型类**: `OzonGlobalSetting`
- **用途**: Ozon全局设置模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Unknown | PK | - | 设置ID |
| setting_key | String(100) | NO | - | 设置键（如：api_rate_limit） |
| setting_value | JSONB | NO | - | 设置值（JSONB格式） |
| description | String(500) | YES | - | 设置描述 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `idx_ozon_global_settings_key` (setting_key)
