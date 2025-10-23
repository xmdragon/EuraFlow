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
import { notifySuccess, notifyError } from '@/utils/notification';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
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

  // 获取店铺列表
  const { data: shopsData, isLoading: shopsLoading } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: ozonApi.getShops,
  });

  const shops = shopsData?.data || [];

  // 构建shop_ids字符串（逗号分隔）
  const shopIdsString = shops.map((s: any) => s.id).join(',');

  // 获取聊天统计
  const { data: statsData } = useQuery({
    queryKey: ['chatStats', selectedShopId, shopIdsString],
    queryFn: () => ozonApi.getChatStats(selectedShopId, shopIdsString),
    enabled: selectedShopId === null ? !!shopIdsString : true,
  });

  // 获取聊天列表
  const {
    data: chatsData,
    isLoading,
    refetch: refetchChats,
  } = useQuery({
    queryKey: ['chats', selectedShopId, shopIdsString, statusFilter, unreadFilter, searchText, currentPage],
    queryFn: async () => {
      const params: any = {
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      };

      // 全部店铺模式下传递 shop_ids
      if (selectedShopId === null) {
        params.shop_ids = shopIdsString;
      }

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
    enabled: selectedShopId === null ? !!shopIdsString : true,
  });

  // 同步聊天
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (selectedShopId === null) {
        // 全部店铺模式：批量同步所有店铺
        const results = [];
        for (let i = 0; i < shops.length; i++) {
          const shop = shops[i];
          const displayName = shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : '');
          notifySuccess(`同步进度`, `正在同步店铺 ${i + 1}/${shops.length}: ${displayName}`);

          try {
            const result = await ozonApi.syncChats(shop.id);
            results.push({ shop_id: shop.id, shop_name: displayName, ...result });
          } catch (error: any) {
            results.push({ shop_id: shop.id, shop_name: displayName, error: error.message });
          }
        }
        return results;
      } else {
        // 单店铺模式
        return ozonApi.syncChats(selectedShopId);
      }
    },
    onSuccess: (data) => {
      if (Array.isArray(data)) {
        // 全部店铺模式的结果
        const total = data.reduce((sum, r) => sum + (r.new_count || 0) + (r.updated_count || 0), 0);
        const totalMessages = data.reduce((sum, r) => sum + (r.total_new_messages || 0), 0);
        notifySuccess(
          '批量同步完成',
          `已同步 ${data.length} 个店铺，共 ${total} 个聊天，${totalMessages} 条新消息`
        );
      } else {
        // 单店铺模式的结果
        notifySuccess(
          '同步成功',
          `新增 ${data.new_count} 个聊天，更新 ${data.updated_count} 个聊天，${data.total_new_messages || 0} 条新消息`
        );
      }
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatStats'] });
    },
    onError: (error: any) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 标记为已读
  const markAsReadMutation = useMutation({
    mutationFn: ({ chatId, shopId }: { chatId: string; shopId: number }) => {
      return ozonApi.markChatAsRead(shopId, chatId);
    },
    onSuccess: () => {
      notifySuccess('操作成功', '已标记为已读');
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatStats'] });
    },
    onError: (error: any) => {
      notifyError('操作失败', `操作失败: ${error.message}`);
    },
  });

  const handleChatClick = (chat: ozonApi.OzonChat) => {
    // 使用chat的shop_id，支持全部店铺模式
    navigate(`/dashboard/ozon/chat/${chat.chat_id}?shopId=${chat.shop_id}`);
  };

  const handleMarkAsRead = (chat: ozonApi.OzonChat, e: React.MouseEvent) => {
    e.stopPropagation();
    // 使用chat的shop_id，支持全部店铺模式
    markAsReadMutation.mutate({ chatId: chat.chat_id, shopId: chat.shop_id });
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

  const getChatDisplayName = (chat: ozonApi.OzonChat) => {
    // 如果有客户名称且不是旧数据的"未知客户"，直接显示
    if (chat.customer_name && chat.customer_name !== '未知客户') {
      return chat.customer_name;
    }

    // 根据 chat_type 显示类型标签（全大写格式）
    if (chat.chat_type === 'BUYER_SELLER') {
      return '买家';
    } else if (chat.chat_type === 'SELLER_SUPPORT') {
      return 'Ozon官方';
    } else {
      return '客户';
    }
  };

  return (
    <div>
      <PageTitle icon={<MessageOutlined />} title="聊天管理" />

      {/* 店铺选择器 */}
      <Card className={styles.shopCard}>
        <ShopSelector
          value={selectedShopId}
          onChange={(shopId) => {
            const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : shopId;
            setSelectedShopId(normalized);
            setCurrentPage(1);
          }}
          showAllOption={false}
        />
      </Card>

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
                  disabled={selectedShopId === null && (shopsLoading || shops.length === 0)}
                  onClick={handleSync}
                  title={selectedShopId === null ? '将依次同步所有店铺的聊天' : '同步当前店铺的聊天'}
                >
                  {selectedShopId === null ? `同步所有店铺 (${shops.length})` : '同步聊天'}
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
                            <Text strong>{getChatDisplayName(chat)}</Text>
                            {/* 全部店铺模式下显示店铺名称 */}
                            {selectedShopId === null && chat.shop_name && (
                              <Tag color="purple">{chat.shop_name}</Tag>
                            )}
                            {/* 显示聊天类型标签（仅当没有客户名称或是旧数据时） */}
                            {(!chat.customer_name || chat.customer_name === '未知客户') && chat.chat_type === 'SELLER_SUPPORT' && (
                              <Tag color="orange">客服咨询</Tag>
                            )}
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
    </div>
  );
};

export default ChatList;
