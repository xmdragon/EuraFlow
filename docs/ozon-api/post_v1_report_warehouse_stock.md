# /v1/report/warehouse/stock

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/report/warehouse/stock`

## 详细信息

请求任何报告时，首先返回用于文档创建代码。 在/v1/report/info的请求中发送它 — 报告文件和其他信息将在响应中返回。 要获取先前生成的报告列表，请使用 /v1/report/list。

获取报告的方法:

  * /v1/report/products/create — 包含商品数据的报告，例如，OZON ID、商品描述、价格、佣金或包装尺寸。
  * /v3/finance/transaction/list — 商家个人帐户中提供的交易报告。
  * /v4/product/info/price — 价格报告。
  * /v1/report/warehouse/stock — 库存报告。
  * /v2/report/returns/create — FBS和rFBS的商品退货报告。 该报告包含从买方接受的货物，准备接收或转移给卖方。
  * /v1/report/postings/create — 发货报告。
  * /v1/finance/cash-flow-statement/list — 财务报告。
  * /v1/report/discounted/create — 减价商品报告.


