/**
 * 全局通知Provider - 管理WebSocket连接和通知
 */
import React, { useEffect, useState } from 'react';

import { useNotifications } from '@/hooks/useNotifications';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { User } from '@/types/auth';

interface NotificationProviderProps {
  children: React.ReactNode;
  user: User | null;
}

const NotificationProvider: React.FC<NotificationProviderProps> = ({ children, user }) => {
  const [token, setToken] = useState<string | null>(null);
  const [shopIds, setShopIds] = useState<number[]>([]);

  // 从localStorage获取token
  useEffect(() => {
    const accessToken = localStorage.getItem('access_token');
    setToken(accessToken);

    // 监听storage变化（跨标签页token同步）
    const handleStorageChange = () => {
      const newToken = localStorage.getItem('access_token');
      setToken(newToken);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // 从用户对象获取关联的店铺ID列表
  useEffect(() => {
    if (user?.shop_ids) {
      setShopIds(user.shop_ids);
    } else {
      setShopIds([]);
    }
  }, [user]);

  const { handleWebSocketMessage } = useNotifications(shopIds[0] || null);

  // 建立WebSocket连接
  // 只有用户登录且有token时才启用连接
  const enabled = !!(user && token);

  const { isConnected, connectionError } = useWebSocket({
    url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ef/v1/notifications/ws`,
    token,
    shopIds,
    enabled, // 新增：控制是否建立连接
    onMessage: handleWebSocketMessage,
    onConnected: () => {
      // WebSocket 已连接
    },
    onDisconnected: () => {
      // WebSocket 已断开
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
