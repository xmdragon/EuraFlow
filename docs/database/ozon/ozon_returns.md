# ozon_returns

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/cancel_return.py`
- **模型类**: `OzonReturn`
- **用途**: OZON 退货申请表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | 店铺ID |
| posting_id | BigInteger | YES | - | FK → ozon_postings.id | 关联的货件ID |
| return_id | BigInteger | NO | - | OZON退货申请ID |
| return_number | String(100) | NO | - | 退货申请编号 |
| posting_number | String(100) | NO | - | 货件编号 |
| order_number | String(100) | YES | - | 订单号 |
| client_name | String(200) | YES | - | 买家姓名 |
| product_name | String(500) | YES | - | 商品名称 |
| offer_id | String(100) | YES | - | 商品货号 |
| sku | BigInteger | YES | - | SKU |
| price | Numeric(18, 4) | YES | - | 价格 |
| currency_code | String(10) | YES | - | 货币代码 |
| group_state | String(50) | NO | - | 状态组 |
| state | String(50) | NO | - | 状态标识 |
| state_name | String(200) | YES | - | 状态名称 |
| money_return_state_name | String(200) | YES | - | 退款状态名称 |
| delivery_method_name | String(200) | YES | - | 配送方式名称 |
| return_reason_id | Integer | YES | - | 退货原因ID |
| return_reason_name | String(500) | YES | - | 退货原因名称 |
| rejection_reason_id | Integer | YES | - | 拒绝原因ID |
| rejection_reason_name | String(500) | YES | - | 拒绝原因名称 |
| rejection_reasons | JSONB | YES | - | 拒绝原因列表（详情数据） |
| return_method_description | Text | YES | - | 退货方式描述 |
| available_actions | JSONB | YES | - | 可用操作列表 |
| created_at_ozon | DateTime | NO | - | OZON创建日期 |
| raw_payload | JSONB | YES | - | OZON原始数据 |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_returns_shop_state` (shop_id, group_state)
- `idx_ozon_returns_shop_date` (shop_id, created_at_ozon)
- `idx_ozon_returns_posting` (posting_number)
- `idx_ozon_returns_offer` (offer_id)

## 唯一约束

- uq_ozon_returns_shop_id: (shop_id, return_id)

## 外键关系

- `posting_id` → `ozon_postings.id`
