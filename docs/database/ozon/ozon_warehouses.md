# ozon_warehouses

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/warehouses.py`
- **模型类**: `OzonWarehouse`
- **用途**: OZON 仓库模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 仓库记录ID |
| shop_id | BigInteger | NO | - | FK → ozon_shops.id | 关联的Ozon店铺ID |
| warehouse_id | BigInteger | NO | - | OZON 仓库ID |
| name | String(200) | NO | - | 仓库名称 |
| is_rfbs | Boolean | NO | False | 是否为rFBS仓库 |
| status | String(20) | NO | - | 仓库状态：new/created/disabled/blocked/disabled_due_to_limit/error |
| has_entrusted_acceptance | Boolean | NO | False | 是否启用受信任接受 |
| postings_limit | Integer | NO | - | 订单限额（-1表示无限制） |
| min_postings_limit | Integer | YES | - | 单次供货最小订单数 |
| has_postings_limit | Boolean | NO | False | 是否有订单数限制 |
| min_working_days | Integer | YES | - | 最少工作天数 |
| working_days | JSON | YES | - | 工作日列表（1-7表示周一至周日） |
| can_print_act_in_advance | Boolean | NO | False | 是否可提前打印收发证书 |
| is_karantin | Boolean | NO | False | 是否因隔离停运 |
| is_kgt | Boolean | NO | False | 是否接受大宗商品 |
| is_timetable_editable | Boolean | NO | False | 是否可修改时间表 |
| first_mile_type | JSON | YES | - | 第一英里类型配置 |
| raw_data | JSONB | YES | - | OZON API 原始响应数据 |
| created_at | DateTime | NO | server: now() | 创建时间（UTC） |
| updated_at | DateTime | NO | server: now() | 更新时间（UTC） |

## 索引

- `idx_ozon_warehouses_shop_id` (shop_id)

## 唯一约束

- uq_ozon_warehouse_shop_warehouse: (shop_id, warehouse_id)

## 外键关系

- `shop_id` → `ozon_shops.id`
