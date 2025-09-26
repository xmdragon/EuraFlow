# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/pass/list` |
| **Content-Type** | `application/json` |

## 请求示例

```json
{
  "cursor": "",
  "filter": {
    "arrival_pass_ids": [
      "string"
    ],
    "arrival_reason": "string",
    "dropoff_point_ids": [
      "string"
    ],
    "only_active_passes": true,
    "warehouse_ids": [
      "string"
    ]
  },
  "limit": 1000
}
```

## 响应示例

```json
{
  "arrival_passes": [
    {
      "arrival_pass_id": 0,
      "arrival_reasons": [
        "string"
      ],
      "arrival_time": "2019-08-24T14:15:22Z",
      "driver_name": "string",
      "driver_phone": "string",
      "dropoff_point_id": 0,
      "is_active": true,
      "vehicle_license_plate": "string",
      "vehicle_model": "string",
      "warehouse_id": 0
    }
  ],
  "cursor": "string"
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
