import { useCallback } from 'react';
import { useAuth } from './useAuth';

interface Shop {
  shop_name: string;
  shop_name_cn?: string | null;
}

/**
 * 店铺名称格式化 Hook
 * 根据用户设置格式化店铺名称显示
 *
 * 数据来源：从 useAuth 获取（/me 接口已合并返回 settings）
 *
 * @example
 * ```typescript
 * const { shopNameFormat, formatShopName, getShortName, getFullName } = useShopNameFormat();
 *
 * // 格式化店铺名称（根据用户设置）
 * <span>{formatShopName(shop)}</span>
 *
 * // 获取短名称（用于紧凑显示）
 * <span>{getShortName(shop)}</span>
 *
 * // 获取完整名称（用于下拉展开）
 * <span>{getFullName(shop)}</span>
 * ```
 */
export const useShopNameFormat = () => {
  const { settings } = useAuth();

  // 默认显示格式：both（俄文【中文】）
  const shopNameFormat = settings?.display?.shop_name_format || 'both';

  /**
   * 根据用户设置格式化店铺名称
   * @param shop - 店铺对象（包含 shop_name 和 shop_name_cn）
   * @returns 格式化后的店铺名称
   */
  const formatShopName = useCallback(
    (shop: Shop | null | undefined): string => {
      if (!shop) return '-';

      const { shop_name, shop_name_cn } = shop;

      switch (shopNameFormat) {
        case 'ru':
          return shop_name;
        case 'cn':
          return shop_name_cn || shop_name; // 如果没有中文名，回退到俄文
        case 'both':
        default:
          return shop_name_cn ? `${shop_name}【${shop_name_cn}】` : shop_name;
      }
    },
    [shopNameFormat]
  );

  /**
   * 获取短名称（用于紧凑显示，如选中状态）
   * @param shop - 店铺对象
   * @returns 短名称
   */
  const getShortName = useCallback(
    (shop: Shop | null | undefined): string => {
      if (!shop) return '-';

      const { shop_name, shop_name_cn } = shop;

      switch (shopNameFormat) {
        case 'ru':
          return shop_name;
        case 'cn':
          return shop_name_cn || shop_name;
        case 'both':
        default:
          // 紧凑显示时优先用中文名
          return shop_name_cn || shop_name;
      }
    },
    [shopNameFormat]
  );

  /**
   * 获取完整名称（用于下拉展开）
   * @param shop - 店铺对象
   * @returns 完整名称
   */
  const getFullName = useCallback(
    (shop: Shop | null | undefined): string => {
      if (!shop) return '-';

      const { shop_name, shop_name_cn } = shop;

      switch (shopNameFormat) {
        case 'ru':
          return shop_name;
        case 'cn':
          return shop_name_cn || shop_name;
        case 'both':
        default:
          return shop_name_cn ? `${shop_name}【${shop_name_cn}】` : shop_name;
      }
    },
    [shopNameFormat]
  );

  return {
    shopNameFormat,
    formatShopName,
    getShortName,
    getFullName,
  };
};
