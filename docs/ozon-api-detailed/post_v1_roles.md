# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/roles` |
| **Content-Type** | `application/json` |

## 请求参数

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `methodsArray ofstrings角色可用的方式。` | - | 否 | - | - |
| `Array ofstrings角色可用的方式。` | - | 否 | - | - |
| `Array ofstrings角色可用的方式。` | - | 否 | - | - |

## 响应结构

### 200 - 成功响应

| 字段名 | 类型 | 描述 |
|--------|------|------|
| `methodsArray ofstrings角色可用的方式。` | - | - |

## 响应示例

```json
{}
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
