/**
 * OZON Webhook 类型定义
 */

/**
 * Webhook 配置
 */
export interface WebhookConfig {
  shop_id: number;
  webhook_url?: string;
  webhook_secret?: string;
  webhook_enabled: boolean;
  supported_events: string[];
}

/**
 * Webhook 事件
 */
export interface WebhookEvent {
  id: number;
  event_id: string;
  event_type: string;
  shop_id: number;
  status: "pending" | "processing" | "processed" | "failed" | "ignored";
  is_verified: boolean;
  entity_type?: string;
  entity_id?: string;
  retry_count: number;
  error_message?: string;
  created_at: string;
  processed_at?: string;
  payload_summary?: {
    keys: string[];
    size: number;
  };
}
