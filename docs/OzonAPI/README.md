# OZON Seller API 文档

共 166 个API接口

## API列表

### actions

- [从活动中删除商品](./从活动中删除商品.md) - `POST /v1/actions/products/deactivate`
- [参与 活动的商品列表](./参与 活动的商品列表.md) - `POST /v1/actions/products`
- [取消折扣申请](./取消折扣申请.md) - `POST /v1/actions/discounts-task/decline`
- [可用的促销商品清单](./可用的促销商品清单.md) - `POST /v1/actions/candidates`
- [同意折扣申请](./同意折扣申请.md) - `POST /v1/actions/discounts-task/approve`
- [在促销活动中增加一个商品](./在促销活动中增加一个商品.md) - `POST /v1/actions/products/activate`
- [活动清单](./活动清单.md) - `GET /v1/actions`
- [申请折扣列表](./申请折扣列表.md) - `POST /v1/actions/discounts-task/list`

### analytics

- [分析数据](./分析数据.md) - `POST /v1/analytics/data`
- [有关特定商品查询的信息](./有关特定商品查询的信息.md) - `POST /v1/analytics/product-queries/details`
- [获取商品搜索查询信息](./获取商品搜索查询信息.md) - `POST /v1/analytics/product-queries`
- [获取平均配送时间的分析数据](./获取平均配送时间的分析数据.md) - `POST /v1/analytics/average-delivery-time`
- [获取平均配送时间的总体分析](./获取平均配送时间的总体分析.md) - `POST /v1/analytics/average-delivery-time/summary`
- [获取平均配送时间的详细分析](./获取平均配送时间的详细分析.md) - `POST /v1/analytics/average-delivery-time/details`

### barcode

- [为商品绑定条形码](./为商品绑定条形码.md) - `POST /v1/barcode/add`
- [创建商品条形码](./创建商品条形码.md) - `POST /v1/barcode/generate`

### carriage

- [创建通行证](./创建通行证.md) - `POST /v1/carriage/pass/create`
- [删除通行证](./删除通行证.md) - `POST /v1/carriage/pass/delete`
- [发运删除](./发运删除.md) - `POST /v1/carriage/cancel`
- [发运组成商品更改](./发运组成商品更改.md) - `POST /v1/carriage/set-postings`
- [更新通行证](./更新通行证.md) - `POST /v1/carriage/pass/update`
- [运输信息](./运输信息.md) - `POST /v1/carriage/get`

### chat

- [创建新聊天](./创建新聊天.md) - `POST /v1/chat/start`
- [发送信息](./发送信息.md) - `POST /v1/chat/send/message`
- [发送文件](./发送文件.md) - `POST /v1/chat/send/file`
- [将信息标记为已读](./将信息标记为已读.md) - `POST /v2/chat/read`
- [聊天历史记录](./聊天历史记录.md) - `POSTV3 /v3/chat/history`
- [聊天清单](./聊天清单.md) - `POSTV3 /v3/chat/list`

### conditional-cancellation

- [拒绝 rFBS 取消申请](./拒绝 rFBS 取消申请.md) - `POST /v2/conditional-cancellation/reject`
- [确认 rFBS 取消申请](./确认 rFBS 取消申请.md) - `POST /v2/conditional-cancellation/approve`
- [获取 rFBS 取消申请列表](./获取 rFBS 取消申请列表.md) - `POST /v2/conditional-cancellation/list`

### delivery-method

- [仓库物流方式清单](./仓库物流方式清单.md) - `POST /v1/delivery-method/list`

### description-category

- [商品类别和类型的树形图](./商品类别和类型的树形图.md) - `POST /v1/description-category/tree`
- [根据属性的参考值进行搜索](./根据属性的参考值进行搜索.md) - `POST /v1/description-category/attribute/values/search`
- [特征值指南](./特征值指南.md) - `POST /v1/description-category/attribute/values`
- [类别特征列表](./类别特征列表.md) - `POST /v1/description-category/attribute`

### fbs

