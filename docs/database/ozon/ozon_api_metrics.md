# ozon_api_metrics

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/sync.py`
- **模型类**: `OzonApiMetrics`
- **用途**: API 调用指标

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| endpoint | String(200) | NO | - | - |
| method | String(10) | NO | - | - |
| request_id | String(100) | YES | - | - |
| correlation_id | String(100) | YES | - | - |
| status_code | Integer | YES | - | - |
| response_time_ms | Integer | YES | - | - |
| is_error | Boolean | YES | False | - |
| error_code | String(100) | YES | - | - |
| error_message | String(500) | YES | - | - |
| is_rate_limited | Boolean | YES | False | - |
| retry_after | Integer | YES | - | - |
| requested_at | DateTime | NO | - | - |

## 索引

- `idx_ozon_metrics_shop` (shop_id, requested_at)
- `idx_ozon_metrics_endpoint` (endpoint, status_code)
- `idx_ozon_metrics_errors` (is_error, error_code, requested_at)
