# 确认 rFBS 取消申请

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v2/conditional-cancellation/approve`
- **操作ID**: `operation/CancellationAPI_ConditionalCancellationApproveV2`

## 描述

此方法可将状态为ON_APPROVAL的取消申请标记为已确认。订单将被取消，款项退还给买家。

## 请求示例

```json
{
  "cancellation_id": 0,
  "comment": "string"
}
```

## 响应
