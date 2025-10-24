# 按SKU获得商品的内容排名

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/product/rating-by-sku`
- **操作ID**: `operation/ProductAPI_GetProductRatingBySku`

## 描述

一种获得商品内容排名的方法，以及如何提高排名的建议。

## 请求参数

### Header参数

| Client-Id | required |  | 用户识别号。 |
|---|---|---|---|
| Api-Key | required |  | API-密钥。 |

## 请求示例

```json
{
  "skus": [
    "179737222"
  ]
}
```

## 响应
