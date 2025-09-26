# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/analytics/average-delivery-time/summary` |
| **Content-Type** | `application/json` |

## 接口描述

如需获取每个集群的详细分析，可使用方法/v1/analytics/average-delivery-time/details。
要获取平均配送时间的分析，请使用方法/v1/analytics/average-delivery-time。

## 响应示例

```json
{
  "average_delivery_time": 54,
  "perfect_delivery_time": 40,
  "current_tariff": {
    "start": 52,
    "tariff_status": "GOOD",
    "tariff_value": 77.4,
    "fee": 3.87
  },
  "updated_at": "0001-01-01T00:00:00Z",
  "lost_profit": 40513
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
