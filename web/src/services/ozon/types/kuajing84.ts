/**
 * 跨境巴士类型定义
 */

/**
 * 跨境巴士配置
 */
export interface Kuajing84Config {
  enabled: boolean;
  username?: string;
  base_url?: string;
  has_cookie?: boolean;
}

/**
 * 跨境巴士配置请求
 */
export interface Kuajing84ConfigRequest {
  username: string;
  password: string;
  enabled: boolean;
}

/**
 * 跨境巴士同步日志
 */
export interface Kuajing84SyncLog {
  id: number;
  order_number: string;
  logistics_order: string;
  kuajing84_oid?: string;
  sync_status: "pending" | "success" | "failed";
  error_message?: string;
  attempts: number;
  created_at: string;
  synced_at?: string;
}
