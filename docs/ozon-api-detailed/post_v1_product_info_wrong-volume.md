# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/product/info/wrong-volume` |
| **Content-Type** | `application/json` |

## 请求示例

```json
{
  "cursor": "",
  "limit": 1000
}
```

## 响应示例

```json
{
  "cursor": "string",
  "products": [
    {
      "height": 0,
      "length": 0,
      "name": "string",
      "offer_id": "string",
      "product_id": 0,
      "sku": 0,
      "weight": 0,
      "width": 0
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
