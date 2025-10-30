/**
 * 商品同步业务逻辑 Hook
 * 处理商品同步任务的启动、轮询、进度显示
 */
import { SyncOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Progress } from 'antd';
import { useState } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { getGlobalNotification } from '@/utils/globalNotification';
import { notifySuccess, notifyError } from '@/utils/notification';

export const useProductSync = (selectedShop: number | null, refetch: () => void) => {
  const queryClient = useQueryClient();
  const [syncConfirmVisible, setSyncConfirmVisible] = useState(false);
  const [syncFullMode, setSyncFullMode] = useState(false);

  // 异步轮询商品同步状态（后台任务）
  const pollProductSyncStatus = async (taskId: string) => {
    const notificationKey = 'product-sync';
    let completed = false;

    try {
      // 显示初始进度通知
      const notificationInstance = getGlobalNotification();
      if (notificationInstance) {
        notificationInstance.open({
          key: notificationKey,
          message: '商品同步进行中',
          description: (
            <div>
              <Progress percent={0} size="small" status="active" />
              <div style={{ marginTop: 8 }}>正在启动同步...</div>
            </div>
          ),
          duration: 0, // 不自动关闭
          placement: 'bottomRight',
          icon: <SyncOutlined spin />,
        });
      }

      // 持续轮询状态
      while (!completed) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // 每2秒检查一次
          const result = await ozonApi.getSyncStatus(taskId);
          const status = result.data || result;

          if (status.status === 'completed') {
            completed = true;
            const notificationInstance = getGlobalNotification();
            if (notificationInstance) {
              notificationInstance.destroy(notificationKey);
            }
            notifySuccess('同步完成', '商品同步已完成！');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
            refetch();
          } else if (status.status === 'failed') {
            completed = true;
            const notificationInstance = getGlobalNotification();
            if (notificationInstance) {
              notificationInstance.destroy(notificationKey);
            }
            notifyError('同步失败', `同步失败: ${status.error || '未知错误'}`);
          } else {
            // 更新进度通知
            const percent = Math.round(status.progress || 0);
            // 格式化消息：简化显示格式
            let displayMessage = status.message || '同步中...';
            const match = displayMessage.match(/商品\s+([0-9A-Za-z-]+)/);
            if (match) {
              displayMessage = `同步商品：${match[1]}`;
            }

            const notificationInstance = getGlobalNotification();
            if (notificationInstance) {
              notificationInstance.open({
                key: notificationKey,
                message: '商品同步进行中',
                description: (
                  <div>
                    <Progress percent={percent} size="small" status="active" />
                    <div style={{ marginTop: 8 }}>{displayMessage}</div>
                  </div>
                ),
                duration: 0,
                placement: 'bottomRight',
                icon: <SyncOutlined spin />,
              });
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
        } catch (_error) {
          // 静默处理错误，继续轮询
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    } catch (_error) {
      const notificationInstance = getGlobalNotification();
      if (notificationInstance) {
        notificationInstance.destroy(notificationKey);
      }
      notifyError('同步失败', '同步过程发生异常');
    }
  };

  // 同步商品（非阻塞）
  const syncProductsMutation = useMutation({
    mutationFn: (fullSync: boolean) => ozonApi.syncProducts(selectedShop, fullSync),
    onSuccess: (data) => {
      const taskId = data?.task_id || data?.data?.task_id;
      if (taskId) {
        // 立即启动后台轮询任务
        pollProductSyncStatus(taskId);
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
