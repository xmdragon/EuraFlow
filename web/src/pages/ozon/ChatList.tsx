/**
 * OZON 聊天列表页面
 */
import React, { useState } from 'react';
import {
  Card,
  List,
  Badge,
  Tag,
  Button,
  Space,
  Input,
  Select,
  Statistic,
  Row,
  Col,
  message,
  Avatar,
  Typography,
  Spin,
  Empty,
} from 'antd';
import {
  MessageOutlined,
  UserOutlined,
  SyncOutlined,
  SearchOutlined,
  ShoppingOutlined,
  ClockCircleOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';

import * as ozonApi from '@/services/ozonApi';
import ShopSelector from '@/components/ozon/ShopSelector';
import styles from './ChatList.module.scss';

const { Search } = Input;
const { Text } = Typography;

const ChatList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [unreadFilter, setUnreadFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // 获取聊天统计
  const { data: statsData } = useQuery({
    queryKey: ['chatStats', selectedShopId],
    queryFn: () => selectedShopId ? ozonApi.getChatStats(selectedShopId) : null,
    enabled: !!selectedShopId,
  });

  // 获取聊天列表
  const {
    data: chatsData,
    isLoading,
    refetch: refetchChats,
  } = useQuery({
    queryKey: ['chats', selectedShopId, statusFilter, unreadFilter, searchText, currentPage],
    queryFn: async () => {
      if (!selectedShopId) return null;

      const params: any = {
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      };

      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      if (unreadFilter === 'unread') {
        params.has_unread = true;
      } else if (unreadFilter === 'read') {
        params.has_unread = false;
      }

      if (searchText) {
        params.order_number = searchText;
      }

      return ozonApi.getChats(selectedShopId, params);
    },
    enabled: !!selectedShopId,
  });

  // 同步聊天
  const syncMutation = useMutation({
    mutationFn: () => {
      if (!selectedShopId) throw new Error('未选择店铺');
      return ozonApi.syncChats(selectedShopId);
    },
    onSuccess: (data) => {
      message.success(`同步成功: 新增 ${data.new_count} 个聊天，更新 ${data.updated_count} 个聊天`);
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatStats'] });
    },
    onError: (error: any) => {
      message.error(`同步失败: ${error.message}`);
    },
  });

  // 标记为已读
  const markAsReadMutation = useMutation({
    mutationFn: ({ chatId }: { chatId: string }) => {
      if (!selectedShopId) throw new Error('未选择店铺');
      return ozonApi.markChatAsRead(selectedShopId, chatId);
    },
    onSuccess: () => {
      message.success('已标记为已读');
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatStats'] });
    },
    onError: (error: any) => {
      message.error(`操作失败: ${error.message}`);
    },
  });

  const handleChatClick = (chat: ozonApi.OzonChat) => {
    navigate(`/ozon/chat/${chat.chat_id}?shopId=${selectedShopId}`);
  };

  const handleMarkAsRead = (chat: ozonApi.OzonChat, e: React.MouseEvent) => {
    e.stopPropagation();
    markAsReadMutation.mutate({ chatId: chat.chat_id });
  };

  const handleSync = () => {
    syncMutation.mutate();
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      open: { color: 'green', text: '进行中' },
      closed: { color: 'default', text: '已关闭' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  return (
    <div>
      {/* 店铺选择器 */}
      <Card className={styles.shopCard}>
        <ShopSelector
          value={selectedShopId}
          onChange={(shopId) => {
            setSelectedShopId(shopId);
            setCurrentPage(1);
          }}
        />
      </Card>

      {selectedShopId && (
        <>
          {/* 统计卡片 */}
          <Row gutter={16} className={styles.statsRow}>
            <Col span={6}>
              <Card>
                <Statistic
                  title="总聊天数"
                  value={statsData?.total_chats || 0}
                  prefix={<MessageOutlined />}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <div className={styles.successValue}>
                  <Statistic
                    title="活跃聊天"
                    value={statsData?.active_chats || 0}
                    prefix={<MessageOutlined />}
                  />
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <div className={styles.errorValue}>
                  <Statistic
                    title="未读消息"
                    value={statsData?.total_unread || 0}
                    prefix={<Badge status="error" />}
                  />
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="未读聊天"
                  value={statsData?.unread_chats || 0}
                  prefix={<UserOutlined />}
                />
              </Card>
            </Col>
          </Row>

          {/* 筛选和操作栏 */}
          <Card className={styles.filterCard}>
            <Space wrap className={styles.filterSpace}>
              <Space>
                <Search
                  placeholder="搜索订单号"
                  allowClear
                  className={styles.searchInput}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onSearch={() => setCurrentPage(1)}
                  prefix={<SearchOutlined />}
                />
                <Select
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value);
                    setCurrentPage(1);
                  }}
                  className={styles.filterSelect}
                >
                  <Select.Option value="all">全部状态</Select.Option>
                  <Select.Option value="open">进行中</Select.Option>
                  <Select.Option value="closed">已关闭</Select.Option>
                </Select>
                <Select
                  value={unreadFilter}
                  onChange={(value) => {
                    setUnreadFilter(value);
                    setCurrentPage(1);
                  }}
                  className={styles.filterSelect}
                >
                  <Select.Option value="all">全部消息</Select.Option>
                  <Select.Option value="unread">未读</Select.Option>
                  <Select.Option value="read">已读</Select.Option>
                </Select>
              </Space>
              <Space>
                <Button
                  icon={<SyncOutlined />}
                  loading={syncMutation.isPending}
                  onClick={handleSync}
                >
                  同步聊天
                </Button>
              </Space>
            </Space>
          </Card>

          {/* 聊天列表 */}
          <Card className={styles.listCard}>
            <Spin spinning={isLoading}>
              {chatsData?.items && chatsData.items.length > 0 ? (
                <List
                  itemLayout="horizontal"
                  dataSource={chatsData.items}
                  pagination={{
                    current: currentPage,
                    pageSize: pageSize,
                    total: chatsData.total,
                    onChange: (page) => setCurrentPage(page),
                    showSizeChanger: false,
                    showTotal: (total) => `共 ${total} 个聊天`,
                  }}
                  renderItem={(chat) => (
                    <List.Item
                      className={`${styles.chatListItem} ${chat.unread_count > 0 ? styles.unread : ''}`}
                      onClick={() => handleChatClick(chat)}
                      actions={[
                        chat.unread_count > 0 && (
                          <Button
                            type="link"
                            size="small"
                            icon={<CheckOutlined />}
                            onClick={(e) => handleMarkAsRead(chat, e)}
                          >
                            标记已读
                          </Button>
                        ),
                      ].filter(Boolean)}
                    >
                      <List.Item.Meta
                        avatar={
                          <Badge count={chat.unread_count} offset={[-5, 5]}>
                            <Avatar icon={<UserOutlined />} />
                          </Badge>
                        }
                        title={
                          <Space>
                            <Text strong>{chat.customer_name || '未知客户'}</Text>
                            {getStatusTag(chat.status)}
                            {chat.order_number && (
                              <Tag icon={<ShoppingOutlined />} color="blue">
                                {chat.order_number}
                              </Tag>
                            )}
                          </Space>
                        }
                        description={
                          <div>
                            <div className={styles.chatMessage}>
                              {chat.last_message_preview || '暂无消息'}
                            </div>
                            <Space size="small">
                              <Text type="secondary" className={styles.chatMeta}>
                                <ClockCircleOutlined />
                                {chat.last_message_at
                                  ? moment(chat.last_message_at).format('YYYY-MM-DD HH:mm')
                                  : ''}
                              </Text>
                              <Text type="secondary" className={styles.chatMeta}>
                                {chat.message_count} 条消息
                              </Text>
                            </Space>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="暂无聊天" />
              )}
            </Spin>
          </Card>
        </>
      )}
    </div>
  );
};

export default ChatList;
