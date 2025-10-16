/**
 * 通知系统类型定义
 */

export interface ChatNotificationData {
  message_id: string;
  customer_name: string;
  message: string;
  order_number?: string;
  timestamp: string;
}

export interface WebSocketNotification {
  type: 'connected' | 'ping' | 'pong' | 'chat.new_message' | 'chat.message_updated';
  shop_id?: number;
  chat_id?: string;
  data?: ChatNotificationData | any;
  timestamp?: string;
}

export interface WebSocketMessage {
  type: 'ping' | 'subscribe' | 'unsubscribe';
  shop_ids?: number[];
}