- [Обновить данные экземпляров](./Обновить данные экземпляров.md) - `POST /v1/fbs/posting/product/exemplar/update`
- [将状态改为“由卖家发送”](./将状态改为“由卖家发送”.md) - `POST /v2/fbs/posting/sent-by-seller`
- [将状态改成“已送达”](./将状态改成“已送达”.md) - `POST /v2/fbs/posting/delivered`
- [将状态改成“运输中”](./将状态改成“运输中”.md) - `POST /v2/fbs/posting/delivering`
- [标志代码验证](./标志代码验证.md) - `POST /v4/fbs/posting/product/exemplar/validate`
- [标志代码验证](./标志代码验证_v5.md) - `POST /v5/fbs/posting/product/exemplar/validate`
- [检查并保存份数数据](./检查并保存份数数据_v6.md) - `POST /v6/fbs/posting/product/exemplar/set`
- [检查并保存份数数据 (第5方案)](./检查并保存份数数据 (第5方案).md) - `POSTV5 /v5/fbs/posting/product/exemplar/set`
- [添加跟踪号](./添加跟踪号.md) - `POST /v2/fbs/posting/tracking-number/set`
- [状态改为“最后一英里”](./状态改为“最后一英里”.md) - `POST /v2/fbs/posting/last-mile`
- [获取商品实例信息](./获取商品实例信息.md) - `POST /v5/fbs/posting/product/exemplar/create-or-get`
- [获取已创建样件数据](./获取已创建样件数据.md) - `POST /v6/fbs/posting/product/exemplar/create-or-get`
- [获取样件添加状态](./获取样件添加状态.md) - `POST /v4/fbs/posting/product/exemplar/status`
- [获取样件添加状态](./获取样件添加状态_v5.md) - `POST /v5/fbs/posting/product/exemplar/status`

### finance

- [交易清单](./交易清单.md) - `POST /v3/finance/transaction/list`
- [商品销售报告 （第2版）](./商品销售报告 （第2版）.md) - `POST /v2/finance/realization`
- [按订单细分的商品销售报告](./按订单细分的商品销售报告.md) - `POST /v1/finance/realization/posting`
- [每日商品销售报告](./每日商品销售报告.md) - `POST /v1/finance/realization/by-day`
- [清单数目](./清单数目.md) - `POST /v3/finance/transaction/totals`
- [财务报告](./财务报告.md) - `POST /v1/finance/cash-flow-statement/list`
- [赔偿报告](./赔偿报告.md) - `POST /v1/finance/compensation`
- [赔偿返还报告](./赔偿返还报告.md) - `POST /v1/finance/decompensation`

### pass

- [通行证列表](./通行证列表.md) - `POST /v1/pass/list`

### polygon

- [创建一个快递的设施](./创建一个快递的设施.md) - `POST /v1/polygon/create`
- [将快递方式与快递设施联系起来](./将快递方式与快递设施联系起来.md) - `POST /v1/polygon/bind`

### posting

- [为货件中的称重商品添加重量](./为货件中的称重商品添加重量.md) - `POST /v2/posting/fbs/product/change`
- [取消某些商品发货](./取消某些商品发货.md) - `POST /v2/posting/fbs/product/cancel`
- [取消货运](./取消货运.md) - `POST /v2/posting/fbs/cancel`
- [可供运输的列表](./可供运输的列表.md) - `POST /v1/posting/carriage-available/list`
- [可用产地名单](./可用产地名单.md) - `POST /v2/posting/fbs/product/country/list`
- [将订单拆分为不带备货的货件](./将订单拆分为不带备货的货件.md) - `POST /v1/posting/fbs/split`
- [打印标签](./打印标签.md) - `POST /v2/posting/fbs/package-label`
- [按条形码获取有关货件的信息](./按条形码获取有关货件的信息.md) - `POST /v2/posting/fbs/get-by-barcode`
- [按照ID获取货件信息](./按照ID获取货件信息.md) - `POST /v3/posting/fbs/get`
- [搜集订单 (第4方案)](./搜集订单 (第4方案).md) - `POST /v4/posting/fbs/ship`
- [未处理货件列表](./未处理货件列表.md) - `POST /v3/posting/fbs/unfulfilled/list`
- [添加商品产地信息](./添加商品产地信息.md) - `POST /v2/posting/fbs/product/country/set`
- [确认货件发运日期](./确认货件发运日期.md) - `POST /v1/posting/cutoff/set`
- [货件列表](./货件列表.md) - `POST /v3/posting/fbs/list`
- [货件取消原因](./货件取消原因.md) - `POST /v2/posting/fbs/cancel-reason/list`
- [货件的部分装配 (第4方案)](./货件的部分装配 (第4方案).md) - `POST /v4/posting/fbs/ship/package`
- [货件装运](./货件装运.md) - `POST /v2/posting/fbs/awaiting-delivery`
- [货运取消原因](./货运取消原因.md) - `POST /v1/posting/fbs/cancel-reason`

### pricing-strategy

