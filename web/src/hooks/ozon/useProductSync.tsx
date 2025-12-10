/**
 * 商品同步业务逻辑 Hook
 * 处理商品同步任务的启动、轮询、进度显示
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Progress } from 'antd';
import { useState } from 'react';

import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import * as ozonApi from '@/services/ozon';
import { notifyError } from '@/utils/notification';

export const useProductSync = (selectedShop: number | null, refetch: () => void) => {
  const queryClient = useQueryClient();
  const [syncConfirmVisible, setSyncConfirmVisible] = useState(false);
  const [syncFullMode, setSyncFullMode] = useState(false);

  // 使用通用轮询 Hook
  const { startPolling: startProductSyncPolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const result = await ozonApi.getSyncStatus(taskId);
      const status = result.data || result;

      // 转换为统一格式
      if (status.status === 'completed') {
        return { state: 'SUCCESS', result: status };
      } else if (status.status === 'failed') {
        return { state: 'FAILURE', error: status.error || '未知错误' };
      } else {
        return { state: 'PROGRESS', info: status };
      }
    },
    pollingInterval: 2000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'product-sync',
    initialMessage: '商品同步进行中',
    formatProgressContent: (info) => {
      const percent = Math.round(info.progress || 0);
      let displayMessage = info.message || '同步中...';

      // 格式化消息：简化显示格式
      const match = displayMessage.match(/商品\s+([0-9A-Za-z-]+)/);
      if (match) {
        displayMessage = `同步商品：${match[1]}`;
      }

      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>{displayMessage}</div>
        </div>
      );
    },
    formatSuccessMessage: () => ({
      title: '同步完成',
      description: '商品同步已完成！',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
      queryClient.invalidateQueries({ queryKey: ['ozonStatistics'] });
      refetch();
    },
  });

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
        // 使用新的轮询 Hook 启动后台轮询任务
        startProductSyncPolling(taskId);
      } else {
        notifyError('同步失败', '未获取到任务ID，请稍后重试');
      }
    },
    onError: (error: Error) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  const handleSync = (fullSync: boolean = false) => {
    setSyncFullMode(fullSync);
    setSyncConfirmVisible(true);
  };

  const handleSyncConfirm = () => {
    setSyncConfirmVisible(false);
    syncProductsMutation.mutate(syncFullMode);
  };

  return {
    syncProductsMutation,
    syncConfirmVisible,
    setSyncConfirmVisible,
    syncFullMode,
    handleSync,
    handleSyncConfirm,
  };
};
