/**
 * 水印应用业务逻辑 Hook
 * 处理水印应用、还原、轮询等操作
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import * as watermarkApi from '@/services/watermarkApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notification';

export const useWatermark = (selectedShop: number | null) => {
  const queryClient = useQueryClient();
  const [watermarkConfigs, setWatermarkConfigs] = useState<watermarkApi.WatermarkConfig[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 水印处理轮询 Hook
  const { startPolling: startWatermarkPolling } = useAsyncTaskPolling({
    getStatus: async (batchId) => {
      if (!selectedShop) {
        return { state: 'FAILURE', error: '未选择店铺' };
      }

      const tasks = await watermarkApi.getTasks({
        shop_id: selectedShop,
        batch_id: batchId,
      });

      const completed = tasks.filter((t) => t.status === 'completed').length;
      const failed = tasks.filter((t) => t.status === 'failed').length;
      const total = tasks.length;

      // 如果所有任务都完成了（无论成功还是失败）
      if (total > 0 && completed + failed === total) {
        return {
          state: 'SUCCESS',
          result: { completed, failed, total },
        };
      } else {
        return {
          state: 'PROGRESS',
          info: {
            percent: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
            current: `已处理 ${completed + failed}/${total} 个商品`,
          },
        };
      }
    },
    pollingInterval: 3000,
    timeout: 5 * 60 * 1000, // 5分钟超时
    notificationKey: 'watermark-apply',
    initialMessage: '水印处理进行中',
    formatProgressContent: (info) => {
      return `${info.current || '处理中...'} (${info.percent || 0}%)`;
    },
    formatSuccessMessage: (result) => {
      if (result.failed > 0) {
        return {
          title: '水印批处理完成',
          description: `成功处理 ${result.completed} 个商品，失败 ${result.failed} 个商品`,
        };
      }
      return {
        title: '水印批处理成功',
        description: `已成功为 ${result.completed} 个商品添加水印`,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
  });

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

      // 使用统一的轮询 Hook
      startWatermarkPolling(data.batch_id);
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
    previewLoading,
    applyWatermarkMutation,
    restoreOriginalMutation,
    handlePreview,
  };
};
