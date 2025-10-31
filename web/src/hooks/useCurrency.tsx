import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getCurrencySymbol, formatCurrency as formatCurrencyUtil } from '../utils/currency';

interface UserSettings {
  display: {
    currency: string;
  };
}

/**
 * 货币 Hook
 * 统一管理货币设置和格式化
 *
 * @example
 * ```typescript
 * const { currency, symbol, formatPrice } = useCurrency();
 *
 * // 使用符号
 * <span>{symbol}{price}</span>
 *
 * // 格式化价格（自动使用用户货币）
 * <span>{formatPrice(price)}</span>
 * ```
 */
export const useCurrency = () => {
  const { data: settings } = useQuery<UserSettings>({
    queryKey: ['userSettings'],
    queryFn: async () => {
      const response = await fetch('/api/ef/v1/settings', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      if (!response.ok) throw new Error('获取用户设置失败');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 1,
  });

  // 默认 CNY（人民币）
  const currency = settings?.display?.currency || 'CNY';
  const symbol = getCurrencySymbol(currency);

  /**
   * 格式化价格，自动使用用户的货币符号
   * @param value - 价格值（支持 string、number 或 null/undefined）
   * @returns 格式化后的金额字符串（如：¥123.45 或 ₽456.78）
   */
  const formatPrice = useCallback(
    (value: string | number | null | undefined): string => {
      return formatCurrencyUtil(value, symbol);
    },
    [symbol]
  );

  return { currency, symbol, formatPrice };
};
