# /v3/posting/fbs/list

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v3/posting/fbs/list`

## 详细信息

如果商品由法人订购，则可能无法立即收到付款，系统将预留商品。 要检查库存，请使用以下方法/v3/posting/fbs/get, /v3/posting/fbs/list 或/v3/posting/fbs/unfulfilled/list. 如果在回复中 `is_legal = true`,这意味着库存中有已预留的商品。 您可以更新库存，使新的商品数量大于可用库存和预留商品的总数量。 系统将注销旧库存并计算新的库存。

为检查预留商品，请使用方式 /v1/product/info/stocks-by-warehouse/fbs 或 /v4/product/info/stocks。

[库存更改详情](https://docs.ozon.ru/global/zh-hans/fulfillment/stock/)
