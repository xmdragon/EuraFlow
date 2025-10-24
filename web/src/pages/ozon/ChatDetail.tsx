/**
 * OZON 聊天详情页面
 */
import {
  UserOutlined,
  SendOutlined,
  ArrowLeftOutlined,
  ShoppingOutlined,
  CheckOutlined,
  SyncOutlined,
  MessageOutlined,
  PaperClipOutlined,
  CloseOutlined,
  FileOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Input,
  Button,
  Space,
  Tag,
  Avatar,
  Typography,
  Spin,
  Empty,
  Descriptions,
  Badge,
} from 'antd';
import moment from 'moment';
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import styles from './ChatDetail.module.scss';

import PageTitle from '@/components/PageTitle';
import * as ozonApi from '@/services/ozonApi';
import * as translationApi from '@/services/translationApi';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

const { TextArea } = Input;
const { Text, Title } = Typography;

const ChatDetail: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { chatId } = useParams<{ chatId: string }>();
  const [searchParams] = useSearchParams();
  const shopId = searchParams.get('shopId');

  const [messageText, setMessageText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 获取聊天详情
  const {
    data: chatData,
    isLoading: chatLoading,
    error: chatError,
    isError: isChatError,
  } = useQuery({
    queryKey: ['chatDetail', shopId, chatId],
    queryFn: () => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return ozonApi.getChatDetail(Number(shopId), chatId);
    },
    enabled: !!shopId && !!chatId,
    retry: 1, // 只重试一次
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
    onError: (error: Error) => {
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
    onError: (error: Error) => {
      notifyError('操作失败', `操作失败: ${error.message}`);
    },
  });

  // 懒加载翻译
  const translateMessageMutation = useMutation({
    mutationFn: ({ messageId }: { messageId: string }) => {
      if (!shopId || !chatId) throw new Error('缺少参数');
      return translationApi.translateMessage(Number(shopId), chatId, messageId);
    },
    onMutate: ({ messageId }) => {
      // 设置当前正在翻译的消息ID
      setTranslatingMessageId(messageId);
    },
    onSuccess: (translation, { messageId }) => {
      // 更新本地翻译缓存
      setTranslations((prev) => ({ ...prev, [messageId]: translation }));
    },
    onError: (error: Error) => {
      notifyWarning('翻译失败', `翻译失败: ${error.message}`);
    },
    onSettled: () => {
      // 清除加载状态
      setTranslatingMessageId(null);
    },
  });

  // 发送文件
  const sendFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!shopId || !chatId) throw new Error('缺少参数');

      // 提取原文件扩展名
      const ext = file.name.substring(file.name.lastIndexOf('.'));

      // 生成随机文件名：file_时间戳_随机字符串.扩展名
      // 避免中文文件名导致对方（俄罗斯买家）看不懂
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 11); // 9位随机字符
      const randomFileName = `file_${timestamp}_${randomStr}${ext}`;

      const base64 = await fileToBase64(file);
      return ozonApi.sendChatFile(Number(shopId), chatId, base64, randomFileName);
    },
    onSuccess: () => {
      setSelectedFile(null);
      setFilePreview(null);
      refetchMessages();
      notifySuccess('发送成功', '文件发送成功');
    },
    onError: (error: Error) => {
      notifyError('发送失败', `文件发送失败: ${error.message}`);
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

  // 文件转base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // 移除data URL前缀 (data:image/png;base64,)
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  // 验证文件类型
  const validateFileType = (file: File): boolean => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    return allowedTypes.includes(file.type);
  };

  // 验证文件大小
  const validateFileSize = (file: File): boolean => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    return file.size <= maxSize;
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!validateFileType(file)) {
      notifyError(
        '文件类型不支持',
        '仅支持图片（JPG/PNG/GIF）和文档（PDF/DOC/XLS）格式'
      );
      return;
    }

    // 验证文件大小
    if (!validateFileSize(file)) {
      notifyError('文件过大', '文件大小不能超过10MB');
      return;
    }

    setSelectedFile(file);

    // 为图片生成预览
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }

    // 清空输入框，允许重新选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 移除已选择的文件
  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 发送文件
  const handleSendFile = () => {
    if (!selectedFile) {
      notifyWarning('发送失败', '请先选择要发送的文件');
      return;
    }
    sendFileMutation.mutate(selectedFile);
  };

  // 打开文件选择器
  const handleClickAttachment = () => {
    fileInputRef.current?.click();
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      open: { color: 'green', text: '进行中' },
      closed: { color: 'default', text: '已关闭' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const getChatDisplayName = (chatData: unknown) => {
    // 如果有客户名称且不是旧数据的"未知客户"，直接显示
    if (chatData.customer_name && chatData.customer_name !== '未知客户') {
      return chatData.customer_name;
    }

    // 根据 chat_type 显示类型标签（全大写格式）
    if (chatData.chat_type === 'BUYER_SELLER') {
      return '买家';
    } else if (chatData.chat_type === 'SELLER_SUPPORT') {
      return 'Ozon官方';
    } else {
      return '客户';
    }
  };

  const renderMessage = (msg: ozonApi.OzonChatMessage) => {
    const isSeller = msg.sender_type === 'seller';
    const isSupport = msg.sender_type === 'support';
    // 收到的消息（客户或官方）在左边，发出的消息（卖家）在右边
    const isReceived = !isSeller;

    // 智能显示发送者名称
    const getSenderName = () => {
      if (msg.sender_name) {
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
        className={`${styles.messageContainer} ${isReceived ? styles.userMessage : styles.sellerMessage}`}
      >
        <div
          className={`${styles.messageWrapper} ${isReceived ? styles.userWrapper : styles.sellerWrapper}`}
        >
          <Avatar
            className={`${styles.messageAvatar} ${isReceived ? styles.userAvatar : styles.sellerAvatar}`}
            icon={<UserOutlined />}
          />
          <div>
            <div
              className={`${styles.messageBubble} ${isReceived ? styles.userBubble : styles.sellerBubble}`}
            >
              <div className={styles.senderNameContainer}>
                <Text
                  strong
                  className={`${styles.senderName} ${isReceived ? styles.userName : styles.sellerName}`}
                >
                  {getSenderName()}
                </Text>
              </div>
              <div className={styles.messageContent}>
                {/* 俄语原文或中文内容 */}
                <ReactMarkdown>{msg.content || ''}</ReactMarkdown>

                {/* 中文翻译（如果有） */}
                {(msg.data_cn || translations[msg.message_id]) && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#888', fontStyle: 'italic' }}>
                    {msg.data_cn || translations[msg.message_id]}
                  </div>
                )}

                {/* 懒加载翻译按钮（仅对俄语消息且无翻译时显示） */}
                {!isSeller && !msg.data_cn && !translations[msg.message_id] && (
                  <Button
                    size="small"
                    type="link"
                    loading={translatingMessageId === msg.message_id}
                    onClick={() =>
                      translateMessageMutation.mutate({ messageId: msg.message_id })
                    }
                    style={{ padding: 0, marginTop: 4, fontSize: 12 }}
                  >
                    翻译为中文
                  </Button>
                )}
              </div>
            </div>
            <div
              className={`${styles.messageTimeContainer} ${isReceived ? styles.userTimeContainer : styles.sellerTimeContainer}`}
            >
              <Text type="secondary" className={styles.messageTime}>
                {moment(msg.created_at).format('MM-DD HH:mm')}
                {msg.is_read && <CheckOutlined className={styles.readIcon} />}
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
    <div>
      <PageTitle icon={<MessageOutlined />} title="聊天详情" />

      {/* 返回按钮 */}
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/dashboard/ozon/chats')}
        className={styles.backButton}
      >
        返回聊天列表
      </Button>

      <Spin spinning={chatLoading}>
        {isChatError && (
          <Card>
            <Empty
              description={
                <div>
                  <p>加载聊天详情失败</p>
                  <p className={styles.errorDetail}>
                    {chatError instanceof Error ? chatError.message : '未知错误'}
                  </p>
                </div>
              }
            />
          </Card>
        )}
        {!isChatError && !chatLoading && !chatData && (
          <Card>
            <Empty description="未找到聊天记录" />
          </Card>
        )}
        {!isChatError && chatData && (
          <>
            {/* 聊天信息卡片 */}
            <Card className={styles.chatInfoCard}>
              <Space direction="vertical" className={styles.fullWidthSpace}>
                <div className={styles.chatHeader}>
                  <Space>
                    <Title level={4} className={styles.chatTitle}>
                      {getChatDisplayName(chatData)}
                    </Title>
                    {/* 显示聊天类型标签（仅当没有客户名称或是旧数据时） */}
                    {(!chatData.customer_name || chatData.customer_name === '未知客户') &&
                      chatData.chat_type === 'SELLER_SUPPORT' && <Tag color="orange">客服咨询</Tag>}
                    {getStatusTag(chatData.status)}
                    {chatData.unread_count > 0 && <Badge count={chatData.unread_count} />}
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
                    <Button icon={<SyncOutlined />} onClick={() => refetchMessages()}>
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
                  <Descriptions.Item label="消息数">{chatData.message_count}</Descriptions.Item>
                  <Descriptions.Item label="未读数">{chatData.unread_count}</Descriptions.Item>
                  <Descriptions.Item label="最后消息时间">
                    {chatData.last_message_at
                      ? moment(chatData.last_message_at).format('YYYY-MM-DD HH:mm')
                      : '-'}
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            </Card>

            {/* 消息列表卡片 */}
            <Card title="消息记录" className={styles.messageCard}>
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
                {/* 隐藏的文件输入框 */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />

                {/* 文件预览卡片 */}
                {selectedFile && (
                  <Card
                    size="small"
                    style={{ marginBottom: 12, backgroundColor: '#f5f5f5' }}
                    extra={
                      <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={handleRemoveFile}
                      />
                    }
                  >
                    <Space>
                      {filePreview ? (
                        <img
                          src={filePreview}
                          alt="preview"
                          style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 60,
                            height: 60,
                            backgroundColor: '#e6f7ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 4,
                          }}
                        >
                          <FileOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 500 }}>{selectedFile.name}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {(selectedFile.size / 1024).toFixed(2)} KB
                        </div>
                      </div>
                    </Space>
                  </Card>
                )}

                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <TextArea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={selectedFile ? '可选：添加消息描述...' : '输入消息内容...'}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    onPressEnter={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        if (selectedFile) {
                          handleSendFile();
                        } else {
                          handleSendMessage();
                        }
                      }
                    }}
                    disabled={sendMessageMutation.isPending || sendFileMutation.isPending}
                  />
                  <Space>
                    <Button
                      icon={<PaperClipOutlined />}
                      onClick={handleClickAttachment}
                      disabled={sendMessageMutation.isPending || sendFileMutation.isPending}
                    >
                      附件
                    </Button>
                    {selectedFile ? (
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleSendFile}
                        loading={sendFileMutation.isPending}
                      >
                        发送文件
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleSendMessage}
                        loading={sendMessageMutation.isPending}
                        disabled={!messageText.trim()}
                      >
                        发送 (Ctrl+Enter)
                      </Button>
                    )}
                  </Space>
                </Space>
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
