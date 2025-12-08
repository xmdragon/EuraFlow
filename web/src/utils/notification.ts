/**
 * 全局通知工具
 * 统一的通知系统，右下角弹出,5秒后自动淡出
 *
 * ⚠️ Ant Design 5.x 注意事项：
 * - 需要在 App.tsx 中初始化全局notification实例
 * - 使用 App.useApp() 获取notification并调用 setGlobalNotification()
 */
import type { ArgsProps } from 'antd/es/notification';

import { getGlobalNotification } from './globalNotification';

import { logger } from '@/utils/logger';

/**
 * 获取notification实例
 * 如果未初始化，返回null并在控制台警告
 */
const getNotification = () => {
  const instance = getGlobalNotification();
  if (!instance) {
    logger.error(
      '[Notification] Instance not initialized. Please call setGlobalNotification() in App.tsx'
    );
  }
  return instance;
};

// 通知框通用样式
const notificationStyle = {
  width: 'auto',
  minWidth: 200,
  maxWidth: 500,
  padding: 10,
  whiteSpace: 'nowrap' as const,
};

/**
 * 成功通知
 */
export const notifySuccess = (message: string, description?: string) => {
  const notification = getNotification();
  if (notification) {
    notification.success({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
      style: notificationStyle,
    });
  }
};

/**
 * 错误通知
 */
export const notifyError = (message: string, description?: string) => {
  const notification = getNotification();
  if (notification) {
    notification.error({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
      style: notificationStyle,
    });
  }
};

/**
 * 警告通知
 */
export const notifyWarning = (message: string, description?: string) => {
  const notification = getNotification();
  if (notification) {
    notification.warning({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
      style: notificationStyle,
    });
  }
};

/**
 * 信息通知
 */
export const notifyInfo = (message: string, description?: string) => {
  const notification = getNotification();
  if (notification) {
    notification.info({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
      style: notificationStyle,
    });
  }
};

/**
 * 自定义通知
 */
export const notify = (config: ArgsProps) => {
  const notification = getNotification();
  if (notification) {
    notification.open({
      ...config,
      placement: config.placement || 'bottomRight',
      duration: config.duration !== undefined ? config.duration : 5,
      style: { ...notificationStyle, ...config.style },
    });
  }
};

export default {
  success: notifySuccess,
  error: notifyError,
  warning: notifyWarning,
  info: notifyInfo,
  custom: notify,
};