- [从策略中删除商品](./从策略中删除商品.md) - `POST /v1/pricing-strategy/products/delete`
- [创建策略](./创建策略.md) - `POST /v1/pricing-strategy/create`
- [删除策略](./删除策略.md) - `POST /v1/pricing-strategy/delete`
- [将商品添加到策略](./将商品添加到策略.md) - `POST /v1/pricing-strategy/products/add`
- [更改策略状态](./更改策略状态.md) - `POST /v1/pricing-strategy/status`
- [更新策略](./更新策略.md) - `POST /v1/pricing-strategy/update`
- [竞争对手  的商品价格](./竞争对手  的商品价格.md) - `POST /v1/pricing-strategy/product/info`
- [竞争对手名单](./竞争对手名单.md) - `POST /v1/pricing-strategy/competitors/list`
- [策略ID列表](./策略ID列表.md) - `POST /v1/pricing-strategy/strategy-ids-by-product-ids`
- [策略中的商品列表](./策略中的商品列表.md) - `POST /v1/pricing-strategy/products/list`
- [策略信息](./策略信息.md) - `POST /v1/pricing-strategy/info`
- [策略列表](./策略列表.md) - `POST /v1/pricing-strategy/list`

### product

- [上传或更新商品图片](./上传或更新商品图片.md) - `POST /v1/product/pictures/import`
- [为打折商品设置折扣](./为打折商品设置折扣.md) - `POST /v1/product/update/discount`
- [从卖家的系统中改变商品货号](./从卖家的系统中改变商品货号.md) - `POST /v1/product/update/offer-id`
- [从档案中还原商品](./从档案中还原商品.md) - `POST /v1/product/unarchive`
- [体积重量特征不正确的商品列表](./体积重量特征不正确的商品列表.md) - `POST /v1/product/info/wrong-volume`
- [关于卖家库存余额的信息](./关于卖家库存余额的信息.md) - `POST /v1/product/info/stocks-by-warehouse/fbs`
- [关于商品数量的信息](./关于商品数量的信息.md) - `POST /v4/product/info/stocks`
- [创建或更新商品](./创建或更新商品.md) - `POST /v3/product/import`
- [品列表的](./品列表的.md) - `POST /v3/product/list`
- [品类限制、商品的创建和更新](./品类限制、商品的创建和更新.md) - `POST /v4/product/info/limit`
- [将商品归档](./将商品归档.md) - `POST /v1/product/archive`
- [按SKU获得商品的内容排名](./按SKU获得商品的内容排名.md) - `POST /v1/product/rating-by-sku`
- [更新价格](./更新价格.md) - `POST /v1/product/import/prices`
- [更新商品特征](./更新商品特征.md) - `POST /v1/product/attributes/update`
- [最低价格时效性计时器更新](./最低价格时效性计时器更新.md) - `POST /v1/product/action/timer/update`
- [查询商品添加或更新状态](./查询商品添加或更新状态.md) - `POST /v1/product/import/info`
- [根据标识符获取商品信息](./根据标识符获取商品信息.md) - `POST /v3/product/info/list`
- [获取FBS和rFBS仓库库存信息](./获取FBS和rFBS仓库库存信息.md) - `POST /v1/product/info/warehouse/stocks`
- [获取商品价格信息](./获取商品价格信息.md) - `POST /v5/product/info/prices`
- [获取商品图片](./获取商品图片.md) - `POST /v2/product/pictures/info`
- [获取商品特征描述](./获取商品特征描述_v4.md) - `POST /v4/product/info/attributes`
- [获取商品详细信息](./获取商品详细信息.md) - `POST /v1/product/info/description`
- [获取已设置计时器状态](./获取已设置计时器状态.md) - `POST /v1/product/action/timer/status`
- [获取相关SKU](./获取相关SKU.md) - `POST /v1/product/related-sku/get`
- [订阅该商品的用户数](./订阅该商品的用户数.md) - `POST /v1/product/info/subscription`
- [通过SKU创建商品](./通过SKU创建商品.md) - `POST /v1/product/import-by-sku`
- [通过减价商品的SKU查找减价商品和主商品的信息](./通过减价商品的SKU查找减价商品和主商品的信息.md) - `POST /v1/product/info/discounted`

### products

- [从存档删除没有SKU的商品](./从存档删除没有SKU的商品.md) - `POST /v2/products/delete`
- [更新库存商品的数量](./更新库存商品的数量.md) - `POST /v2/products/stocks`
- [获取商品特征描述](./获取商品特征描述.md) - `POST /v3/products/info/attributes`

### report

- [关于FBS仓库库存报告](./关于FBS仓库库存报告.md) - `POST /v1/report/warehouse/stock`
- [减价商品报告](./减价商品报告.md) - `POST /v1/report/discounted/create`
- [发货报告](./发货报告.md) - `POST /v1/report/postings/create`
- [商品报告](./商品报告.md) - `POST /v1/report/products/create`
- [报告信息](./报告信息.md) - `POST /v1/report/info`
- [报告清单](./报告清单.md) - `POST /v1/report/list`
- [生成带有标记商品的销售报告](./生成带有标记商品的销售报告.md) - `POST /v1/report/marked-products-sales/create`

