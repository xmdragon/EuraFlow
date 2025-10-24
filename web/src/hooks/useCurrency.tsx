import { useQuery } from '@tanstack/react-query';

import { getCurrencySymbol } from '../utils/currency';

interface UserSettings {
  display: {
    currency: string;
  };
}

/**
 * 获取用户设置的默认货币
 * @returns { currency: 货币代码, symbol: 货币符号 }
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

  return { currency, symbol };
};
