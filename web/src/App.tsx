import { Spin, App as AntApp } from 'antd';
import { Routes, Route, Navigate } from 'react-router-dom';

import CreditBalanceWarning from '@/components/CreditBalanceWarning';
import NotificationProvider from '@/components/NotificationProvider';
import { useAuth } from '@/hooks/useAuth';
import Dashboard from '@/pages/Dashboard';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';

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
            path="/register"
            element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
          />
          <Route
            path="/dashboard/*"
            element={user ? <Dashboard /> : <Navigate to="/login" replace />}
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        {/* 额度余额预警弹窗 - 登录后检查余额（超级管理员不需要） */}
        {user?.role !== 'admin' && <CreditBalanceWarning isLoggedIn={!!user} />}
      </NotificationProvider>
    </AntApp>
  );
}

export default App;
