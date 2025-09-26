# 取消货件的交付

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v2/posting/fbs/package-label`

## 详细信息

  1. 在开始处理货件之前，获取未处理订单（货件）列表: /v3/posting/fbs/unfulfilled/list。

如果买方为法人, 那么请在 `requirements` 的模块将有关于在未指出的订单中指出订单商品原产国的信息。 获取可供选择的国家/地区列表/v2/posting/fbs/product/country/list。 然后指出有关原产国的信息: /v2/posting/fbs/product/country/set。

您还可以收到订单（发货）列表: /v3/posting/fbs/list。 其允许您使用具有不同状态的过滤器获取所有订单。如果 `with` 段含有 `analytics_data`的值，甚至可以获取数据分析。

最初，通过API的所有订单都带有状态 `awaiting_packaging`。

  2. 获取更多订单信息:/v3/posting/fbs/get。

在 `requirements` 模块指出:

     * 哪些商品必须贴上标签;
     * 是否需要传送货物报关单的编号及该批货物的登记编号 — 该信息可使用以下方法获得 /v3/posting/fbs/list 和 /v3/posting/fbs/unfulfilled/list。

您还可以通过条形码获取其他信息: /v2/posting/fbs/get-by-barcode。

  3. 通过 /v5/fbs/posting/product/exemplar/set传输商品数据。 请创建商品样本并告知不需要强制性商品标志： `is_mandatory_mark_needed = false`。

  4. 在装配时间结束前，确认您已装配订单： /v4/posting/fbs/ship。

如有必要，请使用此方法将订单分成若干批次。 例如，如果订单中有多个商品，并且需要包装在不同的盒子中，放置一起不符合包装要求。




使用该方法后，商品状态将更改为 `awaiting_deliver`。

您可以使用该方法进行部分装配:/v4/posting/fbs/ship/package。

  5. 为每件订单打印标签，以便在Ozon系统中识别: /v2/posting/fbs/package-label。

  6. 如果您在送货方式设置中设置了将商品发送到送货服务的时间间隔，请将商品状态更改为 `sent_by_seller` — “由卖家发送”: /v2/fbs/posting/sent-by-seller。




将货件交付至送货服务。从“配送中”到"已送达"的所有状态都将由交付服务传输。

### 取消货件的交付

  1. 在任何阶段使用 /v2/posting/fbs/cancel-reason/list, 以获得取消订单的原因。
  2. 然后传递该列表和出发号： /v2/posting/fbs/cancel。



要取消货件中的部分商品，请使用 /v2/posting/fbs/product/cancel。

如果订单被买方取消，状态将更改为 `cancelled`。
