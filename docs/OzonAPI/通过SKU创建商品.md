# 通过SKU创建商品

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/product/import-by-sku`
- **操作ID**: `operation/ProductAPI_ImportProductsBySKU`

## 描述

该方法会创建指定SKU的商品卡片副本。
如果卖家禁止复制，
将无法创建卡片副本。

## 请求参数

### Header参数

| Client-Id | required |  | 用户识别号。 |
|---|---|---|---|
| Api-Key | required |  | API-密钥。 |

## 请求示例

```json
{
  "items": [
    {
      "sku": 298789742,
      "name": "string",
      "offer_id": "91132",
      "currency_code": "RUB",
      "old_price": "2590",
      "price": "2300",
      "vat": "0.1"
    }
  ]
}
```

## 响应
