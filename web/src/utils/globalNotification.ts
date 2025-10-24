/**
 * 全局通知管理器
 *
 * 用于在非React组件中使用Ant Design通知
 * 需要在App.tsx中初始化
 */
import type { NotificationInstance } from 'antd/es/notification/interface';

let globalNotificationInstance: NotificationInstance | null = null;

/**
 * 设置全局通知实例
 * 在App组件中调用
 */
export const setGlobalNotification = (instance: NotificationInstance) => {
  globalNotificationInstance = instance;
};

/**
 * 获取全局通知实例
 */
export const getGlobalNotification = (): NotificationInstance | null => {
  return globalNotificationInstance;
};
