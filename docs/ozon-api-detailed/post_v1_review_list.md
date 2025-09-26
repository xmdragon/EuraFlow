# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/review/list` |
| **Content-Type** | `application/json` |

## 接口描述

该方法不会返回商品评价中的“优点”和“缺点”参数（如果有）。 这些参数已过时，新的评价中不再包含这些参数。

## 请求示例

```json
{
  "last_id": "",
  "limit": 100,
  "sort_dir": "ASC",
  "status": "ALL"
}
```

## 响应示例

```json
{
  "has_next": true,
  "last_id": "string",
  "reviews": [
    {
      "comments_amount": 0,
      "id": "string",
      "is_rating_participant": true,
      "order_status": "string",
      "photos_amount": 0,
      "published_at": "2019-08-24T14:15:22Z",
      "rating": 0,
      "sku": 0,
      "status": "string",
      "text": "string",
      "videos_amount": 0
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
