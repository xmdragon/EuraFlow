# ozon_chats

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/chat.py`
- **模型类**: `OzonChat`
- **用途**: OZON聊天会话

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| chat_id | String(100) | NO | - | - |
| chat_type | String(50) | YES | - | - |
| subject | String(500) | YES | - | - |
| customer_id | String(100) | YES | - | - |
| customer_name | String(200) | YES | - | - |
| status | String(50) | YES | 'open' | - |
| is_closed | Boolean | YES | False | - |
| is_archived | Boolean | YES | False | - |
| order_number | String(100) | YES | - | - |
| product_id | BigInteger | YES | - | - |
| message_count | Integer | YES | 0 | - |
| unread_count | Integer | YES | 0 | - |
| last_message_at | DateTime | YES | - | - |
| last_message_preview | String(1000) | YES | - | - |
| extra_data | JSONB | YES | - | - |
| closed_at | DateTime | YES | - | - |
| created_at | DateTime | NO | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_chat_shop_status` (shop_id, status, last_message_at)
- `idx_ozon_chat_order` (order_number)
