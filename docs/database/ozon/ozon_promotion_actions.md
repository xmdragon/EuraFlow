# ozon_promotion_actions

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/promotion.py`
- **模型类**: `OzonPromotionAction`
- **用途**: Ozon 促销活动表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| action_id | BigInteger | NO | - | OZON活动ID |
| title | String(500) | YES | - | 活动名称 |
| description | Text | YES | - | 活动描述 |
| date_start | DateTime | YES | - | 开始时间 UTC |
| date_end | DateTime | YES | - | 结束时间 UTC |
| status | String(50) | YES | - | 活动状态: active/inactive/expired |
| auto_cancel_enabled | Boolean | YES | False | 自动取消开关 |
| raw_data | JSONB | YES | - | OZON原始数据 |
| last_sync_at | DateTime | YES | - | 最后同步时间 |
| created_at | DateTime | NO | utcnow | - |
| updated_at | DateTime | NO | utcnow | - |

## 索引

- `idx_ozon_promotion_actions_shop` (shop_id)
- `idx_ozon_promotion_actions_shop_status` (shop_id, status)
- `idx_ozon_promotion_actions_auto_cancel` (shop_id, auto_cancel_enabled)

## 唯一约束

- uq_ozon_promotion_actions_shop_action: (shop_id, action_id)
