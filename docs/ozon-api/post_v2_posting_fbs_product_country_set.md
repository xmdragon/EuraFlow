# /v2/posting/fbs/product/country/set

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v2/posting/fbs/product/country/set`

## 详细信息

  1. 在开始处理发货前，获取待处理订单（发货）列表： /v3/posting/fbs/unfulfilled/list。

如果买方为法人, 那么在 `requirements` 的模块将有关于在未指出的订单中指出订单商品原产国的信息。 获取可供选择的国家/地区列表 /v2/posting/fbs/product/country/list 然后指出有关原产国的信息:/v2/posting/fbs/product/country/set。

您还可以收到订单（发货）列表: /v3/posting/fbs/list。 其允许您使用具有不同状态的过滤器获取所有订单。如果 `with` 段含有 `analytics_data`的值，甚至可以获取数据分析。

最初，通过API的所有订单都带有状态 `awaiting_packaging`。

如果`available_actions`参数中显示`set_cutoff`，请使用方法 /v1/posting/cutoff/set 来确认发运日期。请确保在参数`shipment_date`指定的日期之前完成操作，该日期可通过以下方法获取： /v3/posting/fbs/unfulfilled/list、/v3/posting/fbs/list 或 /v3/posting/fbs/get。 在`shipment_date`日期之后，将无法更新货件日期或进行货件备货操作。

  2. 获取更多订单信息: /v3/posting/fbs/get。

在 `requirements` 模块指出：

     * 哪些商品必须贴上标签;
     * 是否需要传送货物报关单的编号及该批货物的登记编号 — 该信息可使用以下方法获得 /v3/posting/fbs/list。 和 /v3/posting/fbs/unfulfilled/list。

您还可以通过条形码获取其他信息: /v2/posting/fbs/get-by-barcode。

  3. 通过 /v5/fbs/posting/product/exemplar/set传输商品数据。 请创建商品样本并告知不需要强制性商品标志： `is_mandatory_mark_needed = false`。

  4. 在装配时间结束前，确认您已装配订单：/v4/posting/fbs/ship。

如有必要，请使用此方法将订单分成若干批次。 例如，如果订单中有多个商品，并且需要包装在不同的盒子中，放置一起不符合包装要求。

使用该方法后，商品状态将更改为 `awaiting_deliver`。

您可以使用该方法进行部分装配: /v4/posting/fbs/ship/package。

  5. 如果您在送货方式设置中设置了将商品发送到送货服务的时间间隔，请将商品状态更改为 `sent_by_seller` — “由卖家发送”: /v2/fbs/posting/sent-by-seller。

  6. 将商品发送到送货服务后，将商品状态更改为 `delivering` — “配送中”: /v2/fbs/posting/delivering。

  7. 与此同时，如果商品有追踪号，请将其发送: /v2/fbs/posting/tracking-number/set。

  8. 当快递员前往买家时，将出发状态更改为“最后一英里”: /v2/fbs/posting/last-mile。

  9. 当快递员已将商品交付给买家时，将状态更改为“已送达”: /v2/fbs/posting/delivered。



