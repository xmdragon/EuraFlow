/**
 * 通知 Hook
 * 基于 Ant Design 5.x 的 App.useApp() 实现
 */
import { App } from 'antd';
import type { ArgsProps } from 'antd/es/notification';

/**
 * 使用通知系统的 Hook
 *
 * @example
 * function MyComponent() {
 *   const { notifySuccess, notifyError } = useNotification();
 *
 *   const handleClick = () => {
 *     notifySuccess('成功', '操作成功');
 *   };
 * }
 */
export const useNotification = () => {
  const { notification } = App.useApp();

  const notifySuccess = (message: string, description?: string) => {
    console.log('[Notification] Success:', message, description);
    notification.success({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
    });
  };

  const notifyError = (message: string, description?: string) => {
    console.log('[Notification] Error:', message, description);
    notification.error({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
    });
  };

  const notifyWarning = (message: string, description?: string) => {
    console.log('[Notification] Warning:', message, description);
    notification.warning({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
    });
  };

  const notifyInfo = (message: string, description?: string) => {
    console.log('[Notification] Info:', message, description);
    notification.info({
      message,
      description,
      placement: 'bottomRight',
      duration: 5,
    });
  };

  const notify = (config: ArgsProps) => {
    console.log('[Notification] Custom:', config);
    notification.open({
      ...config,
      placement: config.placement || 'bottomRight',
      duration: config.duration !== undefined ? config.duration : 5,
    });
  };

  return {
    notifySuccess,
    notifyError,
    notifyWarning,
    notifyInfo,
    notify,
  };
};
