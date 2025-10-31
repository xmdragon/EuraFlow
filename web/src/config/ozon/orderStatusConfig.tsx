/**
 * OZON 订单状态配置
 * 统一管理订单状态的颜色、文本、图标
 */
import React from 'react';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  TruckOutlined,
} from '@ant-design/icons';

export interface StatusConfig {
  color: string;
  text: string;
  icon: React.ReactNode;
}

export interface OperationStatusConfig {
  color: string;
  text: string;
}

/**
 * OZON 订单状态配置
 * 与OZON官网对齐的7个主状态 + 兼容旧状态
 */
export const ORDER_STATUS_CONFIG: Record<string, StatusConfig> = {
  // 【1】等待备货 - 订单刚创建，需要准备商品
  awaiting_packaging: {
    color: 'processing',
    text: '等待备货',
    icon: <ClockCircleOutlined />,
  },
  awaiting_registration: {
    color: 'processing',
    text: '等待备货', // 映射：等待注册 → 等待备货
    icon: <ClockCircleOutlined />,
  },
  acceptance_in_progress: {
    color: 'processing',
    text: '等待备货', // 映射：正在验收 → 等待备货
    icon: <SyncOutlined spin />,
  },
  awaiting_approve: {
    color: 'processing',
    text: '等待备货', // 映射：等待确认 → 等待备货
    icon: <ClockCircleOutlined />,
  },

  // 【2】等待发运 - 商品已备好，等待交给快递
  awaiting_deliver: {
    color: 'warning',
    text: '等待发运',
    icon: <TruckOutlined />,
  },

  // 【3】已准备发运 - FBS模式：卖家已发货但快递未取件
  sent_by_seller: {
    color: 'cyan',
    text: '已准备发运',
    icon: <TruckOutlined />,
  },

  // 【4】运输中 - 快递配送中
  delivering: {
    color: 'cyan',
    text: '运输中',
    icon: <TruckOutlined />,
  },
  driver_pickup: {
    color: 'cyan',
    text: '运输中', // 映射：司机处 → 运输中
    icon: <TruckOutlined />,
  },

  // 【5】有争议的 - 仲裁/纠纷
  arbitration: {
    color: 'warning',
    text: '有争议的',
    icon: <ClockCircleOutlined />,
  },
  client_arbitration: {
    color: 'warning',
    text: '有争议的', // 映射：快递客户仲裁 → 有争议的
    icon: <ClockCircleOutlined />,
  },

  // 【6】已签收 - 订单完成
  delivered: {
    color: 'success',
    text: '已签收',
    icon: <CheckCircleOutlined />,
  },

  // 【7】已取消 - 订单取消
  cancelled: {
    color: 'error',
    text: '已取消',
    icon: <CloseCircleOutlined />,
  },
  not_accepted: {
    color: 'error',
    text: '已取消', // 映射：分拣中心未接受 → 已取消
    icon: <CloseCircleOutlined />,
  },

  // -------- 以下为兼容旧数据的状态 --------
  pending: {
    color: 'processing',
    text: '等待备货', // 映射：待确认 → 等待备货
    icon: <ClockCircleOutlined />,
  },
  confirmed: {
    color: 'processing',
    text: '等待备货', // 映射：已确认 → 等待备货
    icon: <CheckCircleOutlined />,
  },
  processing: {
    color: 'processing',
    text: '等待备货', // 映射：处理中 → 等待备货
    icon: <SyncOutlined spin />,
  },
  shipped: {
    color: 'cyan',
    text: '运输中', // 映射：已发货 → 运输中
    icon: <TruckOutlined />,
  },
  awaiting_debit: {
    color: 'processing',
    text: '等待备货', // 映射：等待扣款 → 等待备货
    icon: <ClockCircleOutlined />,
  },
};

/**
 * 操作状态配置 - 用于打包发货流程的内部状态
 */
export const OPERATION_STATUS_CONFIG: Record<string, OperationStatusConfig> = {
  awaiting_stock: { color: 'default', text: '等待备货' },
  allocating: { color: 'processing', text: '分配中' },
  allocated: { color: 'warning', text: '已分配' },
  tracking_confirmed: { color: 'success', text: '单号确认' },
  printed: { color: 'success', text: '已打印' },
  shipping: { color: 'processing', text: '发货中' },
};

/**
 * 获取订单状态配置（向后兼容的函数）
 */
export const getOrderStatusConfig = (): Record<string, StatusConfig> => {
  return ORDER_STATUS_CONFIG;
};

/**
 * 获取操作状态配置（向后兼容的函数）
 */
export const getOperationStatusConfig = (): Record<string, OperationStatusConfig> => {
  return OPERATION_STATUS_CONFIG;
};
