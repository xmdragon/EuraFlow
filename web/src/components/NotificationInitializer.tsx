/**
 * 通知系统初始化组件
 *
 * 用于在 AntApp 内部获取 notification 实例并全局共享
 */
import { App } from 'antd';
import React, { useEffect } from 'react';

import { setGlobalNotification } from '@/utils/globalNotification';

const NotificationInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { notification } = App.useApp();

  useEffect(() => {
    setGlobalNotification(notification);
    // 暴露到 window 以便调试和测试
    (window as any).__notification = notification;
  }, [notification]);

  return <>{children}</>;
};

export default NotificationInitializer;
