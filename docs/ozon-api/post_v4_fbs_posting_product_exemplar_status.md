# /v4/fbs/posting/product/exemplar/status

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v4/fbs/posting/product/exemplar/status`

## 详细信息

异步方法：

  * 检查在“诚信标志”系统中流通份数的存在性；
  * 保存份数数据。



为了获取已创建样件的数据，请使用 /v5/fbs/posting/product/exemplar/create-or-get方式。

必要时请在`gtd`参数中指出货运报关单号。如果没有，请赋值 `is_gtd_absent = true`。

如果您在一批货件中有多个相同的商品, 请为货件中的每个商品指出一个 `product_id` 和一组`exemplars` 。

仅适用于状态为 `awaiting_packaging`（等待包装）的货件，否则会返回错误 `INVALID_POSTING_STATE`。

请始终传输全套份数和商品数据。

例如，如果在您的系统里有10份。您已赋值并检查和储存。然后在自己的系统中还添加了60份。 当重新提交份数以供审查和保存时，请指出所有新旧份数。

与 /v4/fbs/posting/product/exemplar/set 之间的区别为 — 您可以在请求中传达更多的样件信息。

响应代码200并不保证商品数据已被接受。 它表示已创建任务以添加信息。 要检查任务状态，请使用方法/v4/fbs/posting/product/exemplar/status。
