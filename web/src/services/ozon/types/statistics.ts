/**
 * OZON 统计类型定义
 */

/**
 * 统计数据结构
 */
export interface Statistics {
  products: {
    total: number;
    active: number;
    inactive: number;
    out_of_stock: number;
  };
  orders: {
    total: number;
    pending: number;
    processing: number;
    shipped: number;
    delivered: number;
    cancelled: number;
    by_ozon_status: Record<string, number>; // 按 OZON 状态分组的订单数
  };
  revenue: {
    yesterday: string; // 改为昨日销售额
    week: string;
    month: string;
  };
}

/**
 * 每日 Posting 统计数据接口
 */
export interface DailyPostingStats {
  dates: string[];
  shops: string[];
  data: Record<string, Record<string, number>>;
  total_days: number;
}

/**
 * 每日销售额统计数据接口
 */
export interface DailyRevenueStats {
  dates: string[];
  shops: string[];
  data: Record<string, Record<string, string>>;  // 销售额为字符串格式（保持精度）
  total_days: number;
  currency: string;  // 货币单位（RUB）
}
