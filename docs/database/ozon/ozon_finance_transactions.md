# ozon_finance_transactions

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/finance.py`
- **模型类**: `OzonFinanceTransaction`
- **用途**: OZON 财务交易记录表（扁平化存储）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | FK → ozon_shops.id |
| operation_id | BigInteger | NO | - | OZON操作ID |
| operation_type | String(200) | NO | - | 操作类型 |
| operation_type_name | String(500) | YES | - | 操作类型名称 |
| transaction_type | String(50) | NO | - | 收费类型: orders/returns/services/compensation/transferDelivery/other |
| posting_number | String(100) | YES | - | 发货单号 |
| operation_date | DateTime | NO | - | 操作日期 |
| accruals_for_sale | Numeric(18, 4) | YES | - | 考虑卖家折扣的商品成本 |
| amount | Numeric(18, 4) | YES | - | 交易总额 |
| delivery_charge | Numeric(18, 4) | YES | - | 运费 |
| return_delivery_charge | Numeric(18, 4) | YES | - | 退货运费 |
| sale_commission | Numeric(18, 4) | YES | - | 销售佣金或佣金返还 |
| ozon_sku | String(100) | YES | - | OZON平台SKU |
| item_name | String(500) | YES | - | 商品名称 |
| item_quantity | Integer | YES | - | 商品数量 |
| item_price | Numeric(18, 4) | YES | - | 商品价格 |
| posting_delivery_schema | String(200) | YES | - | 配送方式 |
| posting_warehouse_name | String(200) | YES | - | 仓库名称 |
| services_json | JSONB | YES | - | 附加服务费用列表 |
| raw_data | JSONB | YES | - | OZON原始交易数据 |
| created_at | DateTime | YES | utcnow | 记录创建时间 |
| updated_at | DateTime | YES | utcnow | 记录更新时间 |

## 索引

- `idx_ozon_finance_shop_date` (shop_id, operation_date)
- `idx_ozon_finance_posting` (posting_number)
- `idx_ozon_finance_operation` (operation_id)
- `idx_ozon_finance_type` (shop_id, transaction_type, operation_type)

## 唯一约束

- uq_ozon_finance_transaction: (shop_id, operation_id, ozon_sku)

## 外键关系

- `shop_id` → `ozon_shops.id`
