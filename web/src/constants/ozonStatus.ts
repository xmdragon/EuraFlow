/**
 * OZON 订单/商品状态常量
 * 统一管理所有 OZON 相关的状态映射和配置
 */

/**
 * 订单状态英文到中文的映射
 * 用于订单同步进度显示、订单列表等
 */
export const OZON_ORDER_STATUS_MAP: Record<string, string> = {
  // 核心状态（与 OZON 官网对齐）
  awaiting_packaging: '等待备货',
  awaiting_deliver: '等待发运',
  awaiting_registration: '等待注册',
  arbitration: '仲裁中',
  client_arbitration: '客户仲裁',
  delivering: '运输中',
  driver_pickup: '司机取货',
  delivered: '已签收',
  cancelled: '已取消',
  not_accepted: '未接受',
  sent_by_seller: '卖家已发',

  // 其他可能的状态（兼容旧数据）
  acceptance_in_progress: '接收中',
  awaiting_approval: '等待审批',
  awaiting_conditions: '等待条件满足',
  cancelled_with_items_not_received: '已取消（未收到商品）',
};

/**
 * 操作状态映射（用于打包发货页面）
 */
export const OZON_OPERATION_STATUS_MAP: Record<string, string> = {
  awaiting_stock: '等待备货',
  allocated: '已分配',
  assigned: '分配中',
  tracking_confirmed: '单号确认',
};

/**
 * 将英文状态转换为中文显示文本
 * @param status 英文状态
 * @param defaultText 默认文本（当状态未找到时返回）
 * @returns 中文状态文本
 */
export function getOrderStatusText(status: string, defaultText?: string): string {
  return OZON_ORDER_STATUS_MAP[status] || defaultText || status;
}

/**
 * 将英文操作状态转换为中文显示文本
 * @param status 英文操作状态
 * @param defaultText 默认文本（当状态未找到时返回）
 * @returns 中文状态文本
 */
export function getOperationStatusText(status: string, defaultText?: string): string {
  return OZON_OPERATION_STATUS_MAP[status] || defaultText || status;
}

/**
 * 取消申请状态映射
 */
export const OZON_CANCELLATION_STATE_MAP: Record<string, string> = {
  ALL: '全部',
  ON_APPROVAL: '待审批',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
};

/**
 * 取消申请发起人映射
 */
export const OZON_CANCELLATION_INITIATOR_MAP: Record<string, string> = {
  CLIENT: '买家',
  SELLER: '卖家',
  OZON: '平台',
  SYSTEM: '系统',
  DELIVERY: '配送方',
};

/**
 * 退货申请状态组映射（group_state）
 */
export const OZON_RETURN_GROUP_STATE_MAP: Record<string, string> = {
  approved: '已批准',
  arbitration: '仲裁中',
  delivering: '配送中',
  rejected: '已拒绝',
  utilization: '已处置',
};

/**
 * 退货申请详细状态映射（state）
 */
export const OZON_RETURN_STATE_MAP: Record<string, string> = {
  // 仲裁中
  CheckingStatus: '核查状态中',

  // 已拒绝
  CanceledByBuyer: '买家取消',

  // 已批准
  MoneyReturned: '已退款',
  PartialCompensationReturned: '已支付部分补偿',
  PartialCompensationReturnedByOzon: 'OZON已支付补偿',

  // 配送中
  OnWay: '在途',
  OnWayToOzon: '在途（返回OZON）',

  // 已处置
  UtilizedByOzon: '已由OZON销毁',
  UtilizingByOzon: 'OZON销毁处理中',
};

/**
 * 将取消申请状态转换为中文显示文本
 */
export function getCancellationStateText(state: string, defaultText?: string): string {
  return OZON_CANCELLATION_STATE_MAP[state] || defaultText || state;
}

/**
 * 将取消申请发起人转换为中文显示文本
 */
export function getCancellationInitiatorText(initiator: string, defaultText?: string): string {
  return OZON_CANCELLATION_INITIATOR_MAP[initiator] || defaultText || initiator;
}

/**
 * 将退货申请状态组转换为中文显示文本
 */
export function getReturnGroupStateText(groupState: string, defaultText?: string): string {
  return OZON_RETURN_GROUP_STATE_MAP[groupState] || defaultText || groupState;
}

/**
 * 将退货申请详细状态转换为中文显示文本
 */
export function getReturnStateText(state: string, defaultText?: string): string {
  return OZON_RETURN_STATE_MAP[state] || defaultText || state;
}
