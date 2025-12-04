# orders

## 基本信息

- **模型文件**: `ef_core/models/orders.py`
- **模型类**: `Order`
- **用途**: 订单表 - 严格按照 PRD 定义

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| platform | Text | NO | - | 平台标识 |
| shop_id | BigInteger | NO | - | 店铺ID |
| external_id | Text | NO | - | 外部平台订单ID |
| external_no | Text | NO | - | 外部平台订单编号 |
| status | Text | NO | - | 本地订单状态 |
| external_status | Text | NO | - | 外部平台原始状态 |
| is_cod | Boolean | NO | False | 是否货到付款 |
| payment_method | CheckConstraint(payment_method IN ('online','cod')) | NO | - | 支付方式 |
| buyer_name | Text | NO | - | 买家姓名 |
| buyer_phone_raw | Text | YES | - | 买家电话原始格式 |
| buyer_phone_e164 | Text | YES | - | 买家电话 E.164 格式 |
| buyer_email | Text | YES | - | 买家邮箱 |
| address_country | Text | NO | 'RU' | 国家 |
| address_region | Text | NO | - | 地区/州 |
| address_city | Text | NO | - | 城市 |
| address_street | Text | NO | - | 街道地址 |
| address_postcode | CheckConstraint(address_postcode ~ '^\d{6}$') | NO | - | 6位邮编 |
| platform_created_ts | DateTime | NO | - | 平台订单创建时间 |
| platform_updated_ts | DateTime | NO | - | 平台订单更新时间 |
| fx_rate | NUMERIC(18, 6) | NO | - | CNY→RUB 汇率快照 |
| currency | Text | NO | 'RUB' | 币种 |
| created_at | DateTime | NO | server: now() | 记录创建时间 |
| updated_at | DateTime | NO | server: now() | 记录更新时间 |
| idempotency_key | Text | NO | - | 幂等键 |

## 索引

- `ix_orders_shop_updated` (shop_id, platform_updated_ts)
- `ix_orders_external_no` (external_no)
- `ix_orders_status` (status)
- `ix_orders_created_at` (created_at)

## 唯一约束

- uq_orders_platform_shop_external: (platform, shop_id, external_id)
- uq_orders_idempotency_key: (idempotency_key)
