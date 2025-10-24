/**
 * 系统管理主页面
 */
import { Spin } from 'antd';
import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

// 路由懒加载
const SyncServices = lazy(() => import('./SyncServices'));
const SystemConfiguration = lazy(() => import('./SystemConfiguration'));

// 加载中组件
const PageLoading = () => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '400px',
    }}
  >
    <Spin size="large" />
  </div>
);

const SystemManagement: React.FC = () => {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="sync-services" element={<SyncServices />} />
        <Route path="configuration" element={<SystemConfiguration />} />
      </Routes>
    </Suspense>
  );
};

export default SystemManagement;
