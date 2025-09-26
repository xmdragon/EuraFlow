# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/review/comment/list` |
| **Content-Type** | `application/json` |

## 接口描述

该方法返回已通过审核的评价评论信息。

## 请求示例

```json
{
  "limit": 100,
  "offset": 0,
  "review_id": "0187310a-97d9-dfcf-3039-82d809f0e233",
  "sort_dir": "ASC"
}
```

## 响应示例

```json
{
  "comments": [
    {
      "id": "string",
      "is_official": true,
      "is_owner": true,
      "parent_comment_id": "string",
      "published_at": "2019-08-24T14:15:22Z",
      "text": "string"
    }
  ],
  "offset": 0
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
