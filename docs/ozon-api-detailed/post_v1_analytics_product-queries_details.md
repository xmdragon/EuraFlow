# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/analytics/product-queries/details` |
| **Content-Type** | `application/json` |

## 接口描述

可以按指定日期范围获取分析数据。为此，需在请求中指定date_from和date_to参数。最近 1 个月的数据可随时查询，但不包括距离当前日期 3 天内的数据（此时间段的数据仍在计算中）。超过 1 个月前的数据仅适用于Premium及Premium Plus订阅用户，并且只能按周查询，需在请求中指定date_from参数。

## 请求示例

```json
{
  "date_from": "2019-08-24T14:15:22Z",
  "date_to": "2019-08-24T14:15:22Z",
  "limit_by_sku": 0,
  "page": 1,
  "page_size": 1000,
  "skus": [
    "string"
  ],
  "sort_by": "BY_SEARCHES",
  "sort_dir": "DESCENDING"
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
