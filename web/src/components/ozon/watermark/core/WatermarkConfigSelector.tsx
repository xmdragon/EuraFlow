/**
 * 水印配置选择器
 * 独立的选择器组件，可用于任意需要选择水印配置的场景
 */
import React from 'react';
import { Select, Space } from 'antd';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import type { WatermarkConfig } from '@/services/watermarkApi';

const { Option } = Select;

interface WatermarkConfigSelectorProps {
  /** 水印配置列表 */
  configs: WatermarkConfig[];
  /** 当前选中的配置ID */
  value?: number;
  /** 配置改变回调 */
  onChange?: (configId: number) => void;
  /** 占位符文本 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 样式 */
  style?: React.CSSProperties;
  /** 是否允许清除 */
  allowClear?: boolean;
}

/**
 * 水印配置选择器组件
 */
const WatermarkConfigSelector: React.FC<WatermarkConfigSelectorProps> = ({
  configs,
  value,
  onChange,
  placeholder = '请选择水印配置',
  disabled = false,
  style,
  allowClear = false,
}) => {
  return (
    <Select
      style={{ width: '100%', ...style }}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      disabled={disabled}
      allowClear={allowClear}
    >
      {configs.map((config) => (
        <Option key={config.id} value={config.id}>
          <Space>
            {/* 水印缩略图 */}
            <img
              src={optimizeOzonImageUrl(config.image_url, 20)}
              alt={config.name}
              style={{ width: 20, height: 20, objectFit: 'contain' }}
            />

            {/* 水印名称 */}
            <span>{config.name}</span>

            {/* 比例和透明度 */}
            <span style={{ color: '#999', fontSize: 12 }}>
              {(config.scale_ratio * 100).toFixed(0)}% / {(config.opacity * 100).toFixed(0)}%
            </span>
          </Space>
        </Option>
      ))}
    </Select>
  );
};

export default WatermarkConfigSelector;
