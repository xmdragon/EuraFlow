 
/**
 * 带标签的店铺选择器组件
 * 封装 ShopSelector + 标签显示，统一所有页面的使用方式
 */
import { Space } from 'antd';
import React from 'react';

import ShopSelector from './ShopSelector';

export interface ShopSelectorWithLabelProps {
  /** 是否显示标签，默认 true */
  showLabel?: boolean;
  /** 标签文本，默认"选择店铺" */
  label?: string;
  /** 当前选中的店铺ID */
  value?: number | number[] | null;
  /** 店铺改变回调 */
  onChange?: (value: number | number[] | null) => void;
  /** 是否显示"全部店铺"选项，默认 true */
  showAllOption?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 自定义类名 */
  className?: string;
  /** 占位符文本 */
  placeholder?: string;
  /** 模式：单选或多选 */
  mode?: 'multiple';
}

/**
 * 带标签的店铺选择器
 *
 * @example
 * // 显示标签（默认）
 * <ShopSelectorWithLabel
 *   value={selectedShop}
 *   onChange={setSelectedShop}
 * />
 *
 * @example
 * // 不显示标签
 * <ShopSelectorWithLabel
 *   showLabel={false}
 *   value={selectedShop}
 *   onChange={setSelectedShop}
 * />
 *
 * @example
 * // 自定义标签文本
 * <ShopSelectorWithLabel
 *   label="店铺"
 *   value={selectedShop}
 *   onChange={setSelectedShop}
 * />
 */
export const ShopSelectorWithLabel: React.FC<ShopSelectorWithLabelProps> = ({
  showLabel = true,
  label = '选择店铺',
  value,
  onChange,
  showAllOption = false,
  style,
  className,
  placeholder,
  mode,
}) => {
  const selector = (
    <ShopSelector
      value={value}
      onChange={onChange}
      showAllOption={showAllOption}
      style={style}
      className={className}
      placeholder={placeholder}
      mode={mode}
    />
  );

  if (!showLabel) {
    return selector;
  }

  return (
    <Space>
      <span>{label}:</span>
      {selector}
    </Space>
  );
};

export default ShopSelectorWithLabel;
