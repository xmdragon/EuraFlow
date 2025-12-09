import { Spin, App as AntApp, Result, Button, Space } from 'antd';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';

import NotificationProvider from '@/components/NotificationProvider';
import { useAuth } from '@/hooks/useAuth';
import Dashboard from '@/pages/Dashboard';
import LoginPage from '@/pages/LoginPage';

/**
 * 无店铺提示页面
 * - 子账号：提示联系管理员分配店铺
 * - 管理员：提示添加店铺或创建子账号
 */
const NoShopPage: React.FC<{ role: string }> = ({ role }) => {
  const navigate = useNavigate();

  if (role === 'sub_account') {
    return (
      <Result
        status="warning"
        title="暂无可访问的店铺"
        subTitle="请联系管理员为您分配店铺权限"
      />
    );
  }

  // manager 或 admin
  return (
    <Result
      status="info"
      title="当前没有添加店铺"
      subTitle="请添加店铺或添加子账号，在子账号添加店铺"
      extra={
        <Space>
          <Button type="primary" onClick={() => navigate('/dashboard/system/configuration?tab=ozon-shop')}>
            店铺管理
          </Button>
          <Button onClick={() => navigate('/dashboard/system/users')}>
            用户管理
          </Button>
        </Space>
      }
    />
  );
};

function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  // 检查用户是否有店铺
  const hasShops = user && user.shop_ids && user.shop_ids.length > 0;
  // admin 角色即使没有店铺也可以访问系统（有全局权限）
  const canAccessWithoutShop = user?.role === 'admin';

  // 始终渲染NotificationProvider，避免组件卸载导致WebSocket断开
  // NotificationProvider内部会根据user状态决定是否建立连接
  return (
    <AntApp>
      <NotificationProvider user={user}>
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
          />
          <Route
            path="/dashboard/*"
            element={
              user ? (
                hasShops || canAccessWithoutShop ? (
                  <Dashboard />
                ) : (
                  <NoShopPage role={user.role} />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </NotificationProvider>
    </AntApp>
  );
}

export default App;
