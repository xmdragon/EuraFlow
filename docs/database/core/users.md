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
| role | String(50) | NO | 'viewer' | 角色：admin/operator/viewer |
| permissions | JSON | NO | list | 权限列表 |
| parent_user_id | BigInteger | YES | - | FK → users.id | 父账号ID |
| primary_shop_id | BigInteger | YES | - | FK → ozon_shops.id | 主店铺ID (指向ozon_shops) |
| last_login_at | DateTime | YES | - | 最后登录时间 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `ix_users_role` (role)
- `ix_users_is_active` (is_active)

## 外键关系

- `parent_user_id` → `users.id`
- `primary_shop_id` → `ozon_shops.id`
