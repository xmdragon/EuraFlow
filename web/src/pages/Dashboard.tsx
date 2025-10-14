import {
  DashboardOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  ShopOutlined,
  CalculatorOutlined,
  FilterOutlined,
  ShoppingOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  PictureOutlined,
  KeyOutlined,
  MessageOutlined,
  SyncOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Button, Avatar, Dropdown, Typography, Card, Row, Col, Space, Spin } from 'antd';
import React, { Suspense, lazy } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';

// 路由懒加载
const FinanceCalculator = lazy(() => import('./finance'));
const OzonManagement = lazy(() => import('./ozon'));
const Profile = lazy(() => import('./Profile'));
const Settings = lazy(() => import('./Settings'));
const UserManagement = lazy(() => import('./UserManagement'));
const ExchangeRateManagement = lazy(() => import('./ExchangeRateManagement'));

import { useAuth } from '@/hooks/useAuth';

// 加载中组件
const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
    <Spin size="large" />
  </div>
);

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
  };

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料',
      onClick: () => navigate('/dashboard/profile'),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  const menuItems = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: '仪表板',
      onClick: () => navigate('/dashboard'),
    },
    {
      key: 'ozon',
      icon: <ShopOutlined />,
      label: 'Ozon管理',
      children: [
        {
          key: 'ozon-dashboard',
          icon: <DashboardOutlined />,
          label: '概览',
          onClick: () => navigate('/dashboard/ozon'),
        },
        {
          key: 'ozon-selection',
          icon: <FilterOutlined />,
          label: '选品助手',
          onClick: () => navigate('/dashboard/ozon/selection'),
        },
        {
          key: 'ozon-products',
          icon: <ShoppingOutlined />,
          label: '商品管理',
          onClick: () => navigate('/dashboard/ozon/products'),
        },
        {
          key: 'ozon-orders',
          icon: <ShoppingCartOutlined />,
          label: '订单管理',
          onClick: () => navigate('/dashboard/ozon/orders'),
        },
        {
          key: 'ozon-reports',
          icon: <FileTextOutlined />,
          label: '订单报表',
          onClick: () => navigate('/dashboard/ozon/reports'),
        },
        {
          key: 'ozon-chats',
          icon: <MessageOutlined />,
          label: '聊天管理',
          onClick: () => navigate('/dashboard/ozon/chats'),
        },
        {
          key: 'ozon-watermark',
          icon: <PictureOutlined />,
          label: '水印管理',
          onClick: () => navigate('/dashboard/ozon/watermark'),
        },
        {
          key: 'ozon-api-keys',
          icon: <KeyOutlined />,
          label: 'API密钥',
          onClick: () => navigate('/dashboard/ozon/api-keys'),
        },
        {
          key: 'ozon-sync-services',
          icon: <SyncOutlined />,
          label: '后台服务',
          onClick: () => navigate('/dashboard/ozon/sync-services'),
        },
        {
          key: 'ozon-settings',
          icon: <SettingOutlined />,
          label: '店铺设置',
          onClick: () => navigate('/dashboard/ozon/settings'),
        },
      ],
    },
    {
      key: 'finance',
      icon: <CalculatorOutlined />,
      label: '财务计算',
      onClick: () => navigate('/dashboard/finance'),
    },
    {
      key: 'exchange-rate',
      icon: <DollarOutlined />,
      label: '汇率管理',
      onClick: () => navigate('/dashboard/exchange-rate'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置',
      onClick: () => navigate('/dashboard/settings'),
    },
    ...(user?.role === 'admin' ? [{
      key: 'users',
      icon: <UserOutlined />,
      label: '用户管理',
      onClick: () => navigate('/dashboard/users'),
    }] : []),
  ];

  // 根据路径获取选中的菜单项
  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.includes('/ozon/selection')) return 'ozon-selection';
    if (path.includes('/ozon/products')) return 'ozon-products';
    if (path.includes('/ozon/orders')) return 'ozon-orders';
    if (path.includes('/ozon/reports')) return 'ozon-reports';
    if (path.includes('/ozon/chat')) return 'ozon-chats';
    if (path.includes('/ozon/watermark')) return 'ozon-watermark';
    if (path.includes('/ozon/api-keys')) return 'ozon-api-keys';
    if (path.includes('/ozon/sync-services')) return 'ozon-sync-services';
    if (path.includes('/ozon/settings')) return 'ozon-settings';
    if (path.includes('/ozon')) return 'ozon-dashboard';
    if (path.includes('/finance')) return 'finance';
    if (path.includes('/exchange-rate')) return 'exchange-rate';
    if (path.includes('/users')) return 'users';
    if (path.includes('/profile')) return 'profile';
    if (path.includes('/settings')) return 'settings';
    return 'dashboard';
  };

  // 根据路径获取展开的子菜单
  const getOpenKeys = () => {
    const path = location.pathname;
    if (path.includes('/ozon')) return ['ozon'];
    return [];
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="dark"
        width={240}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div
          style={{
            height: 64,
            margin: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 20,
            fontWeight: 'bold',
          }}
        >
          EuraFlow
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
        />
      </Sider>

      <Layout style={{ marginLeft: 240 }}>
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            仪表板
          </Title>

          <Space size="middle">
            <span>欢迎回来, {user?.username || user?.email}</span>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
              <Button type="text" icon={<Avatar size="small" icon={<UserOutlined />} />} />
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ margin: 2, padding: 2, background: '#f5f5f5' }}>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <DashboardHome
                    user={
                      user || { id: 0, username: 'Guest', email: '', role: 'guest', is_active: false }
                    }
                  />
                }
              />
              <Route path="/ozon/*" element={<OzonManagement />} />
              <Route path="/finance" element={<FinanceCalculator />} />
              <Route path="/exchange-rate" element={<ExchangeRateManagement />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              {user?.role === 'admin' && <Route path="/users" element={<UserManagement />} />}
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
};

// 仪表板首页组件
interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at?: string;
}

const DashboardHome: React.FC<{ user: User }> = ({ user }) => {
  return (
    <Row>
      <Col span={24}>
        <Card title="系统状态">
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <Title level={2} style={{ marginBottom: 40 }}>
              欢迎使用 EuraFlow 跨境电商管理平台
            </Title>

            <Row gutter={[16, 24]} justify="center">
              <Col xs={24} sm={12} md={8}>
                <Card type="inner">
                  <p style={{ marginBottom: 8, color: '#999' }}>账户角色</p>
                  <p style={{ fontSize: 18, fontWeight: 'bold' }}>{user?.role || '未设置'}</p>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Card type="inner">
                  <p style={{ marginBottom: 8, color: '#999' }}>账户状态</p>
                  <p
                    style={{
                      fontSize: 18,
                      fontWeight: 'bold',
                      color: user?.is_active ? '#52c41a' : '#f5222d',
                    }}
                  >
                    {user?.is_active ? '活跃' : '未激活'}
                  </p>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8}>
                <Card type="inner">
                  <p style={{ marginBottom: 8, color: '#999' }}>最后登录</p>
                  <p style={{ fontSize: 16, fontWeight: 'bold' }}>
                    {user?.last_login_at
                      ? new Date(user.last_login_at).toLocaleString('zh-CN')
                      : '首次登录'}
                  </p>
                </Card>
              </Col>
            </Row>
          </div>
        </Card>
      </Col>
    </Row>
  );
};

export default Dashboard;
