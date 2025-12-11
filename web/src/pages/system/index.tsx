/**
 * 系统管理主页面
 */
import { Spin } from 'antd';
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载 - 使用带重试机制的加载器防止chunk加载失败
const SyncServices = lazyWithRetry(() => import('./SyncServices'));
const SystemConfiguration = lazyWithRetry(() => import('./SystemConfiguration'));
const LogManagement = lazyWithRetry(() => import('./LogManagement'));
const WatermarkManagement = lazyWithRetry(() => import('../ozon/WatermarkManagement'));
const ImageStorageResources = lazyWithRetry(() => import('./ImageStorageResources'));
const AdminCredits = lazyWithRetry(() => import('../admin/Credits'));

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
        <Route path="logs" element={<LogManagement />} />
        <Route path="watermark" element={<WatermarkManagement />} />
        <Route path="image-storage" element={<ImageStorageResources />} />
        <Route path="credits" element={<AdminCredits />} />
      </Routes>
    </Suspense>
  );
};

export default SystemManagement;
