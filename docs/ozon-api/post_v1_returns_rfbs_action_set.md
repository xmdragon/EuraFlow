# /v1/returns/rfbs/action/set

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/returns/rfbs/action/set`

## 详细信息

获取退货申请及其信息：

  * /v2/returns/rfbs/get — 获取rFBS退货申请的信息。
  * /v2/returns/rfbs/list — 获取rFBS退货申请列表。



您可以通过方法 /v1/returns/rfbs/action/set 批准、赔偿、确认退款，申请商品返检或拒绝退货申请。 为了传递正确的 `action`，请通过方法 /v2/returns/rfbs/get 获取针对具体退货可用的操作列表。
