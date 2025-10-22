/**
 * OZON 聊天详情页面
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  List,
  Input,
  Button,
  Space,
  Tag,
  Avatar,
  Typography,
  Spin,
  Empty,
  Descriptions,
  Modal,
  Badge,
} from 'antd';
import {
  UserOutlined,
  SendOutlined,
  ArrowLeftOutlined,
  ShoppingOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import moment from 'moment';
import ReactMarkdown from 'react-markdown';

import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import * as ozonApi from '@/services/ozonApi';
import styles from './ChatDetail.module.scss';

const { TextArea } = Input;
const { Text, Title } = Typography;

const ChatDetail: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { chatId } = useParams<{ chatId: string }>();
  const [searchParams] = useSearchParams();
  const shopId = searchParams.get('shopId');

  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 获取聊天详情
  const { data: chatData, isLoading: chatLoading } = useQuery({
    queryKey: ['chatDetail', shopId, chatId],
    queryFn: () => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return ozonApi.getChatDetail(Number(shopId), chatId);
    },
    enabled: !!shopId && !!chatId,
  });

  // 获取消息列表
  const {
    data: messagesData,
    isLoading: messagesLoading,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['chatMessages', shopId, chatId],
    queryFn: () => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return ozonApi.getChatMessages(Number(shopId), chatId, { limit: 100 });
    },
    enabled: !!shopId && !!chatId,
    refetchInterval: 10000, // 每10秒自动刷新
  });

  // 发送消息
  const sendMessageMutation = useMutation({
    mutationFn: (content: string) => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return ozonApi.sendChatMessage(Number(shopId), chatId, content);
    },
    onSuccess: () => {
      setMessageText('');
      refetchMessages();
      notifySuccess('发送成功', '消息发送成功');
    },
    onError: (error: any) => {
      notifyError('发送失败', `发送失败: ${error.message}`);
    },
  });

  // 标记已读
  const markAsReadMutation = useMutation({
    mutationFn: () => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return ozonApi.markChatAsRead(Number(shopId), chatId);
    },
    onSuccess: () => {
      notifySuccess('操作成功', '已标记为已读');
      queryClient.invalidateQueries({ queryKey: ['chatDetail'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatStats'] });
    },
    onError: (error: any) => {
      notifyError('操作失败', `操作失败: ${error.message}`);
    },
  });

  // 关闭聊天
  const closeChatMutation = useMutation({
    mutationFn: () => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return ozonApi.closeChat(Number(shopId), chatId);
    },
    onSuccess: () => {
      notifySuccess('操作成功', '聊天已关闭');
      queryClient.invalidateQueries({ queryKey: ['chatDetail'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (error: any) => {
      notifyError('操作失败', `操作失败: ${error.message}`);
    },
  });

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messagesData]);

  const handleSendMessage = () => {
    if (!messageText.trim()) {
      notifyWarning('发送失败', '请输入消息内容');
      return;
    }
    sendMessageMutation.mutate(messageText);
  };

  const handleMarkAsRead = () => {
    markAsReadMutation.mutate();
  };

  const handleCloseChat = () => {
    Modal.confirm({
      title: '确认关闭聊天',
      content: '关闭后将无法继续发送消息，确定要关闭吗？',
      onOk: () => {
        closeChatMutation.mutate();
      },
    });
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      open: { color: 'green', text: '进行中' },
      closed: { color: 'default', text: '已关闭' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const renderMessage = (msg: ozonApi.OzonChatMessage) => {
    const isUser = msg.sender_type === 'user';
    const isSeller = msg.sender_type === 'seller';
    const isSupport = msg.sender_type === 'support';

    // 智能显示发送者名称
    const getSenderName = () => {
      if (msg.sender_name && msg.sender_name !== '未知客户') {
        return msg.sender_name;
      }

      if (isSupport) {
        return 'Ozon官方';
      } else if (isSeller) {
        return '卖家';
      } else {
        return '客户';
      }
    };

    return (
      <div
        key={msg.id}
        className={`${styles.messageContainer} ${isUser ? styles.userMessage : styles.sellerMessage}`}
      >
        <div
          className={`${styles.messageWrapper} ${isUser ? styles.userWrapper : styles.sellerWrapper}`}
        >
          <Avatar
            className={`${styles.messageAvatar} ${isUser ? styles.userAvatar : styles.sellerAvatar}`}
            icon={<UserOutlined />}
          />
          <div>
            <div
              className={`${styles.messageBubble} ${isUser ? styles.userBubble : styles.sellerBubble}`}
            >
              <div className={styles.senderNameContainer}>
                <Text
                  strong
                  className={`${styles.senderName} ${isUser ? styles.userName : styles.sellerName}`}
                >
                  {getSenderName()}
                </Text>
              </div>
              <div className={styles.messageContent}>
                <ReactMarkdown>{msg.content || ''}</ReactMarkdown>
              </div>
            </div>
            <div
              className={`${styles.messageTimeContainer} ${isUser ? styles.userTimeContainer : styles.sellerTimeContainer}`}
            >
              <Text type="secondary" className={styles.messageTime}>
                {moment(msg.created_at).format('MM-DD HH:mm')}
                {msg.is_read && (
                  <CheckOutlined className={styles.readIcon} />
                )}
              </Text>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!shopId || !chatId) {
    return (
      <div className={styles.emptyContainer}>
        <Empty description="缺少必要参数" />
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      {/* 返回按钮 */}
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/dashboard/ozon/chats')}
        className={styles.backButton}
      >
        返回聊天列表
      </Button>

      <Spin spinning={chatLoading}>
        {chatData && (
          <>
            {/* 聊天信息卡片 */}
            <Card className={styles.chatInfoCard}>
              <Space direction="vertical" className={styles.fullWidthSpace}>
                <div className={styles.chatHeader}>
                  <Space>
                    <Title level={4} className={styles.chatTitle}>
                      {chatData.customer_name || '未知客户'}
                    </Title>
                    {getStatusTag(chatData.status)}
                    {chatData.unread_count > 0 && (
                      <Badge count={chatData.unread_count} />
                    )}
                  </Space>
                  <Space>
                    {chatData.unread_count > 0 && (
                      <Button
                        icon={<CheckOutlined />}
                        onClick={handleMarkAsRead}
                        loading={markAsReadMutation.isPending}
                      >
                        标记已读
                      </Button>
                    )}
                    {chatData.status === 'open' && (
                      <Button
                        icon={<CloseOutlined />}
                        danger
                        onClick={handleCloseChat}
                        loading={closeChatMutation.isPending}
                      >
                        关闭聊天
                      </Button>
                    )}
                    <Button
                      icon={<SyncOutlined />}
                      onClick={() => refetchMessages()}
                    >
                      刷新
                    </Button>
                  </Space>
                </div>
                <Descriptions size="small" column={4}>
                  {chatData.order_number && (
                    <Descriptions.Item label="订单号">
                      <Tag icon={<ShoppingOutlined />} color="blue">
                        {chatData.order_number}
                      </Tag>
                    </Descriptions.Item>
                  )}
                  <Descriptions.Item label="消息数">
                    {chatData.message_count}
                  </Descriptions.Item>
                  <Descriptions.Item label="未读数">
                    {chatData.unread_count}
                  </Descriptions.Item>
                  <Descriptions.Item label="最后消息时间">
                    {chatData.last_message_at
                      ? moment(chatData.last_message_at).format('YYYY-MM-DD HH:mm')
                      : '-'}
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            </Card>

            {/* 消息列表卡片 */}
            <Card
              title="消息记录"
              className={styles.messageCard}
            >
              <Spin spinning={messagesLoading}>
                {messagesData?.items && messagesData.items.length > 0 ? (
                  <div>
                    {messagesData.items.map(renderMessage)}
                    <div ref={messagesEndRef} />
                  </div>
                ) : (
                  <Empty description="暂无消息" />
                )}
              </Spin>
            </Card>

            {/* 发送消息卡片 */}
            {chatData.status === 'open' && (
              <Card>
                <Space.Compact className={styles.sendCompact}>
                  <TextArea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="输入消息内容..."
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    onPressEnter={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        handleSendMessage();
                      }
                    }}
                    disabled={sendMessageMutation.isPending}
                  />
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={handleSendMessage}
                    loading={sendMessageMutation.isPending}
                    className={styles.sendButton}
                  >
                    发送 (Ctrl+Enter)
                  </Button>
                </Space.Compact>
              </Card>
            )}
            {chatData.status === 'closed' && (
              <Card>
                <Empty description="聊天已关闭，无法发送消息" />
              </Card>
            )}
          </>
        )}
      </Spin>
    </div>
  );
};

export default ChatDetail;
