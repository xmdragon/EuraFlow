# ozon_chat_messages

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/chat.py`
- **模型类**: `OzonChatMessage`
- **用途**: OZON聊天消息

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| chat_id | String(100) | NO | - | - |
| message_id | String(100) | NO | - | - |
| message_type | String(50) | YES | - | - |
| sender_type | String(50) | NO | - | - |
| sender_id | String(100) | YES | - | - |
| sender_name | String(200) | YES | - | - |
| content | Text | YES | - | - |
| content_data | JSONB | YES | - | - |
| data_cn | Text | YES | - | - |
| is_read | Boolean | YES | False | - |
| is_deleted | Boolean | YES | False | - |
| is_edited | Boolean | YES | False | - |
| order_number | String(100) | YES | - | - |
| product_id | BigInteger | YES | - | - |
| extra_data | JSONB | YES | - | - |
| read_at | DateTime | YES | - | - |
| edited_at | DateTime | YES | - | - |
| created_at | DateTime | NO | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_chat_shop_chat` (shop_id, chat_id, created_at)
- `idx_ozon_chat_unread` (shop_id, is_read, created_at)
