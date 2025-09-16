import React, { useEffect, useState } from 'react';
import { Select, Space, Spin } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import * as ozonApi from '../../services/ozonApi';

const { Option } = Select;

interface ShopSelectorProps {
  value?: number | null;
  onChange?: (shopId: number | null) => void;
  showAllOption?: boolean;
  style?: React.CSSProperties;
  placeholder?: string;
}

const ShopSelector: React.FC<ShopSelectorProps> = ({
  value,
  onChange,
  showAllOption = true,
  style,
  placeholder = '选择店铺',
}) => {
  const [selectedShop, setSelectedShop] = useState<number | null>(value || null);

  // 获取店铺列表
  const { data: shopsData, isLoading } = useQuery({
    queryKey: ['ozonShops'],
    queryFn: ozonApi.getShops,
  });

  const shops = shopsData?.data || [];

  useEffect(() => {
    // 如果只有一个店铺，自动选中
    if (!selectedShop && shops.length === 1) {
      const shopId = shops[0].id;
      setSelectedShop(shopId);
      onChange?.(shopId);
    }
    // 恢复之前的选择（从localStorage）
    else if (!selectedShop && shops.length > 0) {
      const savedShopId = localStorage.getItem('ozon_selected_shop');
      if (savedShopId) {
        const shopId = savedShopId === 'all' ? null : parseInt(savedShopId, 10);
        if (shopId === null || shops.find((s) => s.id === shopId)) {
          setSelectedShop(shopId);
          onChange?.(shopId);
        }
      }
    }
  }, [shops, selectedShop, onChange]);

  const handleChange = (shopId: number | string) => {
    const actualShopId = shopId === 'all' ? null : (shopId as number);
    setSelectedShop(actualShopId);
    onChange?.(actualShopId);

    // 保存到localStorage
    localStorage.setItem('ozon_selected_shop', shopId.toString());
  };

  if (isLoading) {
    return <Spin size="small" />;
  }

  // 如果只有一个店铺且不显示"全部"选项，隐藏选择器
  if (shops.length === 1 && !showAllOption) {
    return (
      <Space>
        <ShopOutlined />
        <span>{shops[0].shop_name}</span>
      </Space>
    );
  }

  return (
    <Select
      value={selectedShop === null ? 'all' : selectedShop}
      onChange={handleChange}
      style={{ minWidth: 200, ...style }}
      placeholder={placeholder}
      loading={isLoading}
    >
      {showAllOption && (
        <Option value="all">
          <Space>
            <ShopOutlined />
            <span>全部店铺</span>
          </Space>
        </Option>
      )}
      {shops.map((shop) => (
        <Option key={shop.id} value={shop.id}>
          <Space>
            <ShopOutlined />
            <span>{shop.shop_name}</span>
            {shop.status !== 'active' && (
              <span style={{ color: '#999', fontSize: 12 }}>({shop.status})</span>
            )}
          </Space>
        </Option>
      ))}
    </Select>
  );
};

export default ShopSelector;