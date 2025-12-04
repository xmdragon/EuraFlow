# ozon_shipment_packages

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/orders.py`
- **模型类**: `OzonShipmentPackage`
- **用途**: 发货包裹信息

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| posting_id | BigInteger | NO | - | FK → ozon_postings.id |
| package_number | String(100) | NO | - | - |
| tracking_number | String(200) | YES | - | - |
| carrier_id | Integer | YES | - | - |
| carrier_name | String(200) | YES | - | - |
| carrier_code | String(50) | YES | - | - |
| weight | Numeric(10, 3) | YES | - | - |
| width | Numeric(10, 2) | YES | - | - |
| height | Numeric(10, 2) | YES | - | - |
| length | Numeric(10, 2) | YES | - | - |
| label_url | String(500) | YES | - | - |
| label_printed_at | DateTime | YES | - | - |
| status | String(50) | YES | - | - |
| status_updated_at | DateTime | YES | - | - |
| tracking_data | JSONB | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_packages_tracking` (tracking_number)

## 唯一约束

- uq_ozon_packages: (posting_id, package_number)

## 外键关系

- `posting_id` → `ozon_postings.id`
