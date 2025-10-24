# 从存档删除没有SKU的商品

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v2/products/delete`
- **操作ID**: `operation/ProductAPI_DeleteProducts`

## 描述

在一次请求中最多可以提交500个识别码。

## 请求参数

### Header参数

| Client-Idrequired | string用户识别号。 |
|---|---|
| Api-Keyrequired | stringAPI-密钥。 |

## 请求示例

```json
{
  "products": [
    {
      "offer_id": "033"
    }
  ]
}
```

## 响应
