/**
 * 可排序列标题组件
 */
import React from 'react';

export interface SortableColumnTitleProps {
  title: string;
  field: string;
  sortBy: string | null;
  sortOrder: 'asc' | 'desc' | null;
  onSort: (field: string) => void;
}

/**
 * 可排序的列标题组件
 * 显示排序指示器（▲▼）并处理点击排序
 */
export const SortableColumnTitle: React.FC<SortableColumnTitleProps> = ({
  title,
  field,
  sortBy,
  sortOrder,
  onSort,
}) => {
  const isActive = sortBy === field;
  const isAsc = isActive && sortOrder === 'asc';
  const isDesc = isActive && sortOrder === 'desc';

  return (
    <div
      style={{
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        userSelect: 'none',
      }}
      onClick={() => onSort(field)}
    >
      <span>{title}</span>
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          fontSize: '10px',
        }}
      >
        <span style={{ lineHeight: 1, color: isAsc ? '#1890ff' : '#bfbfbf' }}>▲</span>
        <span style={{ lineHeight: 1, color: isDesc ? '#1890ff' : '#bfbfbf' }}>▼</span>
      </span>
    </div>
  );
};
