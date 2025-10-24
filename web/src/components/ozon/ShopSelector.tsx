/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import { ShopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Select, Space, Spin } from 'antd';
import React, { useEffect, useState } from 'react';

import * as ozonApi from '../../services/ozonApi';

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
}

const ShopSelector: React.FC<ShopSelectorProps> = ({
  value,
  onChange,
  showAllOption = true,
  style,
  className,
  placeholder = '选择店铺',
  mode,
}) => {
  const isMultiple = mode === 'multiple';
  const [selectedShop, setSelectedShop] = useState<number | number[] | null>(
    value !== undefined ? value : isMultiple ? [] : null
  );

  // 获取店铺列表
  const { data: shopsData, isLoading } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: ozonApi.getShops,
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
  });

  const shops = shopsData?.data || [];

  useEffect(() => {
    // 避免不必要的状态更新
    if (shops.length === 0) return;

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
        localStorage.setItem('ozon_selected_shop', shopId.toString());
        return;
      }

      // 如果有多个店铺，尝试使用保存的店铺ID
      const savedShopId = localStorage.getItem('ozon_selected_shop');
      if (savedShopId && savedShopId !== 'all') {
        const shopId = parseInt(savedShopId, 10);
        if (shops.find((s) => s.id === shopId)) {
          setSelectedShop(shopId);
          onChange?.(shopId);
          return;
        }
      }

      // 如果有多个店铺且不显示"全部"选项，自动选择第一个店铺
      if (!showAllOption) {
        const shopId = shops[0].id;
        setSelectedShop(shopId);
        onChange?.(shopId);
        localStorage.setItem('ozon_selected_shop', shopId.toString());
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
      localStorage.setItem('ozon_selected_shop', shopId.toString());
    }
  };

  if (isLoading) {
    return <Spin size="small" />;
  }

  // 如果只有一个店铺且不显示"全部"选项，隐藏选择器
  if (!isMultiple && shops.length === 1 && !showAllOption) {
    const shop = shops[0];
    const displayName = shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : '');
    return <span>{displayName}</span>;
  }

  return (
    <Select
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
    >
      {!isMultiple && showAllOption && (
        <Option value="all">
          <Space>
            <ShopOutlined />
            <span>全部店铺</span>
          </Space>
        </Option>
      )}
      {shops.map((shop) => {
        const displayName = shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : '');
        return (
          <Option key={shop.id} value={shop.id}>
            <Space>
              <ShopOutlined />
              <span>{displayName}</span>
              {shop.status !== 'active' && (
                <span className={styles.statusLabel}>({shop.status})</span>
              )}
            </Space>
          </Option>
        );
      })}
    </Select>
  );
};

export default ShopSelector;
