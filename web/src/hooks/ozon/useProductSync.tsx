/**
 * 商品同步业务逻辑 Hook
 * 处理商品同步任务的启动、轮询、进度显示
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozon';
import { notifyError, notifySuccess } from '@/utils/notification';

interface SyncProgress {
  progress: number;
  message?: string;
}

export const useProductSync = (selectedShop: number | null, refetch: () => void) => {
  const queryClient = useQueryClient();
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 开始轮询同步进度
  const startProductSyncPolling = (taskId: string) => {
    // 清理之前的轮询
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
    }

    const pollProgress = async () => {
      try {
        const result = await ozonApi.getSyncStatus(taskId);
        const status = result.data || result;

        if (status.status === 'completed') {
          setSyncProgress(null);
          if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
          }
          notifySuccess('同步完成', '商品同步已完成！');
          queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          queryClient.invalidateQueries({ queryKey: ['ozonStatistics'] });
          refetch();
        } else if (status.status === 'failed') {
          setSyncProgress(null);
          if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
          }
          notifyError('同步失败', status.error || '未知错误');
        } else {
          // 进行中，更新进度
          setSyncProgress({ progress: status.progress || 0, message: status.message });
        }
      } catch (error) {
        console.error('Failed to poll product sync progress:', error);
      }
    };

    // 立即执行一次
    pollProgress();
    // 每2秒轮询一次
    syncIntervalRef.current = setInterval(pollProgress, 2000);
  };

  // 清理轮询
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, []);

  // 同步商品（非阻塞）
  const syncProductsMutation = useMutation({
    mutationFn: (fullSync: boolean) => ozonApi.syncProducts(selectedShop, fullSync),
    onSuccess: (data) => {
      // 检查后端返回的错误
      if (data?.ok === false) {
        notifyError('同步失败', data.error || '未知错误');
        return;
      }

      const taskId = data?.task_id || data?.data?.task_id;
      if (taskId) {
        // 启动轮询任务
        startProductSyncPolling(taskId);
      } else {
        notifyError('同步失败', '未获取到任务ID，请稍后重试');
      }
    },
    onError: (error: Error) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 直接执行同步（无确认弹窗）
  const handleSync = (fullSync: boolean = false) => {
    syncProductsMutation.mutate(fullSync);
  };

  return {
    syncProductsMutation,
    syncProgress,
    handleSync,
  };
};
