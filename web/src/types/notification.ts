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

export interface PostingNotificationData {
  posting_number: string;
  product_count?: number;
  total_price?: string;
  cancel_reason?: string;
  old_status?: string;
  new_status?: string;
  delivered_at?: string;
  timestamp: string;
}

export interface WebSocketNotification {
  type: 'connected' | 'ping' | 'pong' | 'chat.new_message' | 'chat.message_updated' | 'kuajing84.sync_completed' | 'posting.created' | 'posting.cancelled' | 'posting.status_changed' | 'posting.delivered';
  shop_id?: number;
  chat_id?: string;
  data?: ChatNotificationData | Kuajing84SyncNotificationData | PostingNotificationData | any;
  timestamp?: string;
}

export interface WebSocketMessage {
  type: 'ping' | 'subscribe' | 'unsubscribe';
  shop_ids?: number[];
}
