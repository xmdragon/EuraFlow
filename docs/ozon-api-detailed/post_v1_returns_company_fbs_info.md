# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/returns/company/fbs/info` |
| **Content-Type** | `application/json` |

## 请求示例

```json
{
  "filter": {
    "place_id": 0
  },
  "pagination": {
    "last_id": 0,
    "limit": 500
  }
}
```

## 响应示例

```json
{
  "drop_off_points": [
    {
      "address": "string",
      "box_count": 0,
      "id": 0,
      "name": "string",
      "pass_info": {
        "count": 0,
        "is_required": true
      },
      "place_id": 0,
      "returns_count": 0,
      "utc_offset": "string",
      "warehouses_ids": [
        "string"
      ]
    }
  ],
  "has_next": true
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
