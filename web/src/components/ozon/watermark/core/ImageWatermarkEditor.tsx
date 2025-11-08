/**
 * 图片水印编辑器
 * 组合组件，整合水印配置选择、位置选择和预览功能
 */
import React, { useState } from 'react';
import { Space } from 'antd';
import type { WatermarkConfig } from '@/services/watermarkApi';
import WatermarkConfigSelector from './WatermarkConfigSelector';
import PositionGrid, { type WatermarkPosition } from './PositionGrid';
import ImageWatermarkPreview from './ImageWatermarkPreview';
import styles from './ImageWatermarkEditor.module.scss';

interface ImageWatermarkEditorProps {
  /** 图片URL */
  imageUrl: string;
  /** 水印配置列表 */
  watermarkConfigs: WatermarkConfig[];
  /** 初始选中的水印配置ID */
  defaultConfigId?: number;
  /** 初始选中的位置 */
  defaultPosition?: WatermarkPosition;
  /** 配置改变回调 */
  onConfigChange?: (configId: number | undefined) => void;
  /** 位置改变回调 */
  onPositionChange?: (position: WatermarkPosition) => void;
  /** 预览图片宽度 */
  previewWidth?: number | string;
  /** 预览图片高度 */
  previewHeight?: number | string;
}

/**
 * 图片水印编辑器组件
 * 支持选择水印配置、调整位置、实时预览
 */
const ImageWatermarkEditor: React.FC<ImageWatermarkEditorProps> = ({
  imageUrl,
  watermarkConfigs,
  defaultConfigId,
  defaultPosition = 'bottom_right',
  onConfigChange,
  onPositionChange,
  previewWidth = 400,
  previewHeight = 300,
}) => {
  const [selectedConfigId, setSelectedConfigId] = useState<number | undefined>(defaultConfigId);
  const [selectedPosition, setSelectedPosition] = useState<WatermarkPosition>(defaultPosition);

  // 获取当前选中的水印配置
  const selectedConfig = watermarkConfigs.find((c) => c.id === selectedConfigId) || null;

  // 处理水印配置改变
  const handleConfigChange = (configId: number | undefined) => {
    setSelectedConfigId(configId);
    onConfigChange?.(configId);
  };

  // 处理位置改变
  const handlePositionChange = (position: WatermarkPosition) => {
    setSelectedPosition(position);
    onPositionChange?.(position);
  };

  return (
    <div className={styles.editor}>
      {/* 配置选择区 */}
      <div className={styles.configSection}>
        <div className={styles.sectionTitle}>选择水印配置</div>
        <WatermarkConfigSelector
          configs={watermarkConfigs}
          value={selectedConfigId}
          onChange={handleConfigChange}
          allowClear
        />
      </div>

      {/* 位置选择区（仅在选择了配置后显示） */}
      {selectedConfig && (
        <div className={styles.positionSection}>
          <div className={styles.sectionTitle}>选择水印位置</div>
          <PositionGrid
            value={selectedPosition}
            onChange={handlePositionChange}
            allowedPositions={selectedConfig.positions as WatermarkPosition[]}
          />
        </div>
      )}

      {/* 预览区 */}
      <div className={styles.previewSection}>
        <div className={styles.sectionTitle}>预览效果</div>
        <ImageWatermarkPreview
          imageUrl={imageUrl}
          watermarkConfig={selectedConfig}
          position={selectedPosition}
          width={previewWidth}
          height={previewHeight}
        />
        {!selectedConfig && (
          <div className={styles.noWatermarkHint}>请先选择水印配置</div>
        )}
      </div>
    </div>
  );
};

export default ImageWatermarkEditor;
