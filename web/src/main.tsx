import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AuthProvider } from '@/hooks/useAuth'
import App from './App'
import './services/simpleAxios' // 导入简化的axios配置
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN}>
        <BrowserRouter future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)