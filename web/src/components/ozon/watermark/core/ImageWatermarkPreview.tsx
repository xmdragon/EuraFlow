/**
 * 图片水印预览器
 * 通过CSS叠加方式预览水印效果（客户端预览）
 */
import React from 'react';
import { getPreviewWatermarkStyle } from '@/utils/ozon/watermarkUtils';
import type { WatermarkConfig } from '@/services/watermarkApi';
import type { WatermarkPosition } from './PositionGrid';
import styles from './ImageWatermarkPreview.module.scss';

interface ImageWatermarkPreviewProps {
  /** 原始图片URL */
  imageUrl: string;
  /** 水印配置 */
  watermarkConfig: WatermarkConfig | null;
  /** 水印位置 */
  position?: WatermarkPosition;
  /** 容器宽度 */
  width?: number | string;
  /** 容器高度 */
  height?: number | string;
  /** 是否显示加载状态 */
  loading?: boolean;
  /** 图片加载完成回调 */
  onImageLoad?: () => void;
  /** 图片加载失败回调 */
  onImageError?: () => void;
}

/**
 * 图片水印预览器组件
 * 注意：这是客户端CSS预览，实际应用水印时由服务端合成，可能存在细微差异
 */
const ImageWatermarkPreview: React.FC<ImageWatermarkPreviewProps> = ({
  imageUrl,
  watermarkConfig,
  position,
  width = '100%',
  height = 'auto',
  loading = false,
  onImageLoad,
  onImageError,
}) => {
  // 计算水印样式
  const watermarkStyle = watermarkConfig && position
    ? getPreviewWatermarkStyle(position, watermarkConfig)
    : {};

  return (
    <div
      className={styles.previewContainer}
      style={{ width, height: height === 'auto' ? undefined : height }}
    >
      {/* 原图层 */}
      <img
        src={imageUrl}
        alt="预览图片"
        className={styles.originalImage}
        onLoad={onImageLoad}
        onError={onImageError}
      />

      {/* 水印层（CSS叠加） */}
      {watermarkConfig && position && (
        <img
          src={watermarkConfig.image_url}
          alt="水印"
          className={styles.watermarkLayer}
          style={{
            position: 'absolute',
            ...watermarkStyle,
          }}
        />
      )}

      {/* 加载状态遮罩 */}
      {loading && (
        <div className={styles.loadingMask}>
          <div className={styles.spinner}>加载中...</div>
        </div>
      )}
    </div>
  );
};

export default ImageWatermarkPreview;
