/**
 * 店铺选择 Hook
 * 统一管理店铺选择状态和 localStorage 持久化
 */
import { useState, useEffect, useCallback } from 'react';

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
}

export interface UseShopSelectionReturn {
  /**
   * 当前选中的店铺 ID
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
  } = options;

  // 初始化状态：优先从 localStorage 读取
  const [selectedShop, setSelectedShop] = useState<number | null>(() => {
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

  // 持久化到 localStorage
  useEffect(() => {
    if (!persist) {
      return;
    }

    try {
      if (selectedShop !== null) {
        localStorage.setItem(persistKey, selectedShop.toString());
      } else {
        localStorage.removeItem(persistKey);
      }
    } catch (error) {
      console.error(`Failed to save shop selection to localStorage (${persistKey}):`, error);
    }
  }, [selectedShop, persistKey, persist]);

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
  }, []);

  return {
    selectedShop,
    setSelectedShop,
    handleShopChange,
  };
};
