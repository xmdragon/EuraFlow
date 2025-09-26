# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v4/product/info/attributes` |
| **Content-Type** | `application/json` |

## 接口描述

/v1/description-category/attribute

## 响应结构

### 200 - 成功响应

| 字段名 | 类型 | 描述 |
|--------|------|------|
| `offer_idstring卖家系统中的商品识别码是卖家系统中的商品标识符是商品货号。pdf_listArray ofobjectsPDF文件的阵列。weightinteger<int32>商品在包装中的重量。weight_unitstring重量测量单位。type_idinteger<int64>商品类型的标识符。widthinteger<int32>包装宽度。` | widthinteger<int32>包装宽度。 | - |
| `pdf_listArray ofobjectsPDF文件的阵列。weightinteger<int32>商品在包装中的重量。weight_unitstring重量测量单位。type_idinteger<int64>商品类型的标识符。widthinteger<int32>包装宽度。` | integer<int32>包装宽度。 | - |
| `weightinteger<int32>商品在包装中的重量。weight_unitstring重量测量单位。type_idinteger<int64>商品类型的标识符。widthinteger<int32>包装宽度。` | integer<int32>包装宽度。 | - |
| `weight_unitstring重量测量单位。type_idinteger<int64>商品类型的标识符。widthinteger<int32>包装宽度。` | integer<int32>包装宽度。 | - |
| `type_idinteger<int64>商品类型的标识符。widthinteger<int32>包装宽度。` | integer<int32>包装宽度。 | - |
| `widthinteger<int32>包装宽度。` | integer<int32>包装宽度。 | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |
| `integer<int32>包装宽度。` | - | - |

## 通用错误码

| HTTP状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未授权访问 |
| 403 | FORBIDDEN | 禁止访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 429 | TOO_MANY_REQUESTS | 请求频率限制 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
