/**
 * 用户管理主页面
 */
import { Spin } from 'antd';
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载 - 使用带重试机制的加载器防止chunk加载失败
const UserList = lazyWithRetry(() => import('./UserList'));
const UserLevelManagement = lazyWithRetry(() => import('./UserLevelManagement'));

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

const UserManagement: React.FC = () => {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route index element={<UserList />} />
        <Route path="levels" element={<UserLevelManagement />} />
      </Routes>
    </Suspense>
  );
};

export default UserManagement;
