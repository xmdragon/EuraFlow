# /v5/fbs/posting/product/exemplar/status

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v5/fbs/posting/product/exemplar/status`

## 详细信息

异步方法：

  * 检查在“诚信标志”系统中流通份数的存在性；
  * 保存份数数据。



为了获取已创建样件的数据，请使用 /v6/fbs/posting/product/exemplar/create-or-get 方式。

如果您在一批货件中有多个相同的商品, 请为货件中的每个商品指出一个 `product_id` 和一组 `exemplars`。

请始终传输全套份数和商品数据。

例如，如果在您的系统里有10份。您已赋值并检查和储存。然后在自己的系统中还添加了60份。 当重新提交份数以供审查和保存时，请指出所有新旧份数。

响应代码200并不保证商品数据已被接受。 它表示已创建任务以添加信息。 要检查任务状态，请使用方法 /v5/fbs/posting/product/exemplar/status。

您可以在 [讨论](https://dev.ozon.ru/community/1269-Metody-dlia-raboty-so-spiskom-markirovok-FBS-rFBS) 的评论中对此方法提供反馈 在 Ozon for dev 开发者社区中。
