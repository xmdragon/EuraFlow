# /v5/product/info/prices

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v5/product/info/prices`

## 详细信息

如需更新库存，请使用方法 /v2/products/stocks。在该方法中额外指定必须要更改的库存ID。 

为获得库存量的信息，请使用 v1/product/info/stocks-by-warehouse/fbs。

为更新商品价格而不更改商品卡片， 请使用 /v1/product/import/prices。

方法允许您更新商品价格：

  * 折扣前，
  * 对 Ozon Premium 的订阅者，
  * 在商品卡片上，考虑到折扣，
  * 使用活动价后的最低商品价。

如果您将不同类型的促销用于同一商品，商品价格可能会低于最低价。 

有关商品价格、佣金和折扣的信息，请使用 /v5/product/info/prices。
