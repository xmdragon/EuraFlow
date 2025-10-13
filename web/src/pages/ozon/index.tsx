/**
 * Ozon 管理主页面
 */
import { Spin } from 'antd';
import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

// 路由懒加载
const Dashboard = lazy(() => import('./Dashboard'));
const OrderList = lazy(() => import('./OrderList'));
const OrderReport = lazy(() => import('./OrderReport'));
const ProductList = lazy(() => import('./ProductList'));
const ShopSettings = lazy(() => import('./ShopSettings'));
const WatermarkManagement = lazy(() => import('./WatermarkManagement'));
const ProductSelection = lazy(() => import('./ProductSelection'));
const ApiKeys = lazy(() => import('./ApiKeys'));
const ChatList = lazy(() => import('./ChatList'));
const ChatDetail = lazy(() => import('./ChatDetail'));
const SyncServices = lazy(() => import('./SyncServices'));

// 加载中组件
const PageLoading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
    <Spin size="large" />
  </div>
);

const OzonManagement: React.FC = () => {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="selection" element={<ProductSelection />} />
        <Route path="products" element={<ProductList />} />
        <Route path="orders" element={<OrderList />} />
        <Route path="reports" element={<OrderReport />} />
        <Route path="watermark" element={<WatermarkManagement />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="sync-services" element={<SyncServices />} />
        <Route path="settings" element={<ShopSettings />} />
        <Route path="chats" element={<ChatList />} />
        <Route path="chat/:chatId" element={<ChatDetail />} />
      </Routes>
    </Suspense>
  );
};

export default OzonManagement;
