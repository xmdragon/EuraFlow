import {
  DashboardOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  ShopOutlined,
  CalculatorOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Button, Avatar, Dropdown, Typography, Card, Row, Col, Space } from 'antd';
import React from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';

import FinanceCalculator from './finance';
import OzonManagement from './ozon';
import Profile from './Profile';
import Settings from './Settings';
import UserManagement from './UserManagement';

import { useAuth } from '@/hooks/useAuth';

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
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
      onClick: () => navigate('/dashboard/settings'),
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
      onClick: () => navigate('/dashboard/ozon'),
    },
    {
      key: 'finance',
      icon: <CalculatorOutlined />,
      label: '财务计算',
      onClick: () => navigate('/dashboard/finance'),
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
    if (path.includes('/ozon')) return 'ozon';
    if (path.includes('/finance')) return 'finance';
    if (path.includes('/users')) return 'users';
    if (path.includes('/profile')) return 'profile';
    if (path.includes('/settings')) return 'settings';
    return 'dashboard';
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
        <Menu theme="dark" mode="inline" selectedKeys={[getSelectedKey()]} items={menuItems} />
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

        <Content style={{ margin: 24, padding: 24, background: '#f5f5f5' }}>
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
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            {user?.role === 'admin' && <Route path="/users" element={<UserManagement />} />}
          </Routes>
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

            <div style={{ marginTop: 40 }}>
              <p style={{ color: '#999' }}>当前已连接的电商平台：</p>
              <Title level={4}>Ozon (俄罗斯)</Title>
            </div>
          </div>
        </Card>
      </Col>
    </Row>
  );
};

export default Dashboard;
