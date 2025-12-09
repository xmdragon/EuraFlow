# users

## 基本信息

- **模型文件**: `ef_core/models/users.py`
- **模型类**: `User`
- **用途**: 用户模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 用户ID |
| username | String(50) | NO | - | 用户名 |
| password_hash | String(255) | NO | - | 密码哈希 |
| is_active | Boolean | NO | True | 是否激活 |
| role | String(50) | NO | 'sub_account' | 角色：admin/manager/sub_account |
| permissions | JSON | NO | list | 权限列表 |
| manager_level_id | BigInteger | YES | - | FK → manager_levels.id | 管理员级别ID |
| account_status | String(20) | NO | 'active' | 账号状态：active/suspended/disabled |
| expires_at | DateTime | YES | - | 账号过期时间，NULL表示永不过期 |
| parent_user_id | BigInteger | YES | - | FK → users.id | 父账号ID |
| current_session_token | String(64) | YES | - | 当前活跃会话令牌 |
| primary_shop_id | BigInteger | YES | - | FK → ozon_shops.id | 主店铺ID (指向ozon_shops) |
| last_login_at | DateTime | YES | - | 最后登录时间 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `ix_users_role` (role)
- `ix_users_is_active` (is_active)

## 外键关系

- `manager_level_id` → `manager_levels.id`
- `parent_user_id` → `users.id`
- `primary_shop_id` → `ozon_shops.id`
