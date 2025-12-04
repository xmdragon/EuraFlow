# api_keys

## 基本信息

- **模型文件**: `ef_core/models/api_keys.py`
- **模型类**: `APIKey`
- **用途**: API密钥模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | API Key ID |
| user_id | BigInteger | NO | - | FK → users.id | 所属用户ID |
| key_hash | String(255) | NO | - | API Key哈希值（SHA256，64字符hex） |
| name | String(100) | NO | - | Key名称（如：Tampermonkey脚本） |
| permissions | JSON | NO | list | 权限列表，如['product_selection:write'] |
| is_active | Boolean | NO | True | 是否激活 |
| last_used_at | DateTime | YES | - | 最后使用时间 |
| expires_at | DateTime | YES | - | 过期时间（可选） |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `ix_api_keys_user_id` (user_id)
- `ix_api_keys_key_hash` (key_hash)
- `ix_api_keys_is_active` (is_active)

## 外键关系

- `user_id` → `users.id`
