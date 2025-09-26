# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/carriage/pass/update` |
| **Content-Type** | `application/json` |

## 响应示例

```json
{
  "arrival_passes": [
    {
      "driver_name": "string",
      "driver_phone": "string",
      "id": 0,
      "vehicle_license_plate": "string",
      "vehicle_model": "string",
      "with_returns": true
    }
  ],
  "carriage_id": 0
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
