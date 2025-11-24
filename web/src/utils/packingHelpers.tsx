/**
 * 打包发货相关的配置和工具函数
 */
import React from 'react';
import { formatPriceWithFallback } from './currency';
import { ORDER_STATUS_CONFIG, OPERATION_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';

import styles from '../pages/ozon/PackingShipment.module.scss';

/**
 * 订单状态配置（向后兼容导出）
 * @deprecated 请使用 ORDER_STATUS_CONFIG from '@/config/ozon/orderStatusConfig'
 */
export const statusConfig = ORDER_STATUS_CONFIG;

/**
 * 操作状态配置（向后兼容导出）
 * @deprecated 请使用 OPERATION_STATUS_CONFIG from '@/config/ozon/orderStatusConfig'
 */
export const operationStatusConfig = OPERATION_STATUS_CONFIG;

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
  const match = text.match(/^(.+?)[(（](.+?)[)）]$/);
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
  const match = text.match(/^(.+?)[(（](.+?)[)）]$/);
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
