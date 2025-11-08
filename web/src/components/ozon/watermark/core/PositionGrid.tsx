/**
 * 9宫格水印位置选择器
 * 完全独立的组件，可用于任意需要位置选择的场景
 */
import React from 'react';
import { Tooltip } from 'antd';
import styles from './PositionGrid.module.scss';

export type WatermarkPosition =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'center_left'
  | 'center_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

interface PositionGridProps {
  /** 当前选中的位置 */
  value?: WatermarkPosition;
  /** 位置改变回调 */
  onChange?: (position: WatermarkPosition) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 允许的位置列表（不在列表中的位置将显示为禁用） */
  allowedPositions?: WatermarkPosition[];
}

/** 位置到中文名称的映射 */
const positionLabels: Record<WatermarkPosition, string> = {
  top_left: '左上',
  top_center: '上中',
  top_right: '右上',
  center_left: '左中',
  center_right: '右中',
  bottom_left: '左下',
  bottom_center: '下中',
  bottom_right: '右下',
};

/** 9宫格布局（null表示中间占位） */
const gridLayout: (WatermarkPosition | null)[][] = [
  ['top_left', 'top_center', 'top_right'],
  ['center_left', null, 'center_right'],
  ['bottom_left', 'bottom_center', 'bottom_right'],
];

/**
 * 9宫格位置选择器组件
 */
const PositionGrid: React.FC<PositionGridProps> = ({
  value,
  onChange,
  disabled = false,
  allowedPositions,
}) => {
  const handleClick = (position: WatermarkPosition) => {
    if (disabled) return;
    if (allowedPositions && !allowedPositions.includes(position)) return;
    onChange?.(position);
  };

  const isPositionDisabled = (position: WatermarkPosition): boolean => {
    if (disabled) return true;
    if (allowedPositions && !allowedPositions.includes(position)) return true;
    return false;
  };

  return (
    <div className={styles.positionGrid}>
      {gridLayout.map((row, rowIndex) => (
        <div key={rowIndex} className={styles.row}>
          {row.map((position, colIndex) => {
            if (position === null) {
              // 中间占位
              return <div key={colIndex} className={styles.cellEmpty} />;
            }

            const isSelected = value === position;
            const isDisabled = isPositionDisabled(position);

            return (
              <Tooltip key={colIndex} title={positionLabels[position]}>
                <div
                  className={`${styles.cell} ${isSelected ? styles.selected : ''} ${isDisabled ? styles.disabled : ''}`}
                  onClick={() => !isDisabled && handleClick(position)}
                >
                  {/* 选中标记 */}
                  {isSelected && <div className={styles.checkMark}>✓</div>}
                </div>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default PositionGrid;
