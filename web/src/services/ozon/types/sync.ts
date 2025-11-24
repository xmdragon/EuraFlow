/**
 * OZON 同步日志类型定义
 */

/**
 * 同步日志
 */
export interface SyncLog {
  id: number;
  shop_id: number;
  entity_type: string;
  sync_type: string;
  status: string;
  processed_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  error_message?: string;
  duration_ms?: number;
  started_at: string;
  completed_at?: string;
  created_at: string;
}
