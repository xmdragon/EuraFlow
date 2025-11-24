/**
 * 批量同步Hook
 * 封装批量同步OZON订单的核心逻辑和进度管理
 */
import { useState } from 'react';
import { notification, Progress } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import * as ozonApi from '@/services/ozon';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyWarning, notifyInfo } from '@/utils/notification';

interface SyncProgress {
  success: number;
  failed: number;
  total: number;
}

interface UseBatchSyncOptions {
  onComplete?: (successCount: number, failedCount: number) => void;
  onError?: (error: unknown) => void;
}

interface UseBatchSyncReturn {
  isSyncing: boolean;
  syncProgress: SyncProgress;
  batchSync: (postings: Array<{ posting_number: string; order: { shop_id: number } }>) => Promise<void>;
}

export const useBatchSync = (options: UseBatchSyncOptions = {}): UseBatchSyncReturn => {
  const { onComplete, onError } = options;

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    success: 0,
    failed: 0,
    total: 0,
  });

  const batchSync = async (postings: Array<{ posting_number: string; order: { shop_id: number } }>): Promise<void> => {
    if (postings.length === 0) {
      logger.warn('没有可同步的订单');
      notifyWarning('操作失败', '当前页面没有可同步的订单');
      return;
    }

    logger.info('开始执行批量同步', { count: postings.length });

    // 提示用户操作已开始
    notifyInfo('批量同步', `开始同步 ${postings.length} 个订单...`);

    // 立即设置同步状态
    setIsSyncing(true);
    setSyncProgress({ success: 0, failed: 0, total: postings.length });

    const notificationKey = 'batch-sync';
    let successCount = 0;
    let failedCount = 0;
    const total = postings.length;

    // 显示初始进度通知
    notification.open({
      key: notificationKey,
      message: '批量同步进行中',
      description: (
        <div>
          <Progress percent={0} size="small" status="active" />
          <div style={{ marginTop: 8 }}>已完成 0/{total} (成功: 0, 失败: 0)</div>
        </div>
      ),
      duration: 0, // 不自动关闭
      icon: <SyncOutlined spin />,
    });

    try {
      // 逐个同步订单
      for (let i = 0; i < postings.length; i++) {
        const posting = postings[i];
        try {
          await ozonApi.syncSingleOrder(posting.posting_number, posting.order.shop_id);
          successCount++;
        } catch (error) {
          logger.error(`同步失败: ${posting.posting_number}`, error);
          failedCount++;
        }

        // 更新进度通知
        const completed = i + 1;
        const percent = Math.round((completed / total) * 100);
        notification.open({
          key: notificationKey,
          message: '批量同步进行中',
          description: (
            <div>
              <Progress percent={percent} size="small" status="active" />
              <div style={{ marginTop: 8 }}>
                已完成 {completed}/{total} (成功: {successCount}, 失败: {failedCount})
              </div>
            </div>
          ),
          duration: 0,
          icon: <SyncOutlined spin />,
        });

        // 更新状态
        setSyncProgress({ success: successCount, failed: failedCount, total });
      }

      // 关闭进度通知
      notification.destroy(notificationKey);

      // 显示最终结果
      if (failedCount === 0) {
        notifySuccess('批量同步完成', `成功同步 ${successCount} 个订单`);
      } else {
        notifyWarning('批量同步完成', `成功: ${successCount}, 失败: ${failedCount}`);
      }

      // 触发完成回调
      onComplete?.(successCount, failedCount);
    } catch (error: unknown) {
      logger.error('批量同步错误', error);
      notification.destroy(notificationKey);
      onError?.(error);
    } finally {
      // 重置同步状态
      setIsSyncing(false);
      setSyncProgress({ success: 0, failed: 0, total: 0 });
    }
  };

  return {
    isSyncing,
    syncProgress,
    batchSync,
  };
};
