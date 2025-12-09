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
 * 每日统计数据接口（合并 posting 数量和销售额）
 */
export interface DailyStats {
  dates: string[];
  shops: string[];
  counts: Record<string, Record<string, number>>;   // 每日每店铺 posting 数量
  revenue: Record<string, Record<string, string>>;  // 每日每店铺销售额（字符串保持精度）
  total_days: number;
  currency: string;  // 货币单位（RUB）
}
