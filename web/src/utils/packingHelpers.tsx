/**
 * 打包发货相关的配置和工具函数
 */
import React from 'react';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { formatPriceWithFallback } from './currency';

import styles from '../pages/ozon/PackingShipment.module.scss';

/**
 * OZON 订单状态配置
 * 与OZON官网对齐的7个主状态 + 兼容旧状态
 */
export const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
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
export const operationStatusConfig: Record<string, { color: string; text: string }> = {
  awaiting_stock: { color: 'default', text: '等待备货' },
  allocating: { color: 'processing', text: '分配中' },
  allocated: { color: 'warning', text: '已分配' },
  tracking_confirmed: { color: 'success', text: '单号确认' },
  printed: { color: 'success', text: '已打印' },
  shipping: { color: 'processing', text: '发货中' },
};

/**
 * 统一的价格格式化函数（移除货币符号）
 */
export const formatPackingPrice = (price: string | number, userCurrency: string): string => {
  // 移除所有可能的货币符号
  return formatPriceWithFallback(price, null, userCurrency)
    .replace(/^[¥₽$€£]/g, '')
    .trim();
};

/**
 * 格式化配送方式文本（用于深色背景显示）
 */
export const formatDeliveryMethodText = (text: string | undefined): React.ReactNode => {
  if (!text) return '-';

  // 如果包含括号，提取括号内的内容
  const match = text.match(/^(.+?)[\(（](.+?)[\)）]$/);
  if (!match) return text;

  const mainPart = match[1].trim();
  const detailPart = match[2].trim();

  // 解析限制信息为三行：重量、价格、体积
  const parseRestrictions = (restriction: string): string[] => {
    // 移除"限制:"前缀
    const content = restriction.replace(/^限制[:：]\s*/, '');

    // 使用正则提取三个部分
    const weightMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[克公斤kgг]+)/);
    const priceMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[₽рублей]+)/);
    const sizeMatch = content.match(/([\d\s×xXх]+\s*[厘米смcm]+)/);

    const lines: string[] = [];
    if (restriction.includes('限制')) lines.push('限制:');
    if (weightMatch) lines.push(weightMatch[1].trim());
    if (priceMatch) lines.push(priceMatch[1].trim());
    if (sizeMatch) lines.push(sizeMatch[1].trim());

    return lines.length > 0 ? lines : [restriction];
  };

  const restrictionLines = parseRestrictions(detailPart);

  // 格式化显示
  return (
    <div className={styles.deliveryMethodText}>
      <div className={styles.deliveryMethodMain}>{mainPart}</div>
      <div className={styles.deliveryMethodDetail} style={{ color: '#fff' }}>
        {restrictionLines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
};

/**
 * 格式化配送方式文本（用于白色背景显示）
 */
export const formatDeliveryMethodTextWhite = (text: string | undefined): React.ReactNode => {
  if (!text) return '-';

  // 如果包含括号，提取括号内的内容
  const match = text.match(/^(.+?)[\(（](.+?)[\)）]$/);
  if (!match) return text;

  const mainPart = match[1].trim();
  const detailPart = match[2].trim();

  // 解析限制信息为三行：重量、价格、体积
  const parseRestrictions = (restriction: string): string[] => {
    // 移除"限制:"前缀
    const content = restriction.replace(/^限制[:：]\s*/, '');

    // 使用正则提取三个部分
    const weightMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[克公斤kgг]+)/);
    const priceMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[₽рублей]+)/);
    const sizeMatch = content.match(/([\d\s×xXх]+\s*[厘米смcm]+)/);

    const lines: string[] = [];
    if (restriction.includes('限制')) lines.push('限制:');
    if (weightMatch) lines.push(weightMatch[1].trim());
    if (priceMatch) lines.push(priceMatch[1].trim());
    if (sizeMatch) lines.push(sizeMatch[1].trim());

    return lines.length > 0 ? lines : [restriction];
  };

  const restrictionLines = parseRestrictions(detailPart);

  // 格式化显示（白色背景）
  return (
    <div className={styles.deliveryMethodTextWhite}>
      <div>{mainPart}</div>
      {restrictionLines.map((line, index) => (
        <div
          key={index}
          style={{
            fontSize: '12px',
            color: 'rgba(0, 0, 0, 0.65)',
            marginTop: '2px',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};
