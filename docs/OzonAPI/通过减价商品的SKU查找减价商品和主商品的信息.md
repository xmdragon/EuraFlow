# 通过减价商品的SKU查找减价商品和主商品的信息

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/product/info/discounted`
- **操作ID**: `operation/ProductAPI_GetProductInfoDiscounted`

## 描述

一种通过SKU获取打折商品的状况和缺陷信息的方法。该方法还返回主商品的SKU。

## 请求参数

### Header参数

| Client-Idrequired | string用户识别号。 |
|---|---|
| Api-Keyrequired | stringAPI-密钥。 |

## 请求示例

```json
{
  "discounted_skus": [
    "635548518"
  ]
}
```

## 响应
