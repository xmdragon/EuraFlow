/**
 * OZON 促销活动类型定义
 */

/**
 * 促销活动
 */
export interface PromotionAction {
  action_id: number;
  title: string;
  description?: string;
  date_start?: string;
  date_end?: string;
  candidates_count?: number;
  products_count?: number;
}
