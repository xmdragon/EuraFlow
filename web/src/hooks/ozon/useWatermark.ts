/**
 * 水印应用业务逻辑 Hook
 * 处理水印应用、还原、轮询等操作
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message, notification } from 'antd';
import { useEffect, useState } from 'react';

import * as watermarkApi from '@/services/watermarkApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';

export const useWatermark = (selectedShop: number | null) => {
  const queryClient = useQueryClient();
  const [watermarkBatchId, setWatermarkBatchId] = useState<string | null>(null);
  const [watermarkConfigs, setWatermarkConfigs] = useState<watermarkApi.WatermarkConfig[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 查询水印配置
  const { data: watermarkConfigsData, error: watermarkError } = useQuery({
    queryKey: ['watermarkConfigs'],
    queryFn: () => watermarkApi.getWatermarkConfigs(),
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
    retry: 1, // 减少重试次数
    // 静默失败：水印配置查询失败不影响商品列表显示
    throwOnError: false,
  });

  // 记录水印配置加载错误（不影响页面显示）
  useEffect(() => {
    if (watermarkError) {
      loggers.product.warn('水印配置加载失败，水印功能将不可用:', watermarkError);
    }
  }, [watermarkError]);

  useEffect(() => {
    if (watermarkConfigsData && Array.isArray(watermarkConfigsData)) {
      setWatermarkConfigs(watermarkConfigsData);
    }
  }, [watermarkConfigsData]);

  // 应用水印 - 默认使用异步模式
  const applyWatermarkMutation = useMutation({
    mutationFn: ({
      productIds,
      configId,
      analyzeMode = 'individual',
      positionOverrides,
    }: {
      productIds: number[];
      configId: number;
      analyzeMode?: 'individual' | 'fast';
      positionOverrides?: Record<string, Record<string, string>>;
    }) => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return watermarkApi.applyWatermarkBatch(
        selectedShop,
        productIds,
        configId,
        false,
        analyzeMode,
        positionOverrides
      ); // 强制使用异步模式
    },
    onSuccess: (data) => {
      loggers.product.debug('Watermark batch response:', data);

      if (!data.batch_id) {
        notifyError('任务启动失败', '未获取到任务ID，请重试');
        return;
      }

      // 异步模式 - 启动轮询
      notifyInfo('水印处理已启动', `水印批处理已在后台启动，任务ID: ${data.batch_id}`);
      setWatermarkBatchId(data.batch_id);

      // 延迟1秒后开始轮询，给后端时间创建任务
      setTimeout(() => {
        loggers.product.debug('Starting polling for batch:', data.batch_id);
        pollWatermarkTasks(data.batch_id);
      }, 1000);
    },
    onError: (error: Error) => {
      notifyError('水印应用失败', `水印应用失败: ${error.message}`);
    },
  });

  // 还原原图
  const restoreOriginalMutation = useMutation({
    mutationFn: (productIds: number[]) => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return watermarkApi.restoreOriginalBatch(selectedShop, productIds);
    },
    onSuccess: (data) => {
      notifySuccess('原图还原已启动', `原图还原已启动，任务ID: ${data.batch_id}`);
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
    onError: (error: Error) => {
      notifyError('原图还原失败', `原图还原失败: ${error.message}`);
    },
  });

  // 轮询水印任务状态
  const pollWatermarkTasks = async (batchId: string) => {
    if (!selectedShop) {
      loggers.product.error('Cannot poll watermark tasks: no shop selected');
      return;
    }

    loggers.product.debug('Starting to poll watermark tasks for batch:', batchId);
    let completed = 0;
    let failed = 0;
    let hasShownProgress = false;
    let pollCount = 0;

    const interval = setInterval(async () => {
      pollCount++;
      loggers.product.debug(`Polling attempt ${pollCount} for batch ${batchId}`);

      try {
        const tasks = await watermarkApi.getTasks({
          shop_id: selectedShop,
          batch_id: batchId,
        });
        loggers.product.debug('Tasks received:', tasks);

        completed = tasks.filter((t) => t.status === 'completed').length;
        failed = tasks.filter((t) => t.status === 'failed').length;
        const processing = tasks.filter((t) => t.status === 'processing').length;
        const pending = tasks.filter((t) => t.status === 'pending').length;
        const total = tasks.length;

        loggers.product.debug(
          `Status: ${completed} completed, ${failed} failed, ${processing} processing, ${pending} pending, total: ${total}`
        );

        // 显示进度
        if (!hasShownProgress && (completed > 0 || processing > 0)) {
          hasShownProgress = true;
          notifyInfo('水印处理中', `水印处理进度：${completed}/${total} 完成`);
        }

        // 如果所有任务都完成了（无论成功还是失败）
        if (total > 0 && completed + failed === total) {
          clearInterval(interval);

          // 使用通知而不是普通消息，更醒目
          if (failed > 0) {
            notifyWarning('水印批处理完成', `成功处理 ${completed} 个商品，失败 ${failed} 个商品`);
          } else {
            notifySuccess('水印批处理成功', `已成功为 ${completed} 个商品添加水印`);
          }

          queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          setWatermarkBatchId(null);
        }
      } catch (error) {
        loggers.product.error('Failed to poll watermark tasks:', error);

        // 如果连续失败3次，停止轮询
        if (pollCount >= 3) {
          clearInterval(interval);
          message.destroy(); // 清除loading消息

          notification.error({
            message: '任务状态查询失败',
            description: `无法获取水印处理进度：${error?.message || '网络错误'}。请刷新页面查看结果`,
            duration: 0, // 不自动关闭
            placement: 'topRight',
          });
        }
      }
    }, 3000);

    // 5分钟后自动停止轮询
    setTimeout(() => {
      clearInterval(interval);
      message.destroy(); // 清除所有消息

      if (completed + failed === 0) {
        notification.warning({
          message: '任务超时',
          description: '水印处理时间过长，请稍后刷新页面查看结果',
          duration: 0, // 不自动关闭
          placement: 'topRight',
        });
      }
    }, 300000);
  };

  // 预览水印
  const handlePreview = async (
    productIds: number[],
    configId: number,
    analyzeMode: 'individual' | 'fast'
  ) => {
    if (!selectedShop) {
      throw new Error('请先选择店铺');
    }
    setPreviewLoading(true);
    try {
      // 转换 analyzeMode: 'individual' -> true (逐个分析), 'fast' -> false (快速模式)
      const analyzeEach = analyzeMode === 'individual';
      const result = await watermarkApi.previewWatermarkBatch(
        selectedShop,
        productIds,
        configId,
        analyzeEach
      );
      return result;
    } finally {
      setPreviewLoading(false);
    }
  };

  return {
    watermarkConfigs,
    watermarkBatchId,
    previewLoading,
    applyWatermarkMutation,
    restoreOriginalMutation,
    handlePreview,
  };
};
