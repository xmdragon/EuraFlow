# ozon_invoice_payments

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/finance.py`
- **模型类**: `OzonInvoicePayment`
- **用途**: OZON 账单付款记录

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | FK → ozon_shops.id |
| payment_type | String(100) | NO | - | 付款类型 |
| amount_cny | Numeric(18, 4) | NO | - | 金额(CNY) |
| payment_status | String(50) | NO | - | 付款状态: waiting/paid |
| scheduled_payment_date | Date | NO | - | 计划付款日期 |
| actual_payment_date | Date | YES | - | 实际付款日期 |
| period_start | Date | NO | - | 周期开始日期 |
| period_end | Date | NO | - | 周期结束日期 |
| payment_method | String(100) | YES | - | 支付方式 |
| payment_file_number | String(100) | YES | - | 付款文件编号 |
| period_text | String(100) | YES | - | 原始周期文本 |
| raw_data | JSONB | YES | - | 原始数据 |
| created_at | DateTime | YES | utcnow | 记录创建时间 |
| updated_at | DateTime | YES | utcnow | 记录更新时间 |

## 索引

- `idx_ozon_invoice_payment_shop_period` (shop_id, period_start, period_end)

## 唯一约束

- uq_ozon_invoice_payment: (shop_id, scheduled_payment_date, amount_cny)

## 外键关系

- `shop_id` → `ozon_shops.id`
