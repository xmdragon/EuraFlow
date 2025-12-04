# exchange_rate_config

## 基本信息

- **模型文件**: `ef_core/models/exchange_rate.py`
- **模型类**: `ExchangeRateConfig`
- **用途**: 汇率配置表 - 存储API密钥和配置

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | - |
| api_key | String(200) | NO | - | API密钥（加密存储） |
| api_provider | String(50) | NO | 'exchangerate-api' | 服务商 |
| is_enabled | Boolean | NO | True | 是否启用 |
| base_currency | String(3) | NO | 'CNY' | 基准货币 |
| created_at | DateTime | NO | - | 创建时间 |
| updated_at | DateTime | NO | - | 更新时间 |
