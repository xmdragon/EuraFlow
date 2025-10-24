# 拒绝 rFBS 取消申请

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v2/conditional-cancellation/reject`
- **操作ID**: `operation/CancellationAPI_ConditionalCancellationRejectV2`

## 描述

此方法可拒绝状态为ON_APPROVAL的取消申请。在comment参数中说明拒绝原因。订单将保留当前状态，并需继续发货给买家。

## 请求示例

```json
{
  "cancellation_id": 0,
  "comment": "string"
}
```

## 响应
