# /v1/actions/discounts-task/list

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/actions/discounts-task/list`

## 详细信息

为推广商品，请参加Ozon为买家举办的促销活动中。

  * 获取可用促销列表: /v1/actions。
  * 获取可参与促销的商品列表： /v1/actions/candidates。
  * 请将商品添加到促销中： /v1/actions/products/activate。
  * 获取参与促销的商品列表： /v1/actions/products。
  * 从促销活动中删除商品： /v1/actions/products/deactivate。



买家可能会要求您为商品打折。 要获取买家想要以折扣价购买的商品列表，请使用方法 /v1/actions/discounts-task/list。 处于`NEW` （新的）或者 `SEEN` （已查看的） 状态的申请您可以：

  * 批准 — 请使用方法 /v1/actions/discounts-task/approve，
  * 取消 — 请使用方法 /v1/actions/discounts-task/decline。



[有关促销的更多信息详见卖家知识库](https://seller-edu.ozon.ru/docs/how-to-sell-effectively/promo/promo.html)
