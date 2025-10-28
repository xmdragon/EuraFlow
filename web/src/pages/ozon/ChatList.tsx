/* eslint-disable no-unused-vars */
/**
 * OZON 聊天列表页面
 */
import {
  MessageOutlined,
  UserOutlined,
  SyncOutlined,
  SearchOutlined,
  ShoppingOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Progress,
} from "antd";
import moment from "moment";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate, useSearchParams } from "react-router-dom";

import styles from "./ChatList.module.scss";

import ShopSelectorWithLabel from "@/components/ozon/ShopSelectorWithLabel";
import PageTitle from "@/components/PageTitle";
import { usePermission } from "@/hooks/usePermission";
import * as ozonApi from "@/services/ozonApi";
import { notifySuccess, notifyError } from "@/utils/notification";
import { getGlobalNotification } from "@/utils/globalNotification";

const { Search } = Input;
const { Text } = Typography;

const ChatList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canOperate, canSync } = usePermission();
  const [searchParams, setSearchParams] = useSearchParams();

  // 从URL参数中读取店铺ID
  const shopIdParam = searchParams.get("shopId");
  const [selectedShopId, setSelectedShopId] = useState<number | null>(
    shopIdParam ? Number(shopIdParam) : null,
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [unreadFilter, setUnreadFilter] = useState<string>("all");
  const [archiveFilter, setArchiveFilter] = useState<string>("normal"); // 归档筛选：normal/archived/all
  const [searchText, setSearchText] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // 当URL参数变化时更新选中的店铺
  useEffect(() => {
    const shopIdParam = searchParams.get("shopId");
    if (shopIdParam) {
      setSelectedShopId(Number(shopIdParam));
    } else {
      setSelectedShopId(null);
    }
  }, [searchParams]);

  // 获取店铺列表
  const { data: shopsData, isLoading: shopsLoading } = useQuery({
    queryKey: ["ozon", "shops"],
    queryFn: ozonApi.getShops,
  });

  const shops = shopsData?.data || [];

  // 构建shop_ids字符串（逗号分隔）
  const shopIdsString = shops.map((s) => s.id).join(",");

  // 获取聊天统计
  const { data: statsData } = useQuery({
    queryKey: ["chatStats", selectedShopId, shopIdsString],
    queryFn: () => ozonApi.getChatStats(selectedShopId, shopIdsString),
    enabled: selectedShopId === null ? !!shopIdsString : true,
  });

  // 轮询聊天同步状态
  const pollChatSyncStatus = async (taskId: string) => {
    const notificationKey = 'chat-sync';
    let completed = false;

    try {
      // 显示初始进度通知
      const notificationInstance = getGlobalNotification();
      if (notificationInstance) {
        notificationInstance.open({
          key: notificationKey,
          message: '聊天同步进行中',
          description: (
            <div>
              <Progress percent={0} size="small" status="active" />
              <div style={{ marginTop: 8 }}>正在启动同步...</div>
            </div>
          ),
          duration: 0, // 不自动关闭
          placement: 'bottomRight',
          icon: <SyncOutlined spin />,
        });
      }

      // 持续轮询状态
      while (!completed) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // 每2秒检查一次
          const result = await ozonApi.getSyncStatus(taskId);
          const status = result.data || result;

          if (status.status === 'completed') {
            completed = true;

            // 显示完成通知
            if (notificationInstance) {
              notificationInstance.destroy(notificationKey);
              notificationInstance.success({
                message: '同步完成',
                description: status.message || '聊天同步已完成',
                placement: 'bottomRight',
                duration: 5,
              });
            }

            // 刷新数据
            queryClient.invalidateQueries({ queryKey: ["chats"] });
            queryClient.invalidateQueries({ queryKey: ["chatStats"] });
          } else if (status.status === 'failed') {
            completed = true;

            // 显示失败通知
            if (notificationInstance) {
              notificationInstance.destroy(notificationKey);
              notificationInstance.error({
                message: '同步失败',
                description: status.message || status.error || '同步失败，请重试',
                placement: 'bottomRight',
                duration: 10,
              });
            }
          } else if (status.status === 'running') {
            // 更新进度通知
            const progress = status.progress || 0;
            const message = status.message || '同步进行中...';

            if (notificationInstance) {
              notificationInstance.open({
                key: notificationKey,
                message: '聊天同步进行中',
                description: (
                  <div>
                    <Progress percent={progress} size="small" status="active" />
                    <div style={{ marginTop: 8 }}>{message}</div>
                  </div>
                ),
                duration: 0,
                placement: 'bottomRight',
                icon: <SyncOutlined spin />,
              });
            }
          }
        } catch (error) {
          // 静默处理轮询错误，继续重试
        }
      }
    } catch (error) {
      // 轮询本身失败
      const notificationInstance = getGlobalNotification();
      if (notificationInstance) {
        notificationInstance.destroy(notificationKey);
        notificationInstance.error({
          message: '同步状态查询失败',
          description: '无法获取同步状态，请刷新页面查看结果',
          placement: 'bottomRight',
          duration: 10,
        });
      }
    }
  };

  // 获取聊天列表
  const {
    data: chatsData,
    isLoading,
    refetch: _refetchChats,
  } = useQuery({
    queryKey: [
      "chats",
      selectedShopId,
      shopIdsString,
      statusFilter,
      unreadFilter,
      archiveFilter,
      searchText,
      currentPage,
    ],
    queryFn: async () => {
      const params: {
        limit: number;
        offset: number;
        shop_ids?: string;
        status?: string;
        has_unread?: boolean;
        is_archived?: boolean;
        order_number?: string;
      } = {
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      };

      // 全部店铺模式下传递 shop_ids
      if (selectedShopId === null) {
        params.shop_ids = shopIdsString;
      }

      if (statusFilter !== "all") {
        params.status = statusFilter;
      }

      if (unreadFilter === "unread") {
        params.has_unread = true;
      } else if (unreadFilter === "read") {
        params.has_unread = false;
      }

      // 归档筛选
      if (archiveFilter === "normal") {
        params.is_archived = false;
      } else if (archiveFilter === "archived") {
        params.is_archived = true;
      }
      // archiveFilter === 'all' 时不传参数

      if (searchText) {
        params.order_number = searchText;
      }

      return ozonApi.getChats(selectedShopId, params);
    },
    enabled: selectedShopId === null ? !!shopIdsString : true,
  });

  // 顺序同步多个店铺
  const syncMultipleShops = async () => {
    const results = [];
    let totalChats = 0;
    let totalMessages = 0;

    for (let i = 0; i < shops.length; i++) {
      const shop = shops[i];
      const displayName =
        shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : "");

      notifySuccess(
        "批量同步进度",
        `正在同步店铺 ${i + 1}/${shops.length}: ${displayName}`,
      );

      try {
        // 启动异步任务
        const taskResponse = await ozonApi.syncChats(shop.id);
        const taskId = taskResponse.task_id;

        if (!taskId) {
          results.push({
            shop_id: shop.id,
            shop_name: displayName,
            error: "未获取到任务ID",
          });
          continue;
        }

        // 等待任务完成（轮询）
        let completed = false;
        let shopResult = null;

        while (!completed) {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // 每2秒检查一次

          try {
            const statusResponse = await ozonApi.getSyncStatus(taskId);
            const status = statusResponse.data || statusResponse;

            if (status.status === "completed") {
              completed = true;
              shopResult = status.result || {};
              totalChats += shopResult.synced_count || 0;
              totalMessages += shopResult.total_new_messages || 0;

              results.push({
                shop_id: shop.id,
                shop_name: displayName,
                ...shopResult,
              });

              notifySuccess(
                `${displayName} 同步完成`,
                `${shopResult.synced_count || 0} 个聊天，${shopResult.total_new_messages || 0} 条新消息`,
              );
            } else if (status.status === "failed") {
              completed = true;
              results.push({
                shop_id: shop.id,
                shop_name: displayName,
                error: status.error || "同步失败",
              });

              notifyError(
                `${displayName} 同步失败`,
                status.error || "未知错误",
              );
            }
            // 状态为 running 时继续轮询
          } catch (error) {
            // 轮询错误，继续重试
          }
        }
      } catch (error) {
        results.push({
          shop_id: shop.id,
          shop_name: displayName,
          error: error.message,
        });
        notifyError(`${displayName} 同步失败`, error.message);
      }
    }

    // 所有店铺完成后显示总结
    notifySuccess(
      "批量同步完成",
      `已同步 ${shops.length} 个店铺，共 ${totalChats} 个聊天，${totalMessages} 条新消息`,
    );

    queryClient.invalidateQueries({ queryKey: ["chats"] });
    queryClient.invalidateQueries({ queryKey: ["chatStats"] });

    return results;
  };

  // 同步聊天
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (selectedShopId === null) {
        // 全部店铺模式：顺序同步所有店铺
        return syncMultipleShops();
      } else {
        // 单店铺模式 - 返回异步任务
        return ozonApi.syncChats(selectedShopId);
      }
    },
    onSuccess: (data) => {
      if (Array.isArray(data)) {
        // 多店铺模式 - syncMultipleShops 已经处理完成并显示通知
        // 这里不需要再做任何处理
      } else {
        // 单店铺模式的结果（异步任务模式）
        const taskId = data.task_id;
        if (taskId) {
          // 开始轮询任务状态
          pollChatSyncStatus(taskId);
        } else {
          notifyError("同步失败", "未获取到任务ID，请稍后重试");
        }
      }
    },
    onError: (error: Error) => {
      notifyError("同步失败", `同步失败: ${error.message}`);
    },
  });

  // 标记为已读
  const markAsReadMutation = useMutation({
    mutationFn: ({ chatId, shopId }: { chatId: string; shopId: number }) => {
      return ozonApi.markChatAsRead(shopId, chatId);
    },
    onSuccess: () => {
      notifySuccess("操作成功", "已标记为已读");
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      queryClient.invalidateQueries({ queryKey: ["chatStats"] });
    },
    onError: (error: Error) => {
      notifyError("操作失败", `操作失败: ${error.message}`);
    },
  });

  // 归档/取消归档
  const archiveMutation = useMutation({
    mutationFn: ({
      chatId,
      shopId,
      isArchived,
    }: {
      chatId: string;
      shopId: number;
      isArchived: boolean;
    }) => {
      return ozonApi.archiveChat(shopId, chatId, isArchived);
    },
    onSuccess: (_data, variables) => {
      notifySuccess("操作成功", variables.isArchived ? "已归档" : "已取消归档");
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      queryClient.invalidateQueries({ queryKey: ["chatStats"] });
    },
    onError: (error: Error) => {
      notifyError("操作失败", `操作失败: ${error.message}`);
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

  const handleArchive = (chat: ozonApi.OzonChat, e: React.MouseEvent) => {
    e.stopPropagation();
    // 使用chat的shop_id，支持全部店铺模式
    archiveMutation.mutate({
      chatId: chat.chat_id,
      shopId: chat.shop_id,
      isArchived: true,
    });
  };

  const handleUnarchive = (chat: ozonApi.OzonChat, e: React.MouseEvent) => {
    e.stopPropagation();
    // 使用chat的shop_id，支持全部店铺模式
    archiveMutation.mutate({
      chatId: chat.chat_id,
      shopId: chat.shop_id,
      isArchived: false,
    });
  };

  const handleSync = () => {
    syncMutation.mutate();
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      open: { color: "green", text: "进行中" },
      closed: { color: "default", text: "已关闭" },
    };
    const config = statusMap[status] || { color: "default", text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  const getChatDisplayName = (chat: ozonApi.OzonChat) => {
    // 如果有客户名称且不是旧数据的"未知客户"，直接显示
    if (chat.customer_name && chat.customer_name !== "未知客户") {
      return chat.customer_name;
    }

    // 根据 chat_type 显示类型标签（全大写格式）
    if (chat.chat_type === "BUYER_SELLER") {
      return "买家";
    } else if (chat.chat_type === "SELLER_SUPPORT") {
      return "Ozon官方";
    } else {
      return "客户";
    }
  };

  return (
    <div>
      <PageTitle icon={<MessageOutlined />} title="聊天管理" />

      <div className={styles.contentContainer}>
        {/* 店铺选择器 */}
        <Card className={styles.shopCard}>
          <ShopSelectorWithLabel
            label="选择店铺"
            value={selectedShopId}
            onChange={(shopId) => {
              const normalized = Array.isArray(shopId)
                ? (shopId[0] ?? null)
                : shopId;
              setSelectedShopId(normalized);
              setCurrentPage(1);
              // 更新URL参数以保持店铺选择状态
              if (normalized === null) {
                searchParams.delete("shopId");
              } else {
                searchParams.set("shopId", String(normalized));
              }
              setSearchParams(searchParams);
            }}
            showAllOption={true}
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
              <Select
                value={archiveFilter}
                onChange={(value) => {
                  setArchiveFilter(value);
                  setCurrentPage(1);
                }}
                className={styles.filterSelect}
              >
                <Select.Option value="normal">正常</Select.Option>
                <Select.Option value="archived">归档</Select.Option>
                <Select.Option value="all">全部</Select.Option>
              </Select>
            </Space>
            <Space>
              {canSync && (
                <Button
                  icon={<SyncOutlined />}
                  loading={syncMutation.isPending}
                  disabled={
                    selectedShopId === null &&
                    (shopsLoading || shops.length === 0)
                  }
                  onClick={handleSync}
                  title={
                    selectedShopId === null
                      ? "将依次同步所有店铺的聊天"
                      : "同步当前店铺的聊天"
                  }
                >
                  {selectedShopId === null
                    ? `同步所有店铺 (${shops.length})`
                    : "同步聊天"}
                </Button>
              )}
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
                    className={`${styles.chatListItem} ${chat.unread_count > 0 ? styles.unread : ""}`}
                    onClick={() => handleChatClick(chat)}
                    actions={
                      canOperate
                        ? [
                            <div
                              key="actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Space direction="vertical" size="small">
                                {chat.unread_count > 0 && (
                                  <Button
                                    type="primary"
                                    size="small"
                                    onClick={(e) => handleMarkAsRead(chat, e)}
                                  >
                                    已读
                                  </Button>
                                )}
                                {chat.is_archived ? (
                                  <Button
                                    size="small"
                                    onClick={(e) => handleUnarchive(chat, e)}
                                  >
                                    取消归档
                                  </Button>
                                ) : (
                                  <Button
                                    size="small"
                                    onClick={(e) => handleArchive(chat, e)}
                                  >
                                    归档
                                  </Button>
                                )}
                              </Space>
                            </div>,
                          ]
                        : []
                    }
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
                          {(!chat.customer_name ||
                            chat.customer_name === "未知客户") &&
                            chat.chat_type === "SELLER_SUPPORT" && (
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
                            {chat.last_message_preview ? (
                              <ReactMarkdown>
                                {chat.last_message_preview}
                              </ReactMarkdown>
                            ) : (
                              "暂无消息"
                            )}
                          </div>
                          <Space size="small">
                            <Text type="secondary" className={styles.chatMeta}>
                              <ClockCircleOutlined />
                              {chat.last_message_at
                                ? moment(chat.last_message_at).format(
                                    "YYYY-MM-DD HH:mm",
                                  )
                                : ""}
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
    </div>
  );
};

export default ChatList;
