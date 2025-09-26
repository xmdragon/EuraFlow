# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v2/chat/list` |
| **Content-Type** | `application/json` |

## 请求示例

```json
{
  "filter": {
    "chat_status": "Opened",
    "unread_only": true
  },
  "limit": 1,
  "offset": 0
}
```

## 响应示例

```json
{
  "chats": [
    {
      "chat": {
        "created_at": "2022-07-22T08:07:19.581Z",
        "chat_id": "5e767w03-b400-4y1b-a841-75319ca8a5c8",
        "chat_status": "Opened",
        "chat_type": "Seller_Support"
      },
      "first_unread_message_id": "3000000000118021931",
      "last_message_id": "30000000001280042740",
      "unread_count": 1
    }
  ],
  "total_chats_count": 25,
  "total_unread_count": 5
}
```

## 通用错误码

| HTTP状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未授权访问 |
| 403 | FORBIDDEN | 禁止访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 429 | TOO_MANY_REQUESTS | 请求频率限制 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
