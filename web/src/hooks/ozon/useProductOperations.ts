/**
 * 商品操作业务逻辑 Hook
 * 处理商品的CRUD操作（编辑、更新价格/库存、归档、恢复、删除等）
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useState } from 'react';

import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError } from '@/utils/notification';

export const useProductOperations = (selectedShop: number | null) => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();

  const [priceModalVisible, setPriceModalVisible] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ozonApi.Product | null>(null);

  // 批量价格更新轮询 Hook
  const { startPolling: startPriceUpdatePolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const status = await ozonApi.getBatchPriceUpdateTaskStatus(taskId);

      if (status.state === 'SUCCESS' || status.info?.status === 'completed') {
        return { state: 'SUCCESS', result: status.result || status.info };
      } else if (status.state === 'FAILURE' || status.info?.status === 'failed') {
        return { state: 'FAILURE', error: status.error || status.result?.error || '更新失败' };
      } else {
        return { state: 'PROGRESS', info: status.info || {} };
      }
    },
    pollingInterval: 2000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'price-update',
    initialMessage: '价格更新',
    formatProgressContent: (info) => {
      const progress = info.percent || 0;
      const current = info.current || '处理中...';
      return `${current} (${progress}%)`;
    },
    formatSuccessMessage: (result) => {
      const r = result as { updated_count?: number; updated?: number; errors?: unknown[] } | undefined;
      const updatedCount = r?.updated_count || r?.updated || 0;
      const errors = r?.errors || [];
      const isSingle = updatedCount === 1 && errors.length === 0;

      if (errors.length > 0) {
        return {
          title: isSingle ? '价格更新部分成功' : '批量价格更新部分成功',
          description: `成功更新 ${updatedCount} 个商品，${errors.length} 个失败。查看控制台了解详情。`,
        };
      }
      return {
        title: isSingle ? '价格更新完成' : '批量价格更新完成',
        description: isSingle ? '商品价格更新成功' : `成功更新 ${updatedCount} 个商品价格`,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
  });

  // 批量库存更新轮询 Hook
  const { startPolling: startStockUpdatePolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const status = await ozonApi.getBatchStockUpdateTaskStatus(taskId);

      if (status.state === 'SUCCESS' || status.info?.status === 'completed') {
        return { state: 'SUCCESS', result: status.result || status.info };
      } else if (status.state === 'FAILURE' || status.info?.status === 'failed') {
        return { state: 'FAILURE', error: status.error || status.result?.error || '更新失败' };
      } else {
        return { state: 'PROGRESS', info: status.info || {} };
      }
    },
    pollingInterval: 2000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'stock-update',
    initialMessage: '库存更新',
    formatProgressContent: (info) => {
      const progress = info.percent || 0;
      const current = info.current || '处理中...';
      return `${current} (${progress}%)`;
    },
    formatSuccessMessage: (result) => {
      const r = result as { updated_count?: number; updated?: number; errors?: unknown[] } | undefined;
      const updatedCount = r?.updated_count || r?.updated || 0;
      const errors = r?.errors || [];
      const isSingle = updatedCount === 1 && errors.length === 0;

      if (errors.length > 0) {
        return {
          title: isSingle ? '库存更新部分成功' : '批量库存更新部分成功',
          description: `成功更新 ${updatedCount} 个商品，${errors.length} 个失败。查看控制台了解详情。`,
        };
      }
      return {
        title: isSingle ? '库存更新完成' : '批量库存更新完成',
        description: isSingle ? '商品库存更新成功' : `成功更新 ${updatedCount} 个商品库存`,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
  });

  // 批量更新价格（异步任务）
  const updatePricesMutation = useMutation({
    mutationFn: (updates: ozonApi.PriceUpdate[]) =>
      ozonApi.updatePrices(updates, selectedShop || undefined),
    onSuccess: (data) => {
      // 检查是否返回了 task_id（异步任务）
      if (data.task_id) {
        setPriceModalVisible(false);
        // 使用新的轮询 Hook 开始轮询任务状态
        startPriceUpdatePolling(data.task_id);
      } else {
        // 旧的同步响应（兼容）
        notifySuccess('更新成功', '价格更新成功');
        setPriceModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
      }
    },
    onError: (error: unknown) => {
      // 提取后端返回的详细错误信息
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      const errorMessage = err?.response?.data?.detail || err?.message || '未知错误';
      notifyError('更新失败', `价格更新失败: ${errorMessage}`);
    },
  });

  // 批量更新库存（异步任务）
  const updateStocksMutation = useMutation({
    mutationFn: (updates: ozonApi.StockUpdate[]) =>
      ozonApi.updateStocks(updates, selectedShop || undefined),
    onSuccess: (data) => {
      // 检查是否返回了 task_id（异步任务）
      if (data.task_id) {
        setStockModalVisible(false);
        // 使用新的轮询 Hook 开始轮询任务状态
        startStockUpdatePolling(data.task_id);
      } else {
        // 旧的同步响应（兼容）
        notifySuccess('更新成功', '库存更新成功');
        setStockModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
      }
    },
    onError: (error: unknown) => {
      // 提取后端返回的详细错误信息
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      const errorMessage = err?.response?.data?.detail || err?.message || '未知错误';
      notifyError('更新失败', `库存更新失败: ${errorMessage}`);
    },
  });


  // 编辑商品
  const handleEdit = (product: ozonApi.Product) => {
    setSelectedProduct(product);
    setEditModalVisible(true);
  };

  // 更新单个商品价格
  const handlePriceUpdate = (product: ozonApi.Product) => {
    setSelectedProduct(product);
    setPriceModalVisible(true);
  };

  // 更新单个商品库存
  const handleStockUpdate = (product: ozonApi.Product) => {
    setSelectedProduct(product);
    setStockModalVisible(true);
  };

  // 批量更新价格
  const handleBatchPriceUpdate = () => {
    // 清空单个商品选择，避免弹窗标题显示错误
    setSelectedProduct(null);
    setPriceModalVisible(true);
  };

  // 批量更新库存
  const handleBatchStockUpdate = () => {
    // 清空单个商品选择，避免弹窗标题显示错误
    setSelectedProduct(null);
    setStockModalVisible(true);
  };

  // 同步单个商品
  const handleSyncSingle = async (product: ozonApi.Product) => {
    modal.confirm({
      title: '确认同步商品？',
      content: `商品货号: ${product.offer_id}`,
      onOk: async () => {
        try {
          const result = await ozonApi.syncSingleProduct(product.id);

          if (result.success) {
            notifySuccess('同步成功', result.message || '商品同步成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('同步失败', result.message || '商品同步失败');
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '同步失败';
          notifyError('同步失败', errorMsg);
        }
      },
    });
  };

  // 归档商品
  const handleArchive = (product: ozonApi.Product) => {
    modal.confirm({
      title: '确认归档商品？',
      content: `商品货号: ${product.offer_id}`,
      onOk: async () => {
        try {
          const result = await ozonApi.archiveProduct(product.id);

          if (result.success) {
            notifySuccess('归档成功', result.message || '商品归档成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('归档失败', result.message || '商品归档失败');
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '归档失败';
          notifyError('归档失败', errorMsg);
        }
      },
    });
  };

  // 恢复商品
  const handleRestore = (product: ozonApi.Product) => {
    modal.confirm({
      title: '确认恢复商品？',
      content: `商品货号: ${product.offer_id}，将从归档状态恢复`,
      onOk: async () => {
        try {
          const result = await ozonApi.restoreArchivedProduct(product.id);

          if (result.success) {
            notifySuccess('恢复成功', result.message || '商品恢复成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('恢复失败', result.message || '商品恢复失败');
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '恢复失败';
          notifyError('恢复失败', errorMsg);
        }
      },
    });
  };

  // 删除商品
  const handleDelete = (product: ozonApi.Product) => {
    modal.confirm({
      title: '确认删除商品？',
      content: `商品货号: ${product.offer_id}，此操作不可恢复！`,
      okType: 'danger',
      onOk: async () => {
        try {
          const result = await ozonApi.deleteProduct(product.id);

          if (result.success) {
            notifySuccess('删除成功', result.message || '商品删除成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('删除失败', result.message || '商品删除失败');
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '删除失败';
          notifyError('删除失败', errorMsg);
        }
      },
    });
  };

  // 批量删除商品
  const handleBatchDelete = (products: ozonApi.Product[]) => {
    if (!products || products.length === 0) {
      notifyError('操作失败', '请选择要删除的商品');
      return;
    }

    // 检查是否所有商品都已归档
    const notArchived = products.filter((p) => !p.ozon_archived);
    if (notArchived.length > 0) {
      notifyError(
        '操作失败',
        `以下商品未归档，无法删除：${notArchived.map((p) => p.offer_id).join(', ')}`
      );
      return;
    }

    // 检查是否有商品有SKU（OZON不允许删除有SKU的商品）
    const hasSku = products.filter((p) => p.ozon_sku);
    const noSku = products.filter((p) => !p.ozon_sku);

    let contentMessage = `确定要删除选中的 ${products.length} 个商品吗？此操作不可恢复！`;
    if (hasSku.length > 0) {
      contentMessage += `\n\n⚠️ 注意：${hasSku.length} 个商品有SKU，OZON不允许删除有SKU的商品，将跳过这些商品。`;
      if (noSku.length > 0) {
        contentMessage += `\n将删除 ${noSku.length} 个无SKU的商品。`;
      }
    }

    modal.confirm({
      title: '确认批量删除？',
      content: contentMessage,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          const productIds = products.map((p) => p.id);
          const result = await ozonApi.batchDeleteProducts(productIds);

          if (result.success) {
            notifySuccess('删除成功', result.message || '商品删除成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
            queryClient.invalidateQueries({ queryKey: ['ozonStatistics'] });
          } else {
            // 显示详细错误
            const errorDetail = result.errors?.length > 0
              ? `\n${result.errors.slice(0, 5).join('\n')}${result.errors.length > 5 ? `\n... 等 ${result.errors.length} 个错误` : ''}`
              : '';
            notifyError('删除失败', (result.message || '商品删除失败') + errorDetail);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : '批量删除失败';
          notifyError('删除失败', errorMsg);
        }
      },
    });
  };

  return {
    // State
    priceModalVisible,
    setPriceModalVisible,
    stockModalVisible,
    setStockModalVisible,
    editModalVisible,
    setEditModalVisible,
    selectedProduct,
    setSelectedProduct,

    // Mutations
    updatePricesMutation,
    updateStocksMutation,

    // Handlers
    handleEdit,
    handlePriceUpdate,
    handleStockUpdate,
    handleBatchPriceUpdate,
    handleBatchStockUpdate,
    handleSyncSingle,
    handleArchive,
    handleRestore,
    handleDelete,
    handleBatchDelete,
  };
};
