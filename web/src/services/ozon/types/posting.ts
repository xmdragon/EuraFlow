/**
 * OZON 发货单（Posting）类型定义
 *
 * 注意：基础的 Posting、PostingWithOrder 类型定义在 order.ts 中
 */

/**
 * 备货操作请求参数
 */
export interface PrepareStockRequest {
  purchase_price: string; // 进货价格（必填）
  source_platform?: string[]; // 采购平台列表（可选：1688/拼多多/咸鱼/淘宝/库存）
  order_notes?: string; // 订单备注（可选）
  sync_to_ozon?: boolean; // 是否同步到Ozon（可选，默认true）
}

/**
 * 更新业务信息请求参数
 */
export interface UpdateBusinessInfoRequest {
  purchase_price?: string; // 进货价格（可选）
  material_cost?: string; // 打包费用（可选）
  source_platform?: string[]; // 采购平台列表（可选）
  order_notes?: string; // 订单备注（可选）
}

/**
 * 提交国内物流单号请求参数（支持多单号）
 */
export interface SubmitDomesticTrackingRequest {
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（推荐）
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string; // [已废弃] 单个国内物流单号（兼容字段）
  order_notes?: string; // 订单备注（可选）
  sync_to_kuajing84?: boolean; // 是否同步到跨境巴士（默认false）
}

/**
 * 更新国内物流单号列表（用于修正错误单号）
 */
export interface UpdateDomesticTrackingRequest {
  domestic_tracking_numbers: string[]; // 完整的国内单号列表（会替换现有单号）
}

/**
 * 订单额外信息
 */
export interface OrderExtraInfo {
  purchase_price?: string;
  material_cost?: string;
  /** @deprecated 使用 domestic_tracking_numbers 代替 */
  domestic_tracking_number?: string;
  domestic_tracking_numbers?: string[]; // 国内物流单号列表（一对多关系）
  order_notes?: string;
  source_platform?: string;
}
