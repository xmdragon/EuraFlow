/**
 * 水印位置选择器 - 9宫格组件
 * 提供交互式的9宫格位置选择界面
 */
import React from 'react';
import {
  WATERMARK_POSITIONS_GRID,
  getWatermarkThumbnailStyle,
  type WatermarkPosition,
} from '@/utils/ozon/watermarkUtils';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

export interface WatermarkPositionGridProps {
  /** 当前选中的位置 */
  selectedPosition?: WatermarkPosition;
  /** 水印图片URL（用于显示缩略图） */
  watermarkImageUrl?: string;
  /** 位置选择回调 */
  onPositionSelect: (position: WatermarkPosition) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 9宫格位置选择器组件
 */
export const WatermarkPositionGrid: React.FC<WatermarkPositionGridProps> = ({
  selectedPosition,
  watermarkImageUrl,
  onPositionSelect,
  disabled = false,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 0,
        zIndex: 20, // 确保在水印预览层之上，使其可点击
      }}
    >
      {WATERMARK_POSITIONS_GRID.map((position, idx) => {
        // 中心位置为空
        if (position === null) return <div key={idx} />;

        const isSelected = selectedPosition === position;

        return (
          <div
            key={idx}
            onClick={() => {
              if (!disabled) {
                onPositionSelect(position);
              }
            }}
            onMouseDown={(e) => {
              // 阻止默认行为，防止获得焦点和显示光标
              e.preventDefault();
            }}
            style={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              backgroundColor: isSelected
                ? 'rgba(24, 144, 255, 0.15)'
                : 'transparent',
              border: '1px solid transparent',
              transition: 'all 0.2s',
              position: 'relative',
              overflow: 'hidden',
              opacity: disabled ? 0.5 : 1,
              outline: 'none', // 移除焦点轮廓
              userSelect: 'none', // 防止文本选择
            }}
            onMouseEnter={(e) => {
              if (!isSelected && !disabled) {
                e.currentTarget.style.backgroundColor = 'rgba(24, 144, 255, 0.08)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected && !disabled) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
            title={`点击选择位置: ${position.replace(/_/g, ' ')}`}
          >
            {/* 不显示水印缩略图，只用背景色表示选中状态 */}
          </div>
        );
      })}
    </div>
  );
};
