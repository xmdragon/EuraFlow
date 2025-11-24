/**
 * OZON 聊天类型定义
 */

/**
 * OZON 聊天
 */
export interface OzonChat {
  id: number;
  shop_id: number; // 聊天所属店铺ID
  chat_id: string;
  chat_type?: string;
  subject?: string;
  customer_id?: string;
  customer_name?: string;
  status: string;
  is_closed: boolean;
  is_archived?: boolean; // 是否已归档
  order_number?: string;
  product_id?: number;
  message_count: number;
  unread_count: number;
  last_message_at?: string;
  last_message_preview?: string;
  closed_at?: string;
  created_at: string;
  updated_at?: string;
  shop_name?: string; // 全部店铺模式下包含店铺名称
}

/**
 * OZON 聊天消息
 */
export interface OzonChatMessage {
  id: number;
  chat_id: string;
  message_id: string;
  message_type?: string;
  sender_type: string;
  sender_id?: string;
  sender_name?: string;
  content?: string;
  content_data?: unknown;
  data_cn?: string; // 中文翻译
  is_read: boolean;
  is_deleted: boolean;
  is_edited: boolean;
  order_number?: string;
  product_id?: number;
  read_at?: string;
  edited_at?: string;
  created_at: string;
}

/**
 * 聊天统计信息
 */
export interface ChatStats {
  total_chats: number;
  active_chats: number;
  total_unread: number;
  unread_chats: number;
}
