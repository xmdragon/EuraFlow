# ozon_daily_stats

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/stats.py`
- **模型类**: `OzonDailyStats`
- **用途**: 每日统计汇总表

用于报表预聚合，每天凌晨由定时任务计算过去30天的数据。
订单生命周期长（发货到签收可达1个月），需要滚动更新。

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | FK → ozon_shops.id |
| date | Date | NO | - | 统计日期 |
| order_count | Integer | NO | 0 | 订单数 |
| delivered_count | Integer | NO | 0 | 已签收订单数 |
| cancelled_count | Integer | NO | 0 | 已取消订单数 |
| total_sales | Numeric(18, 4) | NO | - | 销售总额(CNY) |
| total_purchase | Numeric(18, 4) | NO | - | 采购成本(CNY) |
| total_profit | Numeric(18, 4) | NO | - | 毛利润(CNY) |
| total_commission | Numeric(18, 4) | NO | - | 平台佣金(CNY) |
| total_logistics | Numeric(18, 4) | NO | - | 物流费用(CNY) |
| total_material_cost | Numeric(18, 4) | NO | - | 物料成本(CNY) |
| top_products | JSONB | YES | - | TOP商品 [{offer_id, name, quantity, sales}] |
| generated_at | DateTime | YES | - | 统计生成时间 |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_daily_stats_date` (date)
- `idx_ozon_daily_stats_shop_date` (shop_id, date)

## 唯一约束

- uq_ozon_daily_stats_shop_date: (shop_id, date)

## 外键关系

- `shop_id` → `ozon_shops.id`
