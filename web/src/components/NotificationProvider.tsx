/**
 * 全局通知Provider - 管理WebSocket连接和通知
 */
import React, { useEffect, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useNotifications } from '@/hooks/useNotifications';

interface NotificationProviderProps {
  children: React.ReactNode;
}

const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [shopIds, setShopIds] = useState<number[]>([]);

  // 从localStorage获取token和当前店铺
  useEffect(() => {
    const accessToken = localStorage.getItem('access_token');
    setToken(accessToken);

    // 监听店铺变化（可选）
    const handleStorageChange = () => {
      const newToken = localStorage.getItem('access_token');
      setToken(newToken);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const { handleWebSocketMessage } = useNotifications(shopIds[0] || null);

  // 建立WebSocket连接
  const { isConnected, connectionError } = useWebSocket({
    url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ef/v1/notifications/ws`,
    token,
    shopIds,
    onMessage: handleWebSocketMessage,
    onConnected: () => {
      console.log('通知系统已连接');
    },
    onDisconnected: () => {
      console.log('通知系统已断开');
    },
    autoReconnect: true,
    reconnectDelay: 5000,
  });

  // 显示连接状态（开发模式）
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('WebSocket connection status:', {
        isConnected,
        connectionError,
        token: token ? '***' : null,
        shopIds,
      });
    }
  }, [isConnected, connectionError, token, shopIds]);

  return <>{children}</>;
};

export default NotificationProvider;
