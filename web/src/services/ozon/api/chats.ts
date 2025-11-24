/**
 * OZON 聊天 API
 */

import { apiClient } from '../client';
import type { OzonChat, OzonChatMessage, ChatStats } from '../types/chat';

/**
 * 获取聊天列表
 */
export const getChats = async (
  shopId: number | null,
  params?: {
    status?: string;
    has_unread?: boolean;
    order_number?: string;
    limit?: number;
    offset?: number;
    shop_ids?: string; // 全部店铺模式下传递的店铺ID列表
  },
): Promise<{
  items: OzonChat[];
  total: number;
  limit: number;
  offset: number;
}> => {
  // 如果shopId为null，使用全部店铺端点
  const url = shopId === null ? "/ozon/chats/all" : `/ozon/chats/${shopId}`;
  const response = await apiClient.get(url, { params });
  return response.data.data;
};

/**
 * 获取聊天详情
 */
export const getChatDetail = async (
  shopId: number,
  chatId: string,
): Promise<OzonChat> => {
  const response = await apiClient.get(`/ozon/chats/${shopId}/${chatId}`);
  return response.data.data;
};

/**
 * 获取聊天消息列表
 */
export const getChatMessages = async (
  shopId: number,
  chatId: string,
  params?: {
    limit?: number;
    offset?: number;
    before_message_id?: string;
  },
): Promise<{ items: OzonChatMessage[]; total: number; chat_id: string }> => {
  const response = await apiClient.get(
    `/ozon/chats/${shopId}/${chatId}/messages`,
    { params },
  );
  return response.data.data;
};

/**
 * 发送消息
 */
export const sendChatMessage = async (
  shopId: number,
  chatId: string,
  content: string,
): Promise<unknown> => {
  const response = await apiClient.post(
    `/ozon/chats/${shopId}/${chatId}/messages`,
    { content },
  );
  return response.data.data;
};

/**
 * 发送文件
 */
export const sendChatFile = async (
  shopId: number,
  chatId: string,
  base64Content: string,
  fileName: string,
): Promise<unknown> => {
  // 验证文件大小（base64解码后）
  // base64编码后大小约为原始大小的4/3，所以用3/4还原
  const sizeInBytes = (base64Content.length * 3) / 4;
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (sizeInBytes > maxSize) {
    throw new Error("文件大小不能超过10MB");
  }

  const response = await apiClient.post(
    `/ozon/chats/${shopId}/${chatId}/files`,
    {
      base64_content: base64Content,
      file_name: fileName,
    },
  );
  return response.data.data;
};

/**
 * 标记聊天为已读
 */
export const markChatAsRead = async (
  shopId: number,
  chatId: string,
): Promise<unknown> => {
  const response = await apiClient.post(`/ozon/chats/${shopId}/${chatId}/read`);
  return response.data.data;
};

/**
 * 归档/取消归档聊天
 */
export const archiveChat = async (
  shopId: number,
  chatId: string,
  isArchived: boolean,
): Promise<unknown> => {
  const response = await apiClient.post(
    `/ozon/chats/${shopId}/${chatId}/archive`,
    {
      is_archived: isArchived,
    },
  );
  return response.data.data;
};

/**
 * 同步聊天数据
 */
export const syncChats = async (
  shopId: number,
  chatIdList?: string[],
): Promise<unknown> => {
  const response = await apiClient.post(
    `/ozon/chats/${shopId}/sync`,
    chatIdList || null,
  );
  return response.data.data;
};

/**
 * 下载聊天CSV文件（代理）
 */
export const downloadChatCsv = async (
  shopId: number,
  csvUrl: string,
): Promise<unknown> => {
  const response = await apiClient.get(
    `/ozon/chats/${shopId}/csv-proxy`,
    {
      params: { url: csvUrl },
      responseType: 'blob', // 重要：告诉axios返回二进制数据
    },
  );
  return response;
};

/**
 * 获取聊天统计信息
 */
export const getChatStats = async (
  shopId: number | null,
  shopIds?: string,
): Promise<ChatStats> => {
  // 如果shopId为null，使用全部店铺端点
  if (shopId === null) {
    const response = await apiClient.get("/ozon/chats/all/stats", {
      params: { shop_ids: shopIds },
    });
    return response.data.data;
  } else {
    const response = await apiClient.get(`/ozon/chats/${shopId}/stats`);
    return response.data.data;
  }
};
