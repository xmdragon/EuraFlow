/**
 * 全局通知工具
 * 统一的通知系统，右下角弹出,5秒后自动消失
 *
 * ⚠️ Ant Design 5.x 注意事项：
 * - 需要在 main.tsx 中包装 <App> 组件才能正常工作
 * - 已在 main.tsx 添加 <AntApp> 包装器
 */
import { notification } from 'antd';
import type { ArgsProps } from 'antd/es/notification';

// 全局配置
notification.config({
  placement: 'bottomRight',
  duration: 5, // 5秒后自动消失
  maxCount: 3, // 最多同时显示3个通知
  top: 50, // 距离顶部的距离
  getContainer: () => document.body, // 明确指定挂载到 body
});

/**
 * 成功通知
 */
export const notifySuccess = (message: string, description?: string) => {
  console.log('[Notification] Success:', message, description);
  notification.success({
    message,
    description,
    placement: 'bottomRight',
    duration: 5,
  });
};

/**
 * 错误通知
 */
export const notifyError = (message: string, description?: string) => {
  console.log('[Notification] Error:', message, description);
  notification.error({
    message,
    description,
    placement: 'bottomRight',
    duration: 5,
  });
};

/**
 * 警告通知
 */
export const notifyWarning = (message: string, description?: string) => {
  console.log('[Notification] Warning:', message, description);
  notification.warning({
    message,
    description,
    placement: 'bottomRight',
    duration: 5,
  });
};

/**
 * 信息通知
 */
export const notifyInfo = (message: string, description?: string) => {
  console.log('[Notification] Info:', message, description);
  notification.info({
    message,
    description,
    placement: 'bottomRight',
    duration: 5,
  });
};

/**
 * 自定义通知
 */
export const notify = (config: ArgsProps) => {
  console.log('[Notification] Custom:', config);
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
