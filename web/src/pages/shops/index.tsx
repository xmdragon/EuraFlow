/**
 * 店铺管理模块入口
 */
import { Spin } from 'antd';
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载 - 使用带重试机制的加载器防止chunk加载失败
const ShopManagement = lazyWithRetry(() => import('./ShopManagement'));

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

const ShopsModule: React.FC = () => {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route index element={<ShopManagement />} />
      </Routes>
    </Suspense>
  );
};

export default ShopsModule;
