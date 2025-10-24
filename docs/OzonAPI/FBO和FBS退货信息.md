# FBO和FBS退货信息

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/returns/list`
- **操作ID**: `operation/returnsList`

## 描述

用于获取 FBO 和 FBS 退货信息的方法。

## 请求示例

```json
{
  "filter": {
    "logistic_return_date": {
      "time_from": "2019-08-24T14:15:22Z",
      "time_to": "2019-08-24T14:15:22Z"
    },
    "storage_tariffication_start_date": {
      "time_from": "2019-08-24T14:15:22Z",
      "time_to": "2019-08-24T14:15:22Z"
    },
    "visual_status_change_moment": {
      "time_from": "2019-08-24T14:15:22Z",
      "time_to": "2019-08-24T14:15:22Z"
    },
    "order_id": "0",
    "posting_numbers": [
      "string"
    ],
    "product_name": "string",
    "offer_id": "string",
    "visual_status_name": "string",
    "warehouse_id": "911",
    "barcode": "string",
    "return_schema": "FBO"
  },
  "limit": 500,
  "last_id": 0
}
```

## 响应
