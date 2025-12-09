import { useState, useEffect, useCallback } from 'react';

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

export const useOzonMenuOrder = () => {
  const [menuOrder, setMenuOrder] = useState<string[]>(DEFAULT_ORDER);

  // 从 localStorage 加载
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[];
        // 确保所有默认菜单项都存在（处理新增菜单项的情况）
        const validOrder = parsed.filter(key => DEFAULT_ORDER.includes(key));
        const missingItems = DEFAULT_ORDER.filter(key => !parsed.includes(key));
        setMenuOrder([...validOrder, ...missingItems]);
      } catch {
        setMenuOrder(DEFAULT_ORDER);
      }
    }
  }, []);

  // 上移菜单项
  const moveUp = useCallback((key: string) => {
    setMenuOrder((prev) => {
      const index = prev.indexOf(key);
      if (index > 0) {
        const newOrder = [...prev];
        [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
        return newOrder;
      }
      return prev;
    });
  }, []);

  // 重置为默认顺序
  const resetOrder = useCallback(() => {
    setMenuOrder(DEFAULT_ORDER);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { menuOrder, moveUp, resetOrder };
};
