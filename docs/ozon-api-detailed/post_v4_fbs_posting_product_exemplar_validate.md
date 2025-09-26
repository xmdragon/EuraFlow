# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v4/fbs/posting/product/exemplar/validate` |
| **Content-Type** | `application/json` |

## 响应结构

### 200 - 成功响应

## 响应示例

```json
{
  "posting_number": "23281294-0063-2",
  "products": [
    {
      "exemplars": [
        {
          "gtd": "",
          "mandatory_mark": "010290000151642731tVMohkbfFgunB",
          "jw_uin": ""
        }
      ],
      "product_id": 476925391
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