### return

- [创建退货通行证](./创建退货通行证.md) - `POST /v1/return/pass/create`
- [删除退货通行证](./删除退货通行证.md) - `POST /v1/return/pass/delete`
- [更新退货通行证](./更新退货通行证.md) - `POST /v1/return/pass/update`

### returns

- [FBO和FBS退货信息](./FBO和FBS退货信息.md) - `POST /v1/returns/list`
- [FBS退货数量](./FBS退货数量.md) - `POST /v1/returns/company/fbs/info`
- [传递 rFBS  退货的可用操作](./传递 rFBS  退货的可用操作.md) - `POST /v1/returns/rfbs/action/set`
- [向买家退款](./向买家退款.md) - `POST /v2/returns/rfbs/return-money`
- [批准退货申请](./批准退货申请.md) - `POST /v2/returns/rfbs/verify`
- [拒绝退货申请](./拒绝退货申请.md) - `POST /v2/returns/rfbs/reject`
- [确认收到待检查商品](./确认收到待检查商品.md) - `POST /v2/returns/rfbs/receive-return`
- [退货申请信息](./退货申请信息.md) - `POST /v2/returns/rfbs/get`
- [退货申请列表](./退货申请列表.md) - `POST /v2/returns/rfbs/list`
- [退还部分商品金额](./退还部分商品金额.md) - `POST /v2/returns/rfbs/compensate`

### review

- [删除对评价的评论](./删除对评价的评论.md) - `POST /v1/review/comment/delete`
- [对评价留下评论](./对评价留下评论.md) - `POST /v1/review/comment/create`
- [更改评价状态](./更改评价状态.md) - `POST /v1/review/change-status`
- [根据状态统计的评价数量](./根据状态统计的评价数量.md) - `POST /v1/review/count`
- [获取评价信息](./获取评价信息.md) - `POST /v1/review/info`
- [获取评价列表](./获取评价列表.md) - `POST /v1/review/list`
- [评价的评论列表](./评价的评论列表.md) - `POST /v1/review/comment/list`

### roles

- [使用API密钥获取角色和方式列表](./使用API密钥获取角色和方式列表.md) - `POST /v1/roles`

### warehouse

- [仓库列表](./仓库列表.md) - `POST /v2/warehouse/list`
- [仓库清单](./仓库清单.md) - `POST /v1/warehouse/list`
- [创建仓库](./创建仓库.md) - `POST /v1/warehouse/fbs/create`
- [将仓库归档](./将仓库归档.md) - `POST /v1/warehouse/archive`
- [将仓库解除归档](./将仓库解除归档.md) - `POST /v1/warehouse/unarchive`
- [更新仓库](./更新仓库.md) - `POST /v1/warehouse/fbs/update`
- [更新头程物流](./更新头程物流.md) - `POST /v1/warehouse/fbs/first-mile/update`
- [获取操作状态](./获取操作状态.md) - `POST /v1/warehouse/operation/status`
- [获取用于修改仓库信息的揽收点列表](./获取用于修改仓库信息的揽收点列表.md) - `POST /v1/warehouse/fbs/update/drop-off/list`
- [获取用于创建drop-off发运仓库的时间段列表](./获取用于创建drop-off发运仓库的时间段列表.md) - `POST /v1/warehouse/fbs/create/drop-off/timeslot/list`
- [获取用于创建pick-up发运仓库的时间段列表](./获取用于创建pick-up发运仓库的时间段列表.md) - `POST /v1/warehouse/fbs/create/pick-up/timeslot/list`
- [获取用于创建仓库的揽收点列表](./获取用于创建仓库的揽收点列表.md) - `POST /v1/warehouse/fbs/create/drop-off/list`
- [获取用于更新drop-off发运仓库的时间段列表](./获取用于更新drop-off发运仓库的时间段列表.md) - `POST /v1/warehouse/fbs/update/drop-off/timeslot/list`
- [获取用于更新pick-up发运仓库的时间段列表](./获取用于更新pick-up发运仓库的时间段列表.md) - `POST /v1/warehouse/fbs/update/pick-up/timeslot/list`

### 其他

- [检查并保存份数数据](./检查并保存份数数据.md) - `POST `
- [聊天历史记录](./聊天历史记录_1.md) - `POST `
- [聊天清单](./聊天清单_1.md) - `POST `
