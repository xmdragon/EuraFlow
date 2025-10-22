/**
 * 通知管理Hook - 处理各种 WebSocket 通知展示
 */
import React, { useCallback } from 'react';
import { notification } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { WebSocketNotification, ChatNotificationData, Kuajing84SyncNotificationData, PostingNotificationData } from '@/types/notification';
import { MessageOutlined, CheckCircleOutlined, CloseCircleOutlined, ShoppingOutlined, WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';

export const useNotifications = (shopId: number | null) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
        duration: 6,
        onClick: () => {
          notification.destroy(key);
          if (shopId && chatId) {
            navigate(`/ozon/chat/${chatId}?shopId=${shopId}`);
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
      } catch (error) {
        // 忽略音效错误
      }
    },
    [shopId, navigate]
  );

  const handleKuajing84SyncNotification = useCallback(
    (data: Kuajing84SyncNotificationData) => {
      const key = `kuajing84-sync-${data.sync_log_id}`;

      // 刷新订单数据
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });

      // 显示通知
      const isSuccess = data.status === 'success';
      const title = data.sync_type === 'submit_tracking'
        ? (isSuccess ? '国内单号同步成功' : '国内单号同步失败')
        : (isSuccess ? '订单废弃成功' : '订单废弃失败');

      notification.open({
        key,
        message: title,
        description: data.message,
        icon: isSuccess
          ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
          : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
        placement: 'bottomRight',
        duration: 5,
        style: {
          backgroundColor: isSuccess ? '#f6ffed' : '#fff2f0',
          borderLeft: `4px solid ${isSuccess ? '#52c41a' : '#ff4d4f'}`,
        },
      });
    },
    [queryClient]
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
            navigate(`/ozon/orders?shopId=${shopId}`);
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
      } catch (error) {
        // 忽略音效错误
      }

      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    },
    [shopId, navigate, queryClient]
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
    [queryClient]
  );

  const handlePostingStatusChanged = useCallback(
    (data: PostingNotificationData) => {
      const key = `posting-status-${data.posting_number}-${data.timestamp}`;

      notification.info({
        key,
        message: '订单状态变更',
        description: `订单 ${data.posting_number}\n新状态: ${data.new_status || '未知'}`,
        icon: <InfoCircleOutlined style={{ color: '#1890ff' }} />,
        placement: 'bottomRight',
        duration: 6,
      });

      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    },
    [queryClient]
  );

  const handleWebSocketMessage = useCallback(
    (message: WebSocketNotification) => {
      switch (message.type) {
        case 'connected':
          console.log('WebSocket connected successfully');
          break;

        case 'chat.new_message':
          if (message.shop_id === shopId && message.chat_id && message.data) {
            handleChatNotification(message.data as ChatNotificationData, message.chat_id);
          }
          break;

        case 'kuajing84.sync_completed':
          // 跨境巴士同步完成通知
          if (message.data) {
            handleKuajing84SyncNotification(message.data as Kuajing84SyncNotificationData);
          }
          break;

        case 'posting.created':
          // 新订单创建通知
          if (message.shop_id === shopId && message.data) {
            handlePostingCreated(message.data as PostingNotificationData);
          }
          break;

        case 'posting.cancelled':
          // 订单取消通知
          if (message.shop_id === shopId && message.data) {
            handlePostingCancelled(message.data as PostingNotificationData);
          }
          break;

        case 'posting.status_changed':
          // 订单状态变更通知
          if (message.shop_id === shopId && message.data) {
            handlePostingStatusChanged(message.data as PostingNotificationData);
          }
          break;

        case 'ping':
        case 'pong':
          // 心跳消息，忽略
          break;

        default:
          console.log('Unknown WebSocket message type:', message.type);
      }
    },
    [shopId, handleChatNotification, handleKuajing84SyncNotification, handlePostingCreated, handlePostingCancelled, handlePostingStatusChanged]
  );

  return {
    handleWebSocketMessage,
  };
};
