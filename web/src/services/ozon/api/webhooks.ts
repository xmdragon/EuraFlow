/**
 * OZON Webhook API
 */

import { apiClient } from '../client';
import type { WebhookConfig, WebhookEvent } from '../types/webhook';

/**
 * 获取 Webhook 配置
 */
export const getWebhookConfig = async (
  shopId: number,
): Promise<WebhookConfig> => {
  const response = await apiClient.get(`/ozon/shops/${shopId}/webhook`);
  return response.data;
};

/**
 * 配置 Webhook
 */
export const configureWebhook = async (
  shopId: number,
  config: { webhook_url: string; webhook_secret?: string },
) => {
  const response = await apiClient.post(
    `/ozon/shops/${shopId}/webhook`,
    config,
  );
  return response.data;
};

/**
 * 测试 Webhook
 */
export const testWebhook = async (shopId: number) => {
  const response = await apiClient.post(`/ozon/shops/${shopId}/webhook/test`);
  return response.data;
};

/**
 * 删除 Webhook 配置
 */
export const deleteWebhookConfig = async (shopId: number) => {
  const response = await apiClient.delete(`/ozon/shops/${shopId}/webhook`);
  return response.data;
};

/**
 * 获取 Webhook 事件列表
 */
export const getWebhookEvents = async (
  shopId: number,
  status?: string,
  limit: number = 50,
  offset: number = 0,
): Promise<{
  events: WebhookEvent[];
  total: number;
  limit: number;
  offset: number;
}> => {
  const params: { shop_id: number; limit: number; offset: number; status?: string } = {
    shop_id: shopId,
    limit,
    offset,
  };
  if (status) {
    params.status = status;
  }

  const response = await apiClient.get("/ozon/webhook/events", { params });
  return response.data;
};

/**
 * 重试失败的 Webhook 事件
 */
export const retryWebhookEvent = async (eventId: string) => {
  const response = await apiClient.post(
    `/ozon/webhook/events/${eventId}/retry`,
  );
  return response.data;
};
