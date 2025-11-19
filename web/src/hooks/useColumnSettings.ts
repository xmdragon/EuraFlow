/**
 * 表格列配置 Hook
 * 用于管理表格列的显示/隐藏状态，支持 localStorage 持久化
 */
import { useState, useEffect, useMemo } from 'react';
import type { ColumnsType } from 'antd/es/table';

export interface ColumnConfig {
  key: string;
  title: string;
  visible: boolean;
  fixed?: boolean; // 是否固定显示（不可隐藏）
}

interface UseColumnSettingsOptions<T> {
  /**
   * 所有列的定义
   */
  columns: ColumnsType<T>;
  /**
   * localStorage 存储键名
   */
  storageKey: string;
  /**
   * 默认隐藏的列（可选）
   */
  defaultHiddenKeys?: string[];
}

/**
 * 表格列配置 Hook
 */
export function useColumnSettings<T>({
  columns,
  storageKey,
  defaultHiddenKeys = [],
}: UseColumnSettingsOptions<T>) {
  // 初始化列配置
  const initialConfig = useMemo(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const savedConfig = JSON.parse(saved) as Record<string, boolean>;
        return columns.map((col) => ({
          key: col.key as string,
          title: col.title as string,
          visible: savedConfig[col.key as string] ?? true,
          fixed: false,
        }));
      } catch {
        // 解析失败，使用默认配置
      }
    }

    // 没有保存的配置，使用默认配置
    return columns.map((col) => ({
      key: col.key as string,
      title: col.title as string,
      visible: !defaultHiddenKeys.includes(col.key as string),
      fixed: false,
    }));
  }, [columns, storageKey, defaultHiddenKeys]);

  const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>(initialConfig);

  // 保存到 localStorage
  useEffect(() => {
    const configMap = columnConfig.reduce((acc, col) => {
      acc[col.key] = col.visible;
      return acc;
    }, {} as Record<string, boolean>);

    localStorage.setItem(storageKey, JSON.stringify(configMap));
  }, [columnConfig, storageKey]);

  // 切换列的显示/隐藏
  const toggleColumn = (key: string) => {
    setColumnConfig((prev) =>
      prev.map((col) => (col.key === key ? { ...col, visible: !col.visible } : col))
    );
  };

  // 显示所有列
  const showAllColumns = () => {
    setColumnConfig((prev) => prev.map((col) => ({ ...col, visible: true })));
  };

  // 重置为默认配置
  const resetColumns = () => {
    setColumnConfig(
      columns.map((col) => ({
        key: col.key as string,
        title: col.title as string,
        visible: !defaultHiddenKeys.includes(col.key as string),
        fixed: false,
      }))
    );
  };

  // 过滤出可见的列
  const visibleColumns = useMemo(() => {
    const visibleKeys = new Set(columnConfig.filter((c) => c.visible).map((c) => c.key));
    return columns.filter((col) => visibleKeys.has(col.key as string));
  }, [columns, columnConfig]);

  return {
    columnConfig,
    visibleColumns,
    toggleColumn,
    showAllColumns,
    resetColumns,
  };
}
