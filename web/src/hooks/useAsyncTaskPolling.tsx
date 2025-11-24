/**
 * 异步任务轮询 Hook
 * 统一处理后台任务的轮询、进度显示、取消等逻辑
 */
import React, { useRef, useCallback } from 'react';
import { Progress } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { getGlobalNotification } from '@/utils/globalNotification';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import { logger } from '@/utils/logger';

export interface TaskStatus<T = unknown> {
  state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'PROGRESS';
  result?: T;
  error?: string;
  info?: {
    status?: string;
    progress?: number;
    message?: string;
    [key: string]: unknown;
  };
}

export interface UseAsyncTaskPollingOptions {
  // 任务状态查询函数
  getStatus: (taskId: string) => Promise<TaskStatus>;

  // 轮询配置
  pollingInterval?: number; // 轮询间隔（毫秒），默认 2000
  timeout?: number; // 超时时间（毫秒），默认 30分钟

  // 通知配置
  notificationKey?: string; // 通知的唯一 key，默认 'async-task'
  initialMessage?: string; // 初始消息，默认 '任务进行中'

  // 进度格式化函数
  formatProgressContent?: (info: TaskStatus['info']) => React.ReactNode;

  // 成功消息格式化函数
  formatSuccessMessage?: (result: unknown) => { title: string; description: string };

  // 回调函数
  onSuccess?: (result: unknown) => void;
  onFailure?: (error: string) => void;
  onTimeout?: () => void;
  onCancel?: () => void;
}

export const useAsyncTaskPolling = (options: UseAsyncTaskPollingOptions) => {
  const {
    getStatus,
    pollingInterval = 2000,
    timeout = 30 * 60 * 1000,
    notificationKey = 'async-task',
    initialMessage = '任务进行中',
    formatProgressContent,
    formatSuccessMessage,
    onSuccess,
    onFailure,
    onTimeout,
    onCancel,
  } = options;

  // 轮询取消标志
  const cancelFlagRef = useRef<boolean>(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    cancelFlagRef.current = false;
  }, []);

  // 处理用户手动关闭通知
  const handleNotificationClose = useCallback((taskId: string) => {
    cancelFlagRef.current = true;
    stopPolling();
    logger.info('用户手动关闭任务通知，停止轮询', { taskId, notificationKey });
    onCancel?.();
  }, [stopPolling, notificationKey, onCancel]);

  // 显示通知
  const showNotification = useCallback((content: {
    message: string;
    description: React.ReactNode;
    icon?: React.ReactNode;
  }, taskId: string) => {
    const notificationInstance = getGlobalNotification();
    if (notificationInstance) {
      notificationInstance.open({
        key: notificationKey,
        message: content.message,
        description: content.description,
        duration: 0,
        placement: 'bottomRight',
        icon: content.icon || <SyncOutlined spin />,
        onClose: () => handleNotificationClose(taskId),
      });
    }
  }, [notificationKey, handleNotificationClose]);

  // 开始轮询
  const startPolling = useCallback(async (taskId: string) => {
    // 重置取消标志
    cancelFlagRef.current = false;
    stopPolling();

    const startTime = Date.now();

    // 显示初始通知
    showNotification({
      message: initialMessage,
      description: (
        <div>
          <Progress percent={0} size="small" status="active" />
          <div style={{ marginTop: 8 }}>正在启动...</div>
        </div>
      ),
    }, taskId);

    // 设置超时定时器
    timeoutTimerRef.current = setTimeout(() => {
      stopPolling();
      const notificationInstance = getGlobalNotification();
      if (notificationInstance) {
        notificationInstance.destroy(notificationKey);
      }
      notifyWarning('任务超时', '任务执行时间过长，已停止监控。请稍后手动查看结果。');
      onTimeout?.();
    }, timeout);

    // 轮询函数
    const poll = async () => {
      // 检查是否被取消
      if (cancelFlagRef.current) {
        logger.info('检测到取消标志，停止轮询', { taskId, notificationKey });
        stopPolling();
        return;
      }

      // 检查超时
      if (Date.now() - startTime > timeout) {
        stopPolling();
        const notificationInstance = getGlobalNotification();
        if (notificationInstance) {
          notificationInstance.destroy(notificationKey);
        }
        notifyWarning('任务超时', '任务执行时间过长，已停止监控。');
        onTimeout?.();
        return;
      }

      try {
        const status = await getStatus(taskId);

        if (status.state === 'SUCCESS') {
          // 任务成功
          stopPolling();
          const notificationInstance = getGlobalNotification();
          if (notificationInstance) {
            notificationInstance.destroy(notificationKey);
          }

          // 格式化成功消息
          const successMsg = formatSuccessMessage
            ? formatSuccessMessage(status.result)
            : { title: '任务完成', description: '任务执行成功' };

          notifySuccess(successMsg.title, successMsg.description);
          onSuccess?.(status.result);

        } else if (status.state === 'FAILURE') {
          // 任务失败
          stopPolling();
          const notificationInstance = getGlobalNotification();
          if (notificationInstance) {
            notificationInstance.destroy(notificationKey);
          }

          const errorMsg = status.error || '任务执行失败';
          notifyError('任务失败', errorMsg);
          onFailure?.(errorMsg);

        } else if (status.info) {
          // 任务进行中 - 更新进度
          const percent = Math.round(status.info.progress || 0);
          const progressContent = formatProgressContent
            ? formatProgressContent(status.info)
            : (
              <div>
                <Progress percent={percent} size="small" status="active" />
                <div style={{ marginTop: 8 }}>{status.info.message || '处理中...'}</div>
              </div>
            );

          showNotification({
            message: initialMessage,
            description: progressContent,
          }, taskId);
        }
      } catch (error: unknown) {
        // 检查是否是 404 错误（任务不存在）
        const err = error as { response?: { status?: number }; error?: { status?: number } };
        if (err?.response?.status === 404 || err?.error?.status === 404) {
          stopPolling();
          const notificationInstance = getGlobalNotification();
          if (notificationInstance) {
            notificationInstance.destroy(notificationKey);
          }
          notifyWarning('任务已结束', '任务已完成或不存在，请刷新页面查看最新数据');
        }
        // 其他错误静默处理，继续轮询（可能是临时网络问题）
      }
    };

    // 首次立即执行
    await poll();

    // 设置定时轮询
    pollingIntervalRef.current = setInterval(poll, pollingInterval);

  }, [
    getStatus,
    pollingInterval,
    timeout,
    notificationKey,
    initialMessage,
    formatProgressContent,
    formatSuccessMessage,
    onSuccess,
    onFailure,
    onTimeout,
    stopPolling,
    showNotification,
  ]);

  // 组件卸载时清理
  React.useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    startPolling,
    stopPolling,
    isPolling: pollingIntervalRef.current !== null,
  };
};
