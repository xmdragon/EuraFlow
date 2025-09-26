# Ozon Seller API 文件(2.1)

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v2/posting/fbs/product/change` |
| **Content-Type** | `application/json` |

## 接口描述

使用API包括发送请求和接收响应。为此需要使用位于方法描述上方的Console选项卡,Postman或者设置与会计系统集成，其包括如 ERP。

## 请求示例

```json
{
  "attribute_id": 0,
  "description_category_id": 0,
  "language": "DEFAULT",
  "last_value_id": 0,
  "limit": 0,
  "type_id": 0
}
```

## 响应结构

### 200 - 成功响应

| 字段名 | 类型 | 描述 |
|--------|------|------|
| `string商品类型名称。` | - | - |
| `string商品类型名称。` | - | - |
| `string商品类型名称。` | - | - |
| `string商品类型名称。` | - | - |
| `string商品类型名称。` | - | - |

## 响应示例

```json
{
  "language": "DEFAULT"
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
