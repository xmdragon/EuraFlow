# ozon_postings

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/orders.py`
- **模型类**: `OzonPosting`
- **用途**: Ozon 发货单（Posting维度）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| order_id | BigInteger | NO | - | FK → ozon_orders.id |
| shop_id | Integer | NO | - | - |
| posting_number | String(100) | NO | - | - |
| ozon_posting_number | String(100) | YES | - | - |
| status | String(50) | NO | - | - |
| substatus | String(100) | YES | - | - |
| shipment_date | DateTime | YES | - | - |
| delivery_method_id | BigInteger | YES | - | - |
| delivery_method_name | String(200) | YES | - | - |
| warehouse_id | BigInteger | YES | - | - |
| warehouse_name | String(200) | YES | - | - |
| packages_count | Integer | YES | 1 | - |
| total_weight | Numeric(10, 3) | YES | - | - |
| is_cancelled | Boolean | YES | False | - |
| cancel_reason_id | Integer | YES | - | - |
| cancel_reason | String(500) | YES | - | - |
| raw_payload | JSONB | YES | - | - |
| material_cost | Numeric(18, 2) | YES | - | 物料成本（包装、标签等） |
| purchase_price | Numeric(18, 2) | YES | - | 进货价格 |
| purchase_price_updated_at | DateTime | YES | - | 进货价格更新时间 |
| order_notes | String(1000) | YES | - | 订单备注 |
| source_platform | JSONB | YES | - | 采购平台列表 |
| operation_time | DateTime | YES | - | 用户操作时间（备货/打包等操作的时间戳） |
| operation_status | String(50) | NO | 'awaiting_stock' | 操作状态：awaiting_stock(等待备货)/allocating(分配中)/allocated(已分配)/tracking_confirmed(单号确认)/shipping(运输中)/cancelled(已取消) |
| kuajing84_sync_error | String(200) | YES | - | 跨境巴士同步错误信息（如'订单不存在'则跳过后续同步） |
| kuajing84_last_sync_at | DateTime | YES | - | 最后尝试同步跨境巴士的时间 |
| last_mile_delivery_fee_cny | Numeric(18, 2) | YES | - | 尾程派送费(CNY) |
| international_logistics_fee_cny | Numeric(18, 2) | YES | - | 国际物流费(CNY) |
| ozon_commission_cny | Numeric(18, 2) | YES | - | Ozon佣金(CNY) |
| finance_synced_at | DateTime | YES | - | 财务同步时间 |
| profit | Numeric(18, 2) | YES | - | 利润金额(CNY) |
| profit_rate | Numeric(10, 4) | YES | - | 利润比率(%) |
| order_total_price | Numeric(18, 2) | YES | - | 订单总金额（从raw_payload.products计算，避免运行时JSONB解析） |
| has_tracking_number | Boolean | NO | False | 是否有追踪号（避免JSONB查询） |
| has_domestic_tracking | Boolean | NO | False | 是否有国内单号（避免EXISTS子查询） |
| has_purchase_info | Boolean | NO | False | 是否所有商品都有采购信息（避免jsonb_array_elements子查询） |
| product_skus | ARRAY | YES | - | 商品SKU数组（反范式化，优化SKU搜索性能，使用GIN索引） |
| label_pdf_path | String(500) | YES | - | 标签PDF文件路径（70x125mm竖向格式） |
| label_printed_at | DateTime | YES | - | 标签首次打印时间 |
| label_print_count | Integer | NO | 0 | 标签打印次数 |
| in_process_at | DateTime | YES | - | - |
| shipped_at | DateTime | YES | - | - |
| delivered_at | DateTime | YES | - | - |
| cancelled_at | DateTime | YES | - | - |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_postings_status` (shop_id, status)
- `idx_ozon_postings_date` (shop_id, shipment_date)
- `idx_ozon_postings_warehouse` (warehouse_id, status)
- `idx_ozon_postings_order_join` (order_id, in_process_at, status, shop_id)
- `idx_ozon_postings_in_process` (shop_id, in_process_at, status)
- `idx_ozon_postings_status_time` (status, in_process_at, shop_id)

## 外键关系

- `order_id` → `ozon_orders.id`
