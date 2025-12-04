# user_settings

## 基本信息

- **模型文件**: `ef_core/models/users.py`
- **模型类**: `UserSettings`
- **用途**: 用户设置模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 设置ID |
| user_id | BigInteger | NO | - | FK → users.id | 用户ID |
| notifications_email | Boolean | NO | True | 邮件通知 |
| notifications_browser | Boolean | NO | True | 浏览器通知 |
| notifications_order_updates | Boolean | NO | True | 订单更新通知 |
| notifications_price_alerts | Boolean | NO | True | 价格预警通知 |
| notifications_inventory_alerts | Boolean | NO | True | 库存预警通知 |
| display_language | String(10) | NO | 'zh-CN' | 界面语言 |
| display_timezone | String(50) | NO | 'Asia/Shanghai' | 时区 |
| display_currency | String(3) | NO | 'RUB' | 默认货币：RUB/CNY/USD/EUR |
| display_date_format | String(20) | NO | 'YYYY-MM-DD' | 日期格式 |
| sync_auto_sync | Boolean | NO | True | 自动同步 |
| sync_interval | Integer | NO | 60 | 同步间隔（分钟） |
| sync_on_login | Boolean | NO | True | 登录时同步 |
| security_two_factor_auth | Boolean | NO | False | 双因素认证 |
| security_session_timeout | Integer | NO | 30 | 会话超时（分钟） |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `ix_user_settings_user_id` (user_id)

## 外键关系

- `user_id` → `users.id`
