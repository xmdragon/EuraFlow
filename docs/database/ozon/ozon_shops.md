# ozon_shops

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/ozon_shops.py`
- **模型类**: `OzonShop`
- **用途**: Ozon店铺模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | Ozon店铺ID |
| shop_name | String(200) | NO | - | 店铺名称（俄文） |
| shop_name_cn | String(200) | YES | - | 店铺中文名称 |
| platform | String(50) | NO | 'ozon' | 平台名称 |
| status | String(20) | NO | 'active' | 店铺状态 |
| owner_user_id | BigInteger | NO | - | FK → users.id | 店铺所有者ID |
| client_id | String(200) | NO | - | Ozon Client ID |
| api_key_enc | Text | NO | - | 加密的API Key |
| config | JSON | NO | dict | 店铺配置（Webhook、同步设置等） |
| stats | JSON | YES | - | 店铺统计信息 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
| last_sync_at | DateTime | YES | - | 最后同步时间 |

## 唯一约束

- uq_ozon_shop_owner_name: (owner_user_id, shop_name)

## 外键关系

- `owner_user_id` → `users.id`
