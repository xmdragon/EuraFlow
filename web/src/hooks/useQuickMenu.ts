import { useState, useEffect, useCallback } from 'react';

export interface QuickMenuItem {
  key: string;
  label: string;
  icon?: string; // 序列化后的图标名称
  path: string;
}

const STORAGE_KEY = 'quickMenuItems';

/**
 * 快捷菜单管理 Hook
 * 使用 localStorage 永久存储快捷菜单数据
 */
export const useQuickMenu = () => {
  const [quickMenuItems, setQuickMenuItems] = useState<QuickMenuItem[]>([]);

  // 初始化：从 localStorage 加载
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items = JSON.parse(stored) as QuickMenuItem[];
        setQuickMenuItems(items);
      }
    } catch (error) {
      console.error('加载快捷菜单失败:', error);
    }
  }, []);

  // 添加快捷菜单项
  const addQuickMenu = useCallback((item: QuickMenuItem) => {
    setQuickMenuItems((prev) => {
      // 避免重复添加
      if (prev.some((i) => i.key === item.key)) {
        return prev;
      }
      const updated = [...prev, item];
      // 持久化到 localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // 删除快捷菜单项
  const removeQuickMenu = useCallback((key: string) => {
    setQuickMenuItems((prev) => {
      const updated = prev.filter((item) => item.key !== key);
      // 持久化到 localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // 检查是否已添加
  const isInQuickMenu = useCallback(
    (key: string) => {
      return quickMenuItems.some((item) => item.key === key);
    },
    [quickMenuItems]
  );

  return {
    quickMenuItems,
    addQuickMenu,
    removeQuickMenu,
    isInQuickMenu,
  };
};
