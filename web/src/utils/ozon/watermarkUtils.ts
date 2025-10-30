/**
 * 水印相关工具函数
 */
import React from 'react';

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
  const margin = configObj.margin_pixels || 20;

  const styles: React.CSSProperties = {
    opacity: opacity,
    width: `${scale * 100}%`,
    maxWidth: '200px', // 限制最大尺寸
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
