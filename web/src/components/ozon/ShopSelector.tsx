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
    if (value !== undefined && value !== selectedShop) {
      setSelectedShop(value);
      return;
    }

    // 如果已经有选中店铺，且该店铺仍然存在，则不需要改变
    if (selectedShop !== null && shops.find((s) => s.id === selectedShop)) {
      return;
    }

    // 如果外部没有传入value，且当前没有选中店铺，才自动选择
    // 这避免了在父组件已经初始化selectedShop的情况下重复触发onChange
    if (value === undefined && selectedShop === null && shops.length > 0) {
      // 恢复之前的选择（从localStorage）
      const savedShopId = localStorage.getItem('ozon_selected_shop');
      if (savedShopId && savedShopId !== 'all') {
        const shopId = parseInt(savedShopId, 10);
        if (shops.find((s) => s.id === shopId)) {
          setSelectedShop(shopId);
          onChange?.(shopId);
          return;
        }
      }

      // 自动选择第一个店铺
      const shopId = shops[0].id;
      setSelectedShop(shopId);
      onChange?.(shopId);
    }
  }, [shops, selectedShop, onChange, value]);

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