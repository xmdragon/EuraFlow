# /v3/posting/fbs/unfulfilled/list

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v3/posting/fbs/unfulfilled/list`

## 详细信息

  
订单创建通知可能会有延迟。 为了获取最新信息，请定期通过 POST /v3/posting/fbs/unfulfilled/list 方式来获取未处理货件列表。 

对于每个通知类型, Ozon都会向您的服务器地址发送REST-请求。您的服务器 应该回应 按照 REST API 标准。

类型 | 值  
---|---  
TYPE_PING | 在初始连接时和连接后定期检查服务器可用性状态  
TYPE_NEW_POSTING | 新的货件  
TYPE_POSTING_CANCELLED | 货件取消  
TYPE_STATE_CHANGED | 货件状态更改  
TYPE_CUTOFF_DATE_CHANGED | 货件发运日期更改  
TYPE_DELIVERY_DATE_CHANGED | 货件配送日期更改  
TYPE_CREATE_OR_UPDATE_ITEM | 商品创建和更新，或在此过程中发生的错误  
TYPE_CREATE_ITEM | 商品创建或商品创建错误  
TYPE_UPDATE_ITEM | 商品更新或更新错误  
TYPE_PRICE_INDEX_CHANGED | 商品价格指数的变化  
TYPE_STOCKS_CHANGED | 卖家仓库库存变化  
TYPE_NEW_MESSAGE | 新的聊天消息  
TYPE_UPDATE_MESSAGE | 聊天消息更改  
TYPE_MESSAGE_READ | 您的消息已被买家或客服阅读  
TYPE_CHAT_CLOSED | 聊天已关闭
