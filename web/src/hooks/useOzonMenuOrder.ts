import { useCallback } from 'react';
import { useUserStorageState } from './useUserStorage';

const STORAGE_KEY = 'ozonMenuOrder';

// 默认顺序（按用户要求）
const DEFAULT_ORDER = [
  'ozon-overview',           // 店铺概览
  'ozon-packing',            // 打包发货
  'ozon-orders',             // 订单管理
  'ozon-products-list',      // 商品列表
  'ozon-reports',            // 订单报表
  'ozon-selection',          // 选品助手
  'ozon-listing-records',    // 上架记录
  'ozon-collection-records', // 采集记录
  'ozon-stock',              // 库存管理
  'ozon-cancel-return',      // 取消退货
  'ozon-finance-transactions', // 财务记录
  'ozon-warehouses',         // 仓库列表
  'ozon-promotions',         // 促销活动
  'ozon-chats',              // 聊天管理
];

/**
 * OZON 菜单顺序管理 Hook
 * 使用 localStorage 永久存储菜单排序数据（按用户隔离）
 */
export const useOzonMenuOrder = () => {
  const [menuOrder, setMenuOrder] = useUserStorageState<string[]>(STORAGE_KEY, DEFAULT_ORDER);

  // 确保所有默认菜单项都存在（处理新增菜单项的情况）
  const normalizedOrder = (() => {
    const validOrder = menuOrder.filter(key => DEFAULT_ORDER.includes(key));
    const missingItems = DEFAULT_ORDER.filter(key => !menuOrder.includes(key));
    return [...validOrder, ...missingItems];
  })();

  // 上移菜单项
  const moveUp = useCallback((key: string) => {
    setMenuOrder((prev) => {
      // 先规范化
      const validOrder = prev.filter(k => DEFAULT_ORDER.includes(k));
      const missingItems = DEFAULT_ORDER.filter(k => !prev.includes(k));
      const currentOrder = [...validOrder, ...missingItems];

      const index = currentOrder.indexOf(key);
      if (index > 0) {
        const newOrder = [...currentOrder];
        [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
        return newOrder;
      }
      return currentOrder;
    });
  }, [setMenuOrder]);

  // 重置为默认顺序
  const resetOrder = useCallback(() => {
    setMenuOrder(DEFAULT_ORDER);
  }, [setMenuOrder]);

  return { menuOrder: normalizedOrder, moveUp, resetOrder };
};
