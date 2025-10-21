/**
 * 全局通知工具
 * 统一的通知系统，右下角弹出，5秒后自动消失
 */
import { notification } from 'antd';
import type { ArgsProps } from 'antd/es/notification';

// 全局配置
notification.config({
  placement: 'bottomRight',
  duration: 5, // 5秒后自动消失
  maxCount: 3, // 最多同时显示3个通知
});

/**
 * 成功通知
 */
export const notifySuccess = (message: string, description?: string) => {
  notification.success({
    message,
    description,
  });
};

/**
 * 错误通知
 */
export const notifyError = (message: string, description?: string) => {
  notification.error({
    message,
    description,
  });
};

/**
 * 警告通知
 */
export const notifyWarning = (message: string, description?: string) => {
  notification.warning({
    message,
    description,
  });
};

/**
 * 信息通知
 */
export const notifyInfo = (message: string, description?: string) => {
  notification.info({
    message,
    description,
  });
};

/**
 * 自定义通知
 */
export const notify = (config: ArgsProps) => {
  notification.open({
    ...config,
    placement: config.placement || 'bottomRight',
    duration: config.duration !== undefined ? config.duration : 5,
  });
};

export default {
  success: notifySuccess,
  error: notifyError,
  warning: notifyWarning,
  info: notifyInfo,
  custom: notify,
};
