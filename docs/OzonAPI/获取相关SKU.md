# 获取相关SKU

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/product/related-sku/get`
- **操作ID**: `operation/ProductAPI_ProductGetRelatedSKU`

## 描述

用于通过旧的SKU FBS和SKU FBO标识符获取统一SKU的方法。
响应中将包含所有与传递的SKU相关的SKU。

## 请求参数

### Header参数

| Client-Id | required |  | 用户识别号。 |
|---|---|---|---|
| Api-Key | required |  | API-密钥。 |

## 请求示例

```json
{
  "sku": [
    "string"
  ]
}
```

## 响应
