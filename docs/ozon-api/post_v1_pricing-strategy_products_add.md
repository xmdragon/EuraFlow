# /v1/pricing-strategy/products/add

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/pricing-strategy/products/add`

## 详细信息

定价策略是一种工具，可根据其他在线商店和市场上类似商品的价格自动调整商品价格。

要设置定价策略，请执行以下操作：

  1. 请获取竞争对手列表：/v1/pricing-strategy/competitors/list。

  2. 请获取定价策略列表：/v1/pricing-strategy/list。

  3. 请创建您的策略：/v1/pricing-strategy/create，并设置系数，以便将商品价格与其他平台进行比较，价格可向上或向下调整。 要获取有关策略的信息，请使用方法 /v1/pricing-strategy/info。

  4. 请将商品添加到策略中：/v1/pricing-strategy/products/add。

您可以添加：

     * 通过/v1/product/import/prices 方法已设置最低价格的商品。 要检查价格，请使用方法 /v5/product/info/prices。
     * 没有关联到其他策略的商品。 要检查商品与策略的关联，请使用方法 /v1/pricing-strategy/strategy-ids-by-product-ids。

若要获取与策略绑定的商品列表，请使用方法 /v1/pricing-strategy/products/list, 要从策略中删除商品，请使用 —— /v1/pricing-strategy/products/delete。

  5. 请启用或禁用策略：/v1/pricing-strategy/status。




要更改所选竞争对手列表和策略名称，请使用方法 /v1/pricing-strategy/update。

要删除策略，请使用方法 /v1/pricing-strategy/delete。
