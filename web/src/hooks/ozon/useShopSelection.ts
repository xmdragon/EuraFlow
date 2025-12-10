/**
 * 店铺选择 Hook
 * 统一管理店铺选择状态和 localStorage 持久化
 *
 * 注意：此 hook 会从 localStorage 读取上次选择的店铺 ID，
 * 但不会验证该店铺是否仍然可用。验证逻辑在 ShopSelector 组件中进行。
 * 因此，使用此 hook 时应确保同时渲染 ShopSelector 组件。
 */
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getShops } from '@/services/ozon';

export interface UseShopSelectionOptions {
  /**
   * localStorage 存储键名
   * @default 'ozon_selected_shop'
   */
  persistKey?: string;

  /**
   * 是否启用持久化
   * @default true
   */
  persist?: boolean;

  /**
   * 初始值（当 localStorage 中没有值时使用）
   * @default null
   */
  initialValue?: number | null;

  /**
   * 是否验证店铺有效性（需要额外的 API 请求）
   * @default true
   */
  validateShop?: boolean;
}

export interface UseShopSelectionReturn {
  /**
   * 当前选中的店铺 ID（已验证有效）
   */
  selectedShop: number | null;

  /**
   * 设置选中的店铺 ID
   */
  setSelectedShop: (shopId: number | null) => void;

  /**
   * 处理店铺选择变化的回调（适用于 ShopSelector 组件）
   * 自动处理数组/单值/null 的归一化
   */
  handleShopChange: (shopId: number | number[] | null) => void;

  /**
   * 店铺列表是否正在加载
   */
  isLoading: boolean;

  /**
   * 可用的店铺列表
   */
  shops: Array<{ id: number; shop_name: string; shop_name_cn?: string; display_name?: string }>;
}

/**
 * 店铺选择 Hook
 *
 * @example
 * ```typescript
 * // 基础使用（带持久化）
 * const { selectedShop, handleShopChange } = useShopSelection();
 *
 * // 不持久化
 * const { selectedShop, setSelectedShop } = useShopSelection({ persist: false });
 *
 * // 自定义持久化键
 * const { selectedShop, handleShopChange } = useShopSelection({
 *   persistKey: 'my_shop_key'
 * });
 *
 * // 配合 ShopSelector 使用
 * <ShopSelector value={selectedShop} onChange={handleShopChange} />
 * ```
 */
export const useShopSelection = (
  options: UseShopSelectionOptions = {}
): UseShopSelectionReturn => {
  const {
    persistKey = 'ozon_selected_shop',
    persist = true,
    initialValue = null,
    validateShop = true,
  } = options;

  // 获取店铺列表用于验证
  const { data: shopsData, isLoading } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: () => getShops(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: validateShop,
  });

  const shops = shopsData?.data || [];

  // 初始化状态：优先从 localStorage 读取（但会在 useEffect 中验证）
  const [selectedShop, setSelectedShopInternal] = useState<number | null>(() => {
    if (!persist) {
      return initialValue;
    }

    try {
      const saved = localStorage.getItem(persistKey);
      if (saved && saved !== 'all') {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      console.error(`Failed to load shop selection from localStorage (${persistKey}):`, error);
    }

    return initialValue;
  });

  // 验证选中的店铺是否在可用列表中
  useEffect(() => {
    if (!validateShop || isLoading) {
      return;
    }

    // 如果没有店铺，清除选择
    if (shops.length === 0) {
      if (selectedShop !== null) {
        setSelectedShopInternal(null);
        if (persist) {
          localStorage.removeItem(persistKey);
        }
      }
      return;
    }

    // 如果选中的店铺不在可用列表中，清除或选择第一个
    if (selectedShop !== null && !shops.find((s) => s.id === selectedShop)) {
      console.warn(`店铺 ${selectedShop} 不在授权列表中，自动清除`);
      if (persist) {
        localStorage.removeItem(persistKey);
      }
      setSelectedShopInternal(null);
    }
  }, [shops, selectedShop, isLoading, validateShop, persist, persistKey]);

  // 包装 setSelectedShop，同时更新 localStorage
  const setSelectedShop = useCallback((shopId: number | null) => {
    setSelectedShopInternal(shopId);
    if (persist) {
      try {
        if (shopId !== null) {
          localStorage.setItem(persistKey, shopId.toString());
        } else {
          localStorage.removeItem(persistKey);
        }
      } catch (error) {
        console.error(`Failed to save shop selection to localStorage (${persistKey}):`, error);
      }
    }
  }, [persist, persistKey]);

  /**
   * 处理店铺选择变化
   * 自动归一化不同输入格式：
   * - number | null → 直接使用
   * - number[] → 取第一个元素
   * - [] → null
   */
  const handleShopChange = useCallback((shopId: number | number[] | null) => {
    if (Array.isArray(shopId)) {
      // 数组：取第一个，空数组视为 null
      setSelectedShop(shopId.length > 0 ? shopId[0] : null);
    } else {
      // 单值或 null
      setSelectedShop(shopId ?? null);
    }
  }, [setSelectedShop]);

  // 返回验证后的店铺 ID：如果正在加载或店铺无效，返回 null
  const validatedShop = isLoading ? null : (
    selectedShop !== null && shops.find((s) => s.id === selectedShop) ? selectedShop : null
  );

  return {
    selectedShop: validatedShop,
    setSelectedShop,
    handleShopChange,
    isLoading,
    shops,
  };
};
