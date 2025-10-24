# 获取 rFBS 取消申请列表

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v2/conditional-cancellation/list`
- **操作ID**: `operation/CancellationAPI_GetConditionalCancellationListV2`

## 描述

用于获取 rFBS 订单取消申请列表的方法。

## 请求示例

```json
{
  "filters": {
    "cancellation_initiator": [
      "CLIENT"
    ],
    "posting_number": [
      "34009011-0094-1"
    ],
    "state": "ALL"
  },
  "limit": 500,
  "last_id": 0,
  "with": {
    "counter": true
  }
}
```

## 响应
