# Webhook测试工具

## 问题总结

聊天消息webhook接收成功(HTTP 200)，但消息未保存到数据库。

## 已完成

✅ **修复消息数据解析** - commit: 918f514
- 消息内容从 `data[0]` 获取（之前错误地从 `text` 字段获取）
- 发送者信息从 `user` 对象获取
- 正确规范化 `sender_type` 和 `chat_type`

✅ **测试工具**
- `scripts/test_chat_webhook_simple.py` - 模拟OZON发送webhook
- `scripts/check_messages.py` - 查询聊天消息
- `scripts/check_webhook_events.py` - 查询webhook事件

## 测试步骤

### 1. 发送测试消息

```bash
# 基本测试
venv/bin/python3 scripts/test_chat_webhook_simple.py

# 自定义消息
venv/bin/python3 scripts/test_chat_webhook_simple.py "你好，这是测试消息"
```

### 2. 检查消息是否保存

```bash
# 查看聊天消息
venv/bin/python3 scripts/check_messages.py

# 查看webhook事件
venv/bin/python3 scripts/check_webhook_events.py
```

### 3. 查看后端日志

```bash
supervisorctl -c supervisord.conf tail -100 euraflow:backend stderr
```

## 当前状态

- ✅ Webhook接收端点正常工作 (返回HTTP 200)
- ✅ 消息数据解析逻辑已修复
- ❓ 需要确认消息是否正确保存到数据库

## OZON消息格式参考

```json
{
  "message_type": "TYPE_NEW_MESSAGE",
  "chat_id": "xxx",
  "chat_type": "Buyer_Seller",
  "message_id": "xxx",
  "created_at": "2022-07-18T20:58:04.528Z",
  "user": {
    "id": "115568",
    "type": "Customer"  // Customer, Support, NotificationUser
  },
  "data": ["消息文本（Markdown格式）"],
  "seller_id": "7"
}
```

## 字段映射

- `user.type` → `sender_type`:
  - `Customer` → `user` (买家)
  - `Support` → `support` (客服)
  - `NotificationUser` → `support` (Ozon通知)

- `chat_type`:
  - `Buyer_Seller` → `BUYER_SELLER`
  - `Seller_Support` → `SELLER_SUPPORT`
  - `Seller_Notification` → `SELLER_NOTIFICATION`
