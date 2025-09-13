/**
 * Ozon 管理主页面
 */
import {
  ShoppingOutlined,
  ShoppingCartOutlined,
  SettingOutlined,
  DashboardOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Layout, Menu } from 'antd';
import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';

import Dashboard from './Dashboard';
import OrderList from './OrderList';
import ProductList from './ProductList';
import ShopSettings from './ShopSettings';

const { Sider, Content } = Layout;

const OzonManagement: React.FC = () => {
  const location = useLocation();

  // 根据当前路径确定选中的菜单项
  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.includes('products')) return 'products';
    if (path.includes('orders')) return 'orders';
    if (path.includes('settings')) return 'settings';
    return 'dashboard';
  };

  const menuItems = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: <Link to="/dashboard/ozon">概览</Link>,
    },
    {
      key: 'products',
      icon: <ShoppingOutlined />,
      label: <Link to="/dashboard/ozon/products">商品管理</Link>,
    },
    {
      key: 'orders',
      icon: <ShoppingCartOutlined />,
      label: <Link to="/dashboard/ozon/orders">订单管理</Link>,
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: <Link to="/dashboard/ozon/settings">店铺设置</Link>,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={200}>
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <ShopOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          <span style={{ fontSize: 16, fontWeight: 'bold' }}>Ozon管理</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={menuItems}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Content style={{ background: '#f0f2f5', overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="products" element={<ProductList />} />
          <Route path="orders" element={<OrderList />} />
          <Route path="settings" element={<ShopSettings />} />
        </Routes>
      </Content>
    </Layout>
  );
};

export default OzonManagement;
