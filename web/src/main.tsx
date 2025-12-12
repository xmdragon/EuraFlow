import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';

import ErrorBoundary from '@/components/ErrorBoundary';
import NotificationInitializer from '@/components/NotificationInitializer';
import { AuthProvider } from '@/hooks/useAuth';
import { initHMRErrorHandler } from '@/utils/hmrErrorHandler';
import { initPerformanceMonitoring } from '@/utils/performanceMonitoring';
import './services/simpleAxios'; // 导入简化的axios配置
import './index.css';

// 初始化 HMR 错误处理（仅开发环境）
initHMRErrorHandler();

// 开发环境性能监控（react-scan + stats.js）
if (import.meta.env.MODE === 'development') {
  initPerformanceMonitoring();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 查询失败时重试 1 次（默认 3 次太多）
      retry: 1,
      // 不自动抛出错误，由组件层面处理数据加载失败
      throwOnError: false,
      // 缓存优化：数据在 30 秒内不会被认为过期
      staleTime: 30 * 1000,
      // 缓存保留时间：5 分钟内未使用的数据才会被垃圾回收
      gcTime: 5 * 60 * 1000,
      // 禁用窗口焦点时自动重新获取（减少不必要的请求）
      refetchOnWindowFocus: false,
      // 禁用重新连接时自动重新获取
      refetchOnReconnect: false,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  // StrictMode 已关闭：避免开发时双重渲染导致 API 重复请求
  // <React.StrictMode>
  //   ...
  // </React.StrictMode>
  <>
    {/* 全局错误边界：捕获整个应用的未处理错误 */}
    <ErrorBoundary name="应用根组件">
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={zhCN}>
          <AntApp>
            <NotificationInitializer>
              <BrowserRouter
                future={{
                  v7_startTransition: true,
                  v7_relativeSplatPath: true,
                }}
              >
                <AuthProvider>
                  <App />
                </AuthProvider>
              </BrowserRouter>
            </NotificationInitializer>
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </>
);
