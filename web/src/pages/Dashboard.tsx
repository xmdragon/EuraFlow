import React from 'react'
import { Layout, Menu, Button, Avatar, Dropdown, Typography, Card, Row, Col, Statistic, Space } from 'antd'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import {
  DashboardOutlined,
  ShoppingOutlined,
  InboxOutlined,
  TruckOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/hooks/useAuth'
import OzonManagement from './ozon'

const { Header, Sider, Content } = Layout
const { Title } = Typography

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = async () => {
    await logout()
  }

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

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
      key: 'orders',
      icon: <ShoppingOutlined />,
      label: '订单管理',
      onClick: () => navigate('/dashboard/orders'),
    },
    {
      key: 'inventory',
      icon: <InboxOutlined />,
      label: '库存管理',
      onClick: () => navigate('/dashboard/inventory'),
    },
    {
      key: 'shipping',
      icon: <TruckOutlined />,
      label: '物流管理',
      onClick: () => navigate('/dashboard/shipping'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置',
      onClick: () => navigate('/dashboard/settings'),
    },
  ]

  // 根据路径获取选中的菜单项
  const getSelectedKey = () => {
    const path = location.pathname
    if (path.includes('/ozon')) return 'ozon'
    if (path.includes('/orders')) return 'orders'
    if (path.includes('/inventory')) return 'inventory'
    if (path.includes('/shipping')) return 'shipping'
    if (path.includes('/settings')) return 'settings'
    return 'dashboard'
  }

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
            <Dropdown 
              menu={{ items: userMenuItems }} 
              placement="bottomRight" 
              arrow
            >
              <Button type="text" icon={<Avatar size="small" icon={<UserOutlined />} />} />
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ margin: 24, padding: 24, background: '#f5f5f5' }}>
          <Routes>
            <Route path="/" element={<DashboardHome user={user} />} />
            <Route path="/ozon/*" element={<OzonManagement />} />
            <Route path="/orders" element={<div>订单管理页面（待开发）</div>} />
            <Route path="/inventory" element={<div>库存管理页面（待开发）</div>} />
            <Route path="/shipping" element={<div>物流管理页面（待开发）</div>} />
            <Route path="/settings" element={<div>系统设置页面（待开发）</div>} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

// 仪表板首页组件
const DashboardHome: React.FC<{ user: any }> = ({ user }) => {
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="总订单数"
              value={1128}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="待处理订单"
              value={23}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="库存商品"
              value={0}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card>
            <Statistic
              title="本月销售额"
              value={112893}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      <Row style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="系统状态" style={{ height: 400 }}>
            <div style={{ textAlign: 'center', marginTop: 100 }}>
              <Title level={3}>欢迎使用 EuraFlow 跨境电商管理平台</Title>
              <p>您的账户角色: <strong>{user?.role}</strong></p>
              <p>账户状态: <strong>{user?.is_active ? '活跃' : '未激活'}</strong></p>
              <p>最后登录: <strong>{user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : '首次登录'}</strong></p>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  )
}

export default Dashboard