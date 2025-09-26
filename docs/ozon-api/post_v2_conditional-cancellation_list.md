# /v2/conditional-cancellation/list

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v2/conditional-cancellation/list`

## 详细信息

获取订单和与订单有关的信息：/v2/conditional-cancellation/list。

对新的取消请求做出决定—确认或拒绝:

  * /v2/conditional-cancellation/approve — 确认rFBS取消请求。 订单将自动取消，钱将退还给买家。
  * /v2/conditional-cancellation/reject — 拒绝rFBS取消请求。 订单将保持相同的状态，并且需要交付给买方。


