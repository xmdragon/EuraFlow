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

export interface Kuajing84SyncNotificationData {
  sync_log_id: number;
  sync_type: 'submit_tracking' | 'discard_order';
  status: 'success' | 'failed';
  order_number: string;
  logistics_order?: string;
  error_message?: string;
  message: string;
}

export interface WebSocketNotification {
  type: 'connected' | 'ping' | 'pong' | 'chat.new_message' | 'chat.message_updated' | 'kuajing84.sync_completed';
  shop_id?: number;
  chat_id?: string;
  data?: ChatNotificationData | Kuajing84SyncNotificationData | any;
  timestamp?: string;
}

export interface WebSocketMessage {
  type: 'ping' | 'subscribe' | 'unsubscribe';
  shop_ids?: number[];
}
