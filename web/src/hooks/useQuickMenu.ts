import { useCallback } from 'react';
import { useUserStorageState } from './useUserStorage';

export interface QuickMenuItem {
  key: string;
  label: string;
  icon?: string; // 序列化后的图标名称
  path: string;
}

const STORAGE_KEY = 'quickMenuItems';

/**
 * 快捷菜单管理 Hook
 * 使用 localStorage 永久存储快捷菜单数据（按用户隔离）
 */
export const useQuickMenu = () => {
  const [quickMenuItems, setQuickMenuItems] = useUserStorageState<QuickMenuItem[]>(STORAGE_KEY, []);

  // 添加快捷菜单项
  const addQuickMenu = useCallback((item: QuickMenuItem) => {
    setQuickMenuItems((prev) => {
      // 避免重复添加
      if (prev.some((i) => i.key === item.key)) {
        return prev;
      }
      return [...prev, item];
    });
  }, [setQuickMenuItems]);

  // 删除快捷菜单项
  const removeQuickMenu = useCallback((key: string) => {
    setQuickMenuItems((prev) => prev.filter((item) => item.key !== key));
  }, [setQuickMenuItems]);

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
