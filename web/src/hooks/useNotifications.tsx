/**
 * 通知管理Hook - 处理各种 WebSocket 通知展示
 */
import {
  MessageOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ShoppingOutlined,
  WarningOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  WebSocketNotification,
  ChatNotificationData,
  PostingNotificationData,
  SessionExpiredNotificationData,
} from '@/types/notification';
import authService from '@/services/authService';
import { loggers } from '@/utils/logger';

export const useNotifications = (shopId: number | null) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notification } = App.useApp();

  const handleChatNotification = useCallback(
    (data: ChatNotificationData, chatId: string) => {
      const key = `chat-${chatId}-${data.message_id}`;

      const descriptionText = data.order_number
        ? `${data.message || '收到新消息'}\n订单: ${data.order_number}`
        : data.message || '收到新消息';

      notification.open({
        key,
        message: data.customer_name || '新消息',
        description: descriptionText,
        icon: <MessageOutlined style={{ color: '#1890ff' }} />,
        placement: 'bottomRight',
        duration: 10,
        onClick: () => {
          notification.destroy(key);
          if (shopId && chatId) {
            navigate(`/dashboard/ozon/chat/${chatId}?shopId=${shopId}`);
          }
        },
      });

      // 播放通知音效（可选）
      try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {
          // 忽略自动播放被阻止的错误
        });
      } catch {
        // 忽略音效错误
      }
    },
    [shopId, navigate, notification]
  );

  const handlePostingCreated = useCallback(
    (data: PostingNotificationData) => {
      const key = `posting-created-${data.posting_number}`;

      notification.success({
        key,
        message: '新订单',
        description: `订单 ${data.posting_number}\n商品数量: ${data.product_count || 0}`,
        icon: <ShoppingOutlined style={{ color: '#52c41a' }} />,
        placement: 'bottomRight',
        duration: 8,
        onClick: () => {
          notification.destroy(key);
          if (shopId) {
            navigate(`/dashboard/ozon/packing?shopId=${shopId}&tab=awaiting_stock&posting_number=${data.posting_number}`);
          }
        },
      });

      // 播放音效
      try {
        const audio = new Audio('/notice.mp3');
        audio.volume = 0.8;
        audio.play().catch(() => {
          // 忽略自动播放被阻止的错误
        });
      } catch {
        // 忽略音效错误
      }

      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    },
    [shopId, navigate, queryClient, notification]
  );

  const handlePostingCancelled = useCallback(
    (data: PostingNotificationData) => {
      const key = `posting-cancelled-${data.posting_number}`;

      notification.warning({
        key,
        message: '订单已取消',
        description: `订单 ${data.posting_number}\n原因: ${data.cancel_reason || '无原因'}`,
        icon: <WarningOutlined style={{ color: '#faad14' }} />,
        placement: 'bottomRight',
        duration: 6,
      });

      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    },
    [queryClient, notification]
  );

  const handlePostingStatusChanged = useCallback(
    (data: PostingNotificationData) => {
      const key = `posting-status-${data.posting_number}-${data.timestamp}`;

      // 优先使用中文状态，如果没有则使用英文状态
      const statusDisplay = data.new_status_display || data.new_status || '未知';

      notification.info({
        key,
        message: '订单状态变更',
        description: `订单 ${data.posting_number}\n新状态: ${statusDisplay}`,
        icon: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
        placement: 'bottomRight',
        duration: 6,
      });

      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    },
    [queryClient, notification]
  );

  const handlePostingDelivered = useCallback(
    (data: PostingNotificationData) => {
      const key = `posting-delivered-${data.posting_number}`;

      notification.success({
        key,
        message: '订单已送达',
        description: `订单 ${data.posting_number}\n已成功送达客户`,
        icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
        placement: 'bottomRight',
        duration: 8,
      });

      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    },
    [queryClient, notification]
  );

  // 处理会话过期通知（单设备登录）
  const handleSessionExpired = useCallback(
    (data: SessionExpiredNotificationData) => {
      const key = 'session-expired';

      // 构建描述信息
      let description = data.message || '您的账号在其他设备登录，当前会话已失效';
      if (data.new_device_info) {
        description += `\n设备: ${data.new_device_info}`;
      }
      if (data.new_ip_address) {
        description += `\n IP: ${data.new_ip_address}`;
      }

      notification.warning({
        key,
        message: '登录失效',
        description,
        icon: <WarningOutlined style={{ color: '#faad14' }} />,
        placement: 'topRight',
        duration: 0, // 不自动关闭
        style: {
          backgroundColor: '#fffbe6',
          borderLeft: '4px solid #faad14',
        },
      });

      // 2秒后清除token并跳转到登录页
      setTimeout(() => {
        authService.clearTokens();
        window.location.href = '/login';
      }, 2000);
    },
    [notification]
  );

  const handleWebSocketMessage = useCallback(
    (message: WebSocketNotification) => {
      switch (message.type) {
        case 'connected':
          // WebSocket 连接成功
          break;

        case 'chat.new_message':
          // 聊天新消息通知（全局广播，不过滤店铺）
          if (message.chat_id && message.data) {
            handleChatNotification(message.data as ChatNotificationData, message.chat_id);
          }
          break;

        case 'posting.created':
          // 新订单创建通知（全局广播，不过滤店铺）
          if (message.data) {
            handlePostingCreated(message.data as PostingNotificationData);
          }
          break;

        case 'posting.cancelled':
          // 订单取消通知（全局广播，不过滤店铺）
          if (message.data) {
            handlePostingCancelled(message.data as PostingNotificationData);
          }
          break;

        case 'posting.status_changed':
          // 订单状态变更通知（全局广播，不过滤店铺）
          if (message.data) {
            handlePostingStatusChanged(message.data as PostingNotificationData);
          }
          break;

        case 'posting.delivered':
          // 订单妥投通知（全局广播，不过滤店铺）
          if (message.data) {
            handlePostingDelivered(message.data as PostingNotificationData);
          }
          break;

        case 'session_expired':
          // 单设备登录：会话失效通知
          if (message.data) {
            handleSessionExpired(message.data as SessionExpiredNotificationData);
          }
          break;

        case 'ping':
        case 'pong':
          // 心跳消息，忽略
          break;

        default:
          loggers.notification.debug('Unknown WebSocket message type:', message.type);
      }
    },
    [
      handleChatNotification,
      handlePostingCreated,
      handlePostingCancelled,
      handlePostingStatusChanged,
      handlePostingDelivered,
      handleSessionExpired,
    ]
  );

  return {
    handleWebSocketMessage,
  };
};
