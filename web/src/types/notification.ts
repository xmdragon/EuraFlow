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

export interface PostingNotificationData {
  posting_number: string;
  product_count?: number;
  total_price?: string;
  cancel_reason?: string;
  old_status?: string;
  new_status?: string;
  old_status_display?: string; // 旧状态中文显示
  new_status_display?: string; // 新状态中文显示
  delivered_at?: string;
  timestamp: string;
}

// 单设备登录通知数据
export interface SessionExpiredNotificationData {
  reason: 'new_login' | 'manual_logout' | 'admin_revoke';
  message: string;
  new_device_info?: string;
  new_ip_address?: string;
}

export interface WebSocketNotification {
  type:
    | 'connected'
    | 'ping'
    | 'pong'
    | 'chat.new_message'
    | 'chat.message_updated'
    | 'posting.created'
    | 'posting.cancelled'
    | 'posting.status_changed'
    | 'posting.delivered'
    | 'session_expired'; // 单设备登录：会话失效
  shop_id?: number;
  chat_id?: string;
  data?: ChatNotificationData | PostingNotificationData | SessionExpiredNotificationData | unknown;
  timestamp?: string;
}

export interface WebSocketMessage {
  type: 'ping' | 'subscribe' | 'unsubscribe';
  shop_ids?: number[];
}
