/**
 * 列配置管理 Hook
 * 管理表格列的可见性配置，支持localStorage持久化
 */
import { useState, useEffect } from 'react';

import { loggers } from '@/utils/logger';

export interface ColumnVisibility {
  sku?: boolean;
  info?: boolean;
  price?: boolean;
  stock?: boolean;
  status?: boolean;
  visibility?: boolean;
  created_at?: boolean;
  last_sync?: boolean;
  actions?: boolean;
  [key: string]: boolean | undefined;
}

const DEFAULT_COLUMNS: ColumnVisibility = {
  sku: true,
  info: true,
  price: true,
  stock: true,
  status: true,
  visibility: true,
  created_at: true,
  last_sync: true,
  actions: true, // 操作列始终显示
};

const STORAGE_KEY = 'ozon_product_visible_columns';

/**
 * 列配置管理 Hook
 * 从localStorage加载配置，并自动保存修改
 */
export const useColumnConfig = () => {
  // 列显示配置状态管理（从localStorage加载）
  const [visibleColumns, setVisibleColumns] = useState<ColumnVisibility>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        loggers.product.error('Failed to parse visible columns config:', e);
      }
    }
    // 默认显示所有列
    return DEFAULT_COLUMNS;
  });

  // Modal显示状态
  const [columnConfigVisible, setColumnConfigVisible] = useState(false);

  // 保存列配置到localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  // 列显示配置变更处理
  const handleColumnVisibilityChange = (key: string, visible: boolean) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [key]: visible,
    }));
  };

  // 打开配置Modal
  const openColumnConfig = () => {
    setColumnConfigVisible(true);
  };

  // 关闭配置Modal
  const closeColumnConfig = () => {
    setColumnConfigVisible(false);
  };

  return {
    visibleColumns,
    columnConfigVisible,
    handleColumnVisibilityChange,
    openColumnConfig,
    closeColumnConfig,
  };
};
