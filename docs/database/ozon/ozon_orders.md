# ozon_orders

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/orders.py`
- **模型类**: `OzonOrder`
- **用途**: Ozon 订单表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| order_id | String(100) | NO | - | 本地订单号 |
| ozon_order_id | String(100) | NO | - | Ozon订单号 |
| ozon_order_number | String(100) | YES | - | Ozon订单编号 |
| status | String(50) | NO | - | - |
| ozon_status | String(50) | YES | - | - |
| payment_status | String(50) | YES | - | - |
| order_type | String(50) | YES | 'FBS' | - |
| is_express | Boolean | YES | False | - |
| is_premium | Boolean | YES | False | - |
| total_price | Numeric(18, 4) | NO | - | - |
| products_price | Numeric(18, 4) | YES | - | - |
| delivery_price | Numeric(18, 4) | YES | - | - |
| commission_amount | Numeric(18, 4) | YES | - | - |
| customer_id | String(100) | YES | - | - |
| customer_phone | String(50) | YES | - | - |
| customer_email | String(200) | YES | - | - |
| delivery_address | JSONB | YES | - | - |
| delivery_method | String(100) | YES | - | - |
| delivery_date | DateTime | YES | - | - |
| delivery_time_slot | String(50) | YES | - | - |
| warehouse_id | BigInteger | YES | - | 仓库ID（来自analytics_data） |
| warehouse_name | String(200) | YES | - | 仓库名称（来自analytics_data） |
| tpl_provider_id | Integer | YES | - | 物流提供商ID（来自analytics_data） |
| tpl_provider_name | String(200) | YES | - | 物流提供商名称（来自analytics_data） |
| is_legal | Boolean | YES | - | 是否法人订单（来自analytics_data） |
| payment_type | String(100) | YES | - | 支付方式（来自analytics_data.payment_type_group_name） |
| delivery_date_begin | DateTime | YES | - | 配送开始日期（来自analytics_data） |
| delivery_date_end | DateTime | YES | - | 配送结束日期（来自analytics_data） |
| client_delivery_date_begin | DateTime | YES | - | 客户期望配送开始日期（来自analytics_data） |
| client_delivery_date_end | DateTime | YES | - | 客户期望配送结束日期（来自analytics_data） |
| raw_payload | JSONB | YES | - | Ozon原始订单数据 |
| ordered_at | DateTime | NO | - | - |
| confirmed_at | DateTime | YES | - | - |
| shipped_at | DateTime | YES | - | - |
| delivered_at | DateTime | YES | - | - |
| cancelled_at | DateTime | YES | - | - |
| last_sync_at | DateTime | YES | - | - |
| sync_status | String(50) | YES | 'pending' | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_orders_status` (shop_id, status)
- `idx_ozon_orders_date` (shop_id, ordered_at)
- `idx_ozon_orders_sync` (sync_status, last_sync_at)
- `idx_ozon_orders_join_cover` (id, shop_id, ordered_at, total_price)

## 唯一约束

- uq_ozon_orders_shop_order: (shop_id, ozon_order_id)
