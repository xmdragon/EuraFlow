# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/barcode/add` |
| **Content-Type** | `application/json` |

## 接口描述

每次请求最多可为 100 个商品分配条形码。
每个商品最多可绑定 100 个条形码。
每个卖家账号每分钟最多可使用该方法 20 次。

## 响应结构

### 200 - 成功响应

## 响应示例

```json
{
  "barcodes": [
    {
      "barcode": "string",
      "sku": 0
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
