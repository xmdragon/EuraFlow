/**
 * 汇率 Hook
 *
 * 从 global-settings 读取汇率信息，避免多个页面重复请求汇率 API
 * 汇率数据由后端定时任务更新，前端只需读取缓存值
 */
import { useQuery } from '@tanstack/react-query';

import { getGlobalSettings } from '@/services/ozon/api/settings';

export interface ExchangeRateData {
  /** 人民币 -> 卢布汇率 */
  cnyToRub: number | null;
  /** 卢布 -> 人民币汇率 */
  rubToCny: number | null;
  /** 汇率更新时间 */
  updatedAt: string | null;
  /** 是否加载中 */
  isLoading: boolean;
  /** 是否有错误 */
  isError: boolean;
}

/**
 * 获取汇率的 Hook
 *
 * 从 global-settings API 读取汇率，30分钟缓存
 *
 * @example
 * ```typescript
 * const { cnyToRub, rubToCny, isLoading } = useExchangeRate();
 *
 * // 计算卢布价格
 * const rubPrice = cnyPrice * (cnyToRub || 13);
 * ```
 */
export const useExchangeRate = (): ExchangeRateData => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['globalSettings'],
    queryFn: getGlobalSettings,
    staleTime: 30 * 60 * 1000, // 30分钟
    gcTime: 60 * 60 * 1000, // 1小时
  });

  const exchangeRate = data?.exchange_rate;

  return {
    cnyToRub: exchangeRate?.cny_to_rub ? parseFloat(exchangeRate.cny_to_rub) : null,
    rubToCny: exchangeRate?.rub_to_cny ? parseFloat(exchangeRate.rub_to_cny) : null,
    updatedAt: exchangeRate?.updated_at || null,
    isLoading,
    isError,
  };
};
