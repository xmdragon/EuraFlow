/**
 * 通知管理Hook - 处理聊天通知展示
 */
import React, { useCallback } from 'react';
import { notification } from 'antd';
import { useNavigate } from 'react-router-dom';
import { WebSocketNotification, ChatNotificationData } from '@/types/notification';
import { MessageOutlined, UserOutlined } from '@ant-design/icons';

export const useNotifications = (shopId: number | null) => {
  const navigate = useNavigate();

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
          notification.close(key);
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

        case 'ping':
        case 'pong':
          // 心跳消息，忽略
          break;

        default:
          console.log('Unknown WebSocket message type:', message.type);
      }
    },
    [shopId, handleChatNotification]
  );

  return {
    handleWebSocketMessage,
  };
};
