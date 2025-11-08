/**
 * 水印相关工具函数
 */
import React from 'react';

/**
 * 水印位置枚举类型
 */
export type WatermarkPosition =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'center_left'
  | 'center_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

/**
 * 9宫格位置数组（中心位置为 null）
 */
export const WATERMARK_POSITIONS_GRID: Array<WatermarkPosition | null> = [
  'top_left',
  'top_center',
  'top_right',
  'center_left',
  null,
  'center_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
];

/**
 * 位置中文映射
 */
export const POSITION_LABELS: Record<WatermarkPosition, string> = {
  top_left: '左上',
  top_center: '上中',
  top_right: '右上',
  center_left: '左中',
  center_right: '右中',
  bottom_left: '左下',
  bottom_center: '下中',
  bottom_right: '右下',
};

/**
 * 获取预览水印的样式
 * @param position 水印位置
 * @param config 水印配置对象
 * @returns CSS样式对象
 */
export const getPreviewWatermarkStyle = (
  position: string | undefined,
  config: unknown
): React.CSSProperties => {
  if (!position || !config) return {};

  const configObj = config as { scale_ratio?: number; opacity?: number; margin_pixels?: number };
  const scale = configObj.scale_ratio || 0.1;
  const opacity = configObj.opacity || 0.8;
  const margin = configObj.margin_pixels || 10;

  const styles: React.CSSProperties = {
    opacity: opacity,
    width: `${scale * 100}%`, // 相对于整张图片的宽度百分比
    height: 'auto', // 保持水印比例
    zIndex: 10,
    transition: 'all 0.2s ease',
  };

  // 根据位置设置对齐方式
  switch (position) {
    case 'top_left':
      styles.top = `${margin}px`;
      styles.left = `${margin}px`;
      break;
    case 'top_center':
      styles.top = `${margin}px`;
      styles.left = '50%';
      styles.transform = 'translateX(-50%)';
      break;
    case 'top_right':
      styles.top = `${margin}px`;
      styles.right = `${margin}px`;
      break;
    case 'center_left':
      styles.top = '50%';
      styles.left = `${margin}px`;
      styles.transform = 'translateY(-50%)';
      break;
    case 'center_right':
      styles.top = '50%';
      styles.right = `${margin}px`;
      styles.transform = 'translateY(-50%)';
      break;
    case 'bottom_left':
      styles.bottom = `${margin}px`;
      styles.left = `${margin}px`;
      break;
    case 'bottom_center':
      styles.bottom = `${margin}px`;
      styles.left = '50%';
      styles.transform = 'translateX(-50%)';
      break;
    case 'bottom_right':
    default:
      styles.bottom = `${margin}px`;
      styles.right = `${margin}px`;
      break;
  }

  return styles;
};

/**
 * 获取水印缩略图在9宫格单元格内的样式
 * @param position 水印位置
 * @param size 缩略图大小(px)，默认20
 * @param margin 边距(px)，默认3
 * @returns CSS样式对象
 */
export const getWatermarkThumbnailStyle = (
  position: WatermarkPosition,
  size: number = 20,
  margin: number = 3
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    opacity: 0.6,
    pointerEvents: 'none',
  };

  switch (position) {
    case 'top_left':
      return { ...baseStyle, top: margin, left: margin };
    case 'top_center':
      return { ...baseStyle, top: margin, left: '50%', transform: 'translateX(-50%)' };
    case 'top_right':
      return { ...baseStyle, top: margin, right: margin };
    case 'center_left':
      return { ...baseStyle, top: '50%', left: margin, transform: 'translateY(-50%)' };
    case 'center_right':
      return { ...baseStyle, top: '50%', right: margin, transform: 'translateY(-50%)' };
    case 'bottom_left':
      return { ...baseStyle, bottom: margin, left: margin };
    case 'bottom_center':
      return { ...baseStyle, bottom: margin, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom_right':
      return { ...baseStyle, bottom: margin, right: margin };
    default:
      return baseStyle;
  }
};
