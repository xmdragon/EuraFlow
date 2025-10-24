/**
 * 跨境巴士同步状态轮询 Hook
 *
 * 用于轮询异步同步任务的状态（国内单号提交、废弃订单）
 */
import axios from 'axios';
import { useEffect, useState, useCallback, useRef } from 'react';

export interface Kuajing84SyncStatus {
  sync_log_id: number;
  status: 'pending' | 'in_progress' | 'success' | 'failed';
  sync_type: 'submit_tracking' | 'discard_order';
  message: string;
  attempts: number;
  created_at: string | null;
  started_at: string | null;
  synced_at: string | null;
  error_message: string | null;
  order_number: string;
  logistics_order: string | null;
}

interface UseKuajing84SyncStatusOptions {
  /** 轮询间隔（毫秒），默认 2000ms */
  pollInterval?: number;
  /** 最大轮询次数，默认 15 次（30秒） */
  maxAttempts?: number;
  /** 同步成功后的回调 */
  onSuccess?: (_status: Kuajing84SyncStatus) => void;
  /** 同步失败后的回调 */
  onFailure?: (_status: Kuajing84SyncStatus) => void;
  /** 轮询超时后的回调 */
  onTimeout?: () => void;
}

interface UseKuajing84SyncStatusReturn {
  /** 当前同步状态 */
  status: Kuajing84SyncStatus | null;
  /** 是否正在轮询 */
  isPolling: boolean;
  /** 是否加载中（首次查询） */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 手动停止轮询 */
  stopPolling: () => void;
  /** 手动重新开始轮询 */
  startPolling: () => void;
}

export function useKuajing84SyncStatus(
  syncLogId: number | null,
  options: UseKuajing84SyncStatusOptions = {}
): UseKuajing84SyncStatusReturn {
  const { pollInterval = 2000, maxAttempts = 15, onSuccess, onFailure, onTimeout } = options;

  const [status, setStatus] = useState<Kuajing84SyncStatus | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const pollCountRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 查询同步状态
  const fetchStatus = useCallback(async () => {
    if (!syncLogId) return;

    try {
      setIsLoading(pollCountRef.current === 0);

      const response = await axios.get<Kuajing84SyncStatus>(
        `/api/ef/v1/ozon/kuajing84/sync-status/${syncLogId}`
      );

      const data = response.data;
      setStatus(data);
      setError(null);

      // 检查是否完成（成功或失败）
      if (data.status === 'success') {
        setIsPolling(false);
        onSuccess?.(data);
      } else if (data.status === 'failed') {
        setIsPolling(false);
        onFailure?.(data);
      }
    } catch (err: any) {
      console.error('查询同步状态失败:', err);
      setError(err.response?.data?.detail || err.message || '查询失败');
      setIsPolling(false);
    } finally {
      setIsLoading(false);
    }
  }, [syncLogId, onSuccess, onFailure]);

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  // 开始轮询
  const startPolling = useCallback(() => {
    if (!syncLogId) return;

    // 重置计数器
    pollCountRef.current = 0;
    setIsPolling(true);

    // 立即查询一次
    fetchStatus();

    // 设置定时轮询
    timerRef.current = setInterval(() => {
      pollCountRef.current += 1;

      // 检查是否超过最大轮询次数
      if (pollCountRef.current >= maxAttempts) {
        stopPolling();
        onTimeout?.();
        return;
      }

      // 查询状态
      fetchStatus();
    }, pollInterval);
  }, [syncLogId, fetchStatus, pollInterval, maxAttempts, stopPolling, onTimeout]);

  // 组件挂载时自动开始轮询
  useEffect(() => {
    if (syncLogId) {
      startPolling();
    }

    // 组件卸载时清理定时器
    return () => {
      stopPolling();
    };
  }, [syncLogId, startPolling, stopPolling]);

  return {
    status,
    isPolling,
    isLoading,
    error,
    stopPolling,
    startPolling,
  };
}
