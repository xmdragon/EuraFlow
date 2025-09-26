# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v2/chat/history` |
| **Content-Type** | `application/json` |

## 接口描述

恢复聊天室消息历史记录。默认顺序为从最新消息到之前的消息。

## 请求示例

```json
{
  "chat_id": "18b8e1f9-4ae7-461c-84ea-8e1f54d1a45e",
  "direction": "Forward",
  "from_message_id": 3000000000118032000,
  "limit": 1
}
```

## 响应示例

```json
{
  "has_next": true,
  "messages": [
    {
      "message_id": "3000000000817031942",
      "user": {
        "id": "115568",
        "type": "Сustomer"
      },
      "created_at": "2022-07-18T20:58:04.528Z",
      "is_read": true,
      "data": [
        "Здравствуйте, у меня вопрос по вашему товару \"Стекло защитное для смартфонов\", артикул 11223. Подойдет ли он на данную [ модель ](https://www.ozon.ru/product/smartfon-samsung-galaxy-a03s-4-64-gb-chernyy) телефона?"
      ]
    }
  ]
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
