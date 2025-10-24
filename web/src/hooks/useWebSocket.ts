/**
 * WebSocket Hook - 管理WebSocket连接和消息
 */
import { useEffect, useRef, useState, useCallback } from 'react';

import authService from '@/services/authService';
import { WebSocketNotification, WebSocketMessage } from '@/types/notification';
import { notifyWarning } from '@/utils/notification';

interface UseWebSocketOptions {
  url: string;
  token: string | null;
  shopIds?: number[];
  enabled?: boolean; // 新增：是否启用连接
  onMessage?: (message: WebSocketNotification) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  autoReconnect?: boolean;
  reconnectDelay?: number;
}

export const useWebSocket = (options: UseWebSocketOptions) => {
  const {
    url,
    token,
    shopIds = [],
    enabled = true, // 默认启用
    onMessage,
    onConnected,
    onDisconnected,
    autoReconnect = true,
    reconnectDelay = 5000,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 新增：cleanup延迟定时器

  // 使用 ref 保存回调函数，避免它们的变化导致重连
  const onMessageRef = useRef(onMessage);
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectedRef.current = onConnected;
    onDisconnectedRef.current = onDisconnected;
  });

  // 将 shopIds 转换为字符串，避免数组引用变化导致重连
  const shopIdsStr = shopIds.join(',');

  const connect = useCallback(() => {
    if (!token) {
      setConnectionError('No authentication token');
      return;
    }

    try {
      const shopIdsParam = shopIdsStr ? `&shop_ids=${shopIdsStr}` : '';
      const wsUrl = `${url}?token=${token}${shopIdsParam}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        onConnectedRef.current?.();

        // 启动心跳
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketNotification = JSON.parse(event.data);
          onMessageRef.current?.(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionError('Connection error');
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', {
          code: event.code,
          reason: event.reason,
        });
        setIsConnected(false);
        onDisconnectedRef.current?.();

        // 清理心跳
        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }

        // 检查是否是认证失败导致的关闭
        // 更严格的认证失败判断：只有明确的认证错误才清除token
        // WebSocket关闭码：1008 = 策略违规（需配合reason判断是否认证失败）
        // WebSocket关闭码：4001 = 自定义认证失败码
        const isAuthFailure =
          (event.code === 1008 && event.reason?.toLowerCase().includes('authentication')) ||
          event.code === 4001;

        if (isAuthFailure) {
          console.error('WebSocket closed due to authentication failure', {
            code: event.code,
            reason: event.reason,
          });
          // 清除token并跳转到登录页
          authService.clearTokens();
          if (window.location.pathname !== '/login') {
            notifyWarning('登录过期', '登录已过期，请重新登录');
            setTimeout(() => {
              window.location.href = '/login';
            }, 500);
          }
          return; // 不进行重连
        }

        // 非认证失败的断开（如网络抖动、超时等）
        console.log('WebSocket closed, will attempt reconnect', {
          code: event.code,
          reason: event.reason,
        });

        // 自动重连（非认证失败的情况）
        if (autoReconnect) {
          reconnectTimerRef.current = setTimeout(() => {
            console.log('Reconnecting WebSocket...');
            connect();
          }, reconnectDelay);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionError('Failed to connect');
    }
  }, [url, token, shopIdsStr, autoReconnect, reconnectDelay]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // 主要连接管理逻辑
  useEffect(() => {
    // 清除之前的cleanup定时器（如果组件重新渲染）
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    // 只有enabled=true且有token时才连接
    if (enabled && token) {
      // 如果已有连接但token变了，先断开再重连
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        disconnect();
      }
      connect();
    } else {
      // enabled=false或无token时断开连接
      disconnect();
    }

    return () => {
      // 延迟断开：避免因组件重新渲染导致不必要的断开
      // 如果enabled=false，立即断开；否则延迟100ms
      if (!enabled) {
        disconnect();
      } else {
        cleanupTimerRef.current = setTimeout(() => {
          // 100ms后再检查，如果此时仍需要断开则执行
          disconnect();
        }, 100);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);

  return {
    isConnected,
    connectionError,
    sendMessage,
    reconnect: connect,
  };
};
