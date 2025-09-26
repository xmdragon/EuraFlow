# 加载图片

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v4/product/info/limit` |
| **Content-Type** | `application/json` |

## 接口描述

欲知限制，请使用/v4/product/info/limit。 如果商品下载和更新次数
超过限制，则出现错误item_limit_exceeded。

## 响应结构

### 200 - 成功响应

## 响应示例

```json
{
  "complex_id": 100001,
  "id": 21841,
  "values": [
    {
      "value": "https://www.youtube.com/watch?v=ZwM0iBn03dY"
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
