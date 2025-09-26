# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/description-category/attribute/values/search` |
| **Content-Type** | `application/json` |

## 请求示例

```json
{
  "attribute_id": 85,
  "description_category_id": 17054869,
  "limit": 100,
  "type_id": 97311,
  "value": "Name"
}
```

## 响应结构

### 200 - 成功响应

## 响应示例

```json
{
  "result": [
    {
      "id": 0,
      "info": "string",
      "picture": "string",
      "value": "string"
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
