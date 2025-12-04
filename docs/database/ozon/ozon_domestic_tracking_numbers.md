# ozon_domestic_tracking_numbers

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/orders.py`
- **模型类**: `OzonDomesticTracking`
- **用途**: 国内物流单号表（一对多关系）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| posting_id | BigInteger | NO | - | FK → ozon_postings.id |
| tracking_number | String(200) | NO | - | 国内物流单号 |
| created_at | DateTime | YES | utcnow | 创建时间 |

## 索引

- `idx_domestic_tracking_number` (tracking_number)
- `idx_domestic_posting_id` (posting_id)

## 唯一约束

- uq_posting_tracking: (posting_id, tracking_number)

## 外键关系

- `posting_id` → `ozon_postings.id`
