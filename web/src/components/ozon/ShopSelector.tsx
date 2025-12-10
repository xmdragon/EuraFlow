import { ShopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Select, Space, Spin } from 'antd';
import React, { useEffect, useState, useMemo } from 'react';

import { useShopNameFormat } from '@/hooks/useShopNameFormat';
import { getShops } from '@/services/ozon';

import styles from './ShopSelector.module.scss';

const { Option } = Select;

interface ShopSelectorProps {
  value?: number | number[] | null;
  onChange?: (value: number | number[] | null) => void;
  showAllOption?: boolean;
  style?: React.CSSProperties;
  className?: string;
  placeholder?: string;
  mode?: 'multiple';
  id?: string;
}

/**
 * 店铺选择器组件
 *
 * 注意：此组件仅负责 UI 展示，不负责持久化。
 * 持久化逻辑由 useShopSelection hook 处理。
 * 使用时请配合 useShopSelection hook：
 *
 * @example
 * const { selectedShop, handleShopChange } = useShopSelection();
 * <ShopSelector value={selectedShop} onChange={handleShopChange} />
 */
const ShopSelector: React.FC<ShopSelectorProps> = ({
  value,
  onChange,
  showAllOption = true,
  style,
  className,
  placeholder = '选择店铺',
  mode,
  id,
}) => {
  const isMultiple = mode === 'multiple';
  const [selectedShop, setSelectedShop] = useState<number | number[] | null>(
    value !== undefined ? value : isMultiple ? [] : null
  );

  // 获取店铺名称格式化配置
  const { getShortName, getFullName } = useShopNameFormat();

  // 获取店铺列表（仅基本信息，用于下拉选择）
  const { data: shopsData, isLoading } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: () => getShops(),  // 默认 include_stats=false，仅返回基本信息
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
  });

  const shops = useMemo(() => shopsData?.data || [], [shopsData?.data]);

  useEffect(() => {
    // 避免不必要的状态更新
    if (shops.length === 0) return;

    // 特殊情况：只有一个店铺且不显示"全部"选项时，自动选择唯一的店铺
    if (!isMultiple && shops.length === 1 && !showAllOption) {
      const shopId = shops[0].id;
      if (selectedShop !== shopId) {
        setSelectedShop(shopId);
        onChange?.(shopId);
      }
      return;
    }

    // 如果外部已经设置了value，优先使用外部value
    if (value !== undefined) {
      if (isMultiple) {
        const incoming = Array.isArray(value) ? value : value === null ? [] : [value];
        setSelectedShop(incoming);
      } else if (value !== selectedShop) {
        setSelectedShop(value as number | null);
      }
      return;
    }

    // 检查当前选中的店铺是否在授权列表中
    if (!isMultiple && selectedShop !== null && !shops.find((s) => s.id === selectedShop)) {
      // 当前选中的店铺不在授权列表中，重置
      console.warn(`店铺 ${selectedShop} 不在授权列表中，自动清除`);
      setSelectedShop(null);
      // 触发onChange，让父组件知道需要重置
      onChange?.(null);
    }

    // 如果已经有选中店铺，且该店铺仍然存在，则不需要改变
    if (!isMultiple && selectedShop !== null && shops.find((s) => s.id === selectedShop)) {
      return;
    }

    if (!isMultiple && value === undefined && selectedShop === null && shops.length > 0) {
      // 如果只有一个店铺，无论是否显示"全部"选项，都自动选中
      if (shops.length === 1) {
        const shopId = shops[0].id;
        setSelectedShop(shopId);
        onChange?.(shopId);
        return;
      }

      // 如果有多个店铺且不显示"全部"选项，自动选择第一个店铺
      if (!showAllOption) {
        const shopId = shops[0].id;
        setSelectedShop(shopId);
        onChange?.(shopId);
      }
    }
  }, [shops, selectedShop, onChange, value, isMultiple, showAllOption]);

  const handleChange = (shopId: number | string | (number | string)[]) => {
    if (isMultiple) {
      const valuesArray = Array.isArray(shopId) ? shopId : [shopId];
      const normalized = valuesArray
        .map((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
        .filter((val) => !Number.isNaN(val)) as number[];
      setSelectedShop(normalized);
      onChange?.(normalized);
    } else {
      const actualShopId = shopId === 'all' ? null : (shopId as number);
      setSelectedShop(actualShopId);
      onChange?.(actualShopId);
      // 注意：不再在这里直接操作 localStorage
      // 持久化由 useShopSelection hook 的 handleShopChange 处理
    }
  };

  if (isLoading) {
    return <Spin size="small" />;
  }

  // 如果没有店铺，显示空提示
  if (shops.length === 0) {
    return (
      <Select
        style={style}
        className={className ? `${styles.shopSelect} ${className}` : styles.shopSelect}
        placeholder="暂无店铺"
        disabled
        value={undefined}
      />
    );
  }

  // 如果只有一个店铺且不显示"全部"选项，隐藏选择器
  if (!isMultiple && shops.length === 1 && !showAllOption) {
    const shop = shops[0];
    return <span>{getFullName(shop)}</span>;
  }

  return (
    <Select
      id={id}
      value={(() => {
        if (isMultiple) {
          return (selectedShop as number[] | null) ?? [];
        }
        // 如果不显示"全部"选项，且当前值为null，则显示undefined让Select显示placeholder
        if (!showAllOption && selectedShop === null) {
          return undefined;
        }
        return selectedShop === null ? 'all' : selectedShop;
      })()}
      onChange={handleChange}
      style={style}
      className={className ? `${styles.shopSelect} ${className}` : styles.shopSelect}
      placeholder={placeholder}
      loading={isLoading}
      mode={mode}
      dropdownMatchSelectWidth={false}
      popupClassName={styles.shopSelectDropdown}
      optionLabelProp="label"
    >
      {!isMultiple && showAllOption && (
        <Option value="all" label="全部店铺">
          <Space>
            <ShopOutlined />
            <span>全部店铺</span>
          </Space>
        </Option>
      )}
      {shops.map((shop) => (
        <Option key={shop.id} value={shop.id} label={getShortName(shop)}>
          <Space>
            <ShopOutlined />
            <span>{getFullName(shop)}</span>
            {shop.status !== 'active' && (
              <span className={styles.statusLabel}>({shop.status})</span>
            )}
          </Space>
        </Option>
      ))}
    </Select>
  );
};

export default ShopSelector;
