# user_login_sessions

## 基本信息

- **模型文件**: `ef_core/models/user_login_session.py`
- **模型类**: `UserLoginSession`
- **用途**: 用户登录会话模型

用于实现单设备登录限制：
- 每次登录生成唯一会话令牌
- 新设备登录时使旧会话失效
- 记录设备信息用于审计

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | 会话ID |
| user_id | BigInteger | NO | - | FK → users.id | 用户ID |
| session_token | String(64) | NO | - | 会话令牌（64位十六进制） |
| device_info | String(500) | YES | - | 设备信息 |
| ip_address | String(50) | YES | - | IP地址 |
| user_agent | String(500) | YES | - | User-Agent |
| is_active | Boolean | NO | True | 是否活跃 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| last_activity_at | DateTime | NO | server: now() | 最后活动时间 |

## 索引

- `ix_user_login_sessions_user_id` (user_id)
- `ix_user_login_sessions_session_token` (session_token)
- `ix_user_login_sessions_is_active` (is_active)

## 外键关系

- `user_id` → `users.id`
