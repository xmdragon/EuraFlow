# /v2/chat/read

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v2/chat/read`

## 详细信息

要获取聊天列表，请使用 /v3/chat/list。 响应将包含当前聊天和最近消息的ID。

要通过聊天ID发送消息，请使用以下方法:

  * /v1/chat/send/message — 用于发送短信。
  * /v1/chat/send/file — 用于发送文件和图片。



要通过聊天ID或消息获取聊天历史记录，请使用 /v3/chat/history 默认的排序方向是从新邮件到旧邮件。

如果指定消息ID，则聊天记录将从此消息开始。

按照出发号码创建与买家的新聊天,请使用 /v1/chat/start。

将消息及其之前的所有消息标记为已读,请使用 /v2/chat/read。
