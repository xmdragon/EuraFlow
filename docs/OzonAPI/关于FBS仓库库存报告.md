# 关于FBS仓库库存报告

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/report/warehouse/stock`
- **操作ID**: `operation/ReportAPI_CreateStockByWarehouseReport`

## 描述

报告包含仓库中可用和预留的商品数量的信息。
与个人中心中的FBO→物流管理→库存管理→以XLS格式下载部分相符。

## 请求参数

### Header参数

| Client-Id | required |  | 用户识别号。 |
|---|---|---|---|
| Api-Key | required |  | API-密钥。 |

## 请求示例

```json
{
  "language": "DEFAULT",
  "warehouseId": [
    "string"
  ]
}
```

## 响应
