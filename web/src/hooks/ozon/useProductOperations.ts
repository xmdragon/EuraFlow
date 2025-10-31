/**
 * 商品操作业务逻辑 Hook
 * 处理商品的CRUD操作（编辑、更新价格/库存、归档、恢复、删除等）
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useState, useRef } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { notifySuccess, notifyError } from '@/utils/notification';

export const useProductOperations = (selectedShop: number | null) => {
  const { modal, notification } = App.useApp();
  const queryClient = useQueryClient();

  const [priceModalVisible, setPriceModalVisible] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ozonApi.Product | null>(null);

  // 用于存储轮询定时器
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollPriceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 批量更新价格（异步任务）
  const updatePricesMutation = useMutation({
    mutationFn: (updates: ozonApi.PriceUpdate[]) =>
      ozonApi.updatePrices(updates, selectedShop || undefined),
    onSuccess: (data) => {
      console.log('价格更新响应:', data);
      // 检查是否返回了 task_id（异步任务）
      if (data.task_id) {
        console.log('收到 task_id，开始轮询:', data.task_id);
        setPriceModalVisible(false);
        // 开始轮询任务状态
        pollPriceUpdateTask(data.task_id);
      } else {
        console.log('未收到 task_id，使用旧的同步方式');
        // 旧的同步响应（兼容）
        notifySuccess('更新成功', '价格更新成功');
        setPriceModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
      }
    },
    onError: (error: any) => {
      // 提取后端返回的详细错误信息
      const errorMessage = error?.response?.data?.detail || error?.message || '未知错误';
      notifyError('更新失败', `价格更新失败: ${errorMessage}`);
    },
  });

  // 批量更新库存（异步任务）
  const updateStocksMutation = useMutation({
    mutationFn: (updates: ozonApi.StockUpdate[]) =>
      ozonApi.updateStocks(updates, selectedShop || undefined),
    onSuccess: (data) => {
      console.log('库存更新响应:', data);
      // 检查是否返回了 task_id（异步任务）
      if (data.task_id) {
        console.log('收到 task_id，开始轮询:', data.task_id);
        setStockModalVisible(false);
        // 开始轮询任务状态
        pollStockUpdateTask(data.task_id);
      } else {
        console.log('未收到 task_id，使用旧的同步方式');
        // 旧的同步响应（兼容）
        notifySuccess('更新成功', '库存更新成功');
        setStockModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
      }
    },
    onError: (error: any) => {
      // 提取后端返回的详细错误信息
      const errorMessage = error?.response?.data?.detail || error?.message || '未知错误';
      notifyError('更新失败', `库存更新失败: ${errorMessage}`);
    },
  });

  // 轮询库存更新任务状态
  const pollStockUpdateTask = (taskId: string) => {
    console.log('开始轮询任务:', taskId);
    const key = `stock-update-${taskId}`;

    // 清除之前的定时器
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    // 显示初始通知
    console.log('显示初始通知');
    notification.info({
      key,
      message: '批量库存更新',
      description: '任务已提交，正在处理...',
      duration: 0,
      placement: 'bottomRight',
    });

    let pollCount = 0;
    const maxPolls = 900; // 最多轮询30分钟（每2秒一次）

    pollIntervalRef.current = setInterval(async () => {
      pollCount++;

      // 超时检查
      if (pollCount > maxPolls) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        notification.warning({
          key,
          message: '任务超时',
          description: '库存更新任务执行时间过长，请稍后手动刷新查看结果',
          duration: 8,
          placement: 'bottomRight',
        });
        return;
      }

      try {
        const status = await ozonApi.getBatchStockUpdateTaskStatus(taskId);
        console.log('任务状态:', status);

        // 任务完成
        if (status.state === 'SUCCESS' || status.info?.status === 'completed') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

          const updatedCount = status.result?.updated_count || status.info?.updated || 0;
          const errors = status.result?.errors || status.info?.errors || [];

          if (errors.length > 0) {
            notification.warning({
              key,
              message: '库存更新部分成功',
              description: `成功更新 ${updatedCount} 个商品，${errors.length} 个失败。查看控制台了解详情。`,
              duration: 8,
              placement: 'bottomRight',
            });
            console.error('库存更新错误:', errors);
          } else {
            notification.success({
              key,
              message: '库存更新完成',
              description: `成功更新 ${updatedCount} 个商品库存`,
              duration: 4,
              placement: 'bottomRight',
            });
          }

          // 刷新商品列表
          queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
        }
        // 任务失败
        else if (status.state === 'FAILURE' || status.info?.status === 'failed') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

          notification.error({
            key,
            message: '库存更新失败',
            description: status.error || status.result?.error || '更新失败，请重试',
            duration: 8,
            placement: 'bottomRight',
          });
        }
        // 任务执行中
        else {
          const progress = status.progress || status.info?.percent || 0;
          const current = status.info?.current || '处理中...';

          notification.info({
            key,
            message: '批量库存更新',
            description: `${current} (${progress}%)`,
            duration: 0,
            placement: 'bottomRight',
          });
        }
      } catch (error) {
        // 查询状态失败，但不立即停止轮询（可能是网络问题）
        console.error('查询任务状态失败:', error);
      }
    }, 2000); // 每2秒轮询一次
  };

  // 轮询价格更新任务状态
  const pollPriceUpdateTask = (taskId: string) => {
    console.log('开始轮询价格更新任务:', taskId);
    const key = `price-update-${taskId}`;

    // 清除之前的定时器
    if (pollPriceIntervalRef.current) {
      clearInterval(pollPriceIntervalRef.current);
    }

    // 显示初始通知
    console.log('显示初始通知');
    notification.info({
      key,
      message: '批量价格更新',
      description: '任务已提交，正在处理...',
      duration: 0,
      placement: 'bottomRight',
    });

    let pollCount = 0;
    const maxPolls = 900; // 最多轮询30分钟（每2秒一次）

    pollPriceIntervalRef.current = setInterval(async () => {
      pollCount++;

      // 超时检查
      if (pollCount > maxPolls) {
        if (pollPriceIntervalRef.current) clearInterval(pollPriceIntervalRef.current);
        notification.warning({
          key,
          message: '任务超时',
          description: '价格更新任务执行时间过长，请稍后手动刷新查看结果',
          duration: 8,
          placement: 'bottomRight',
        });
        return;
      }

      try {
        const status = await ozonApi.getBatchPriceUpdateTaskStatus(taskId);
        console.log('价格任务状态:', status);

        // 任务完成
        if (status.state === 'SUCCESS' || status.info?.status === 'completed') {
          if (pollPriceIntervalRef.current) clearInterval(pollPriceIntervalRef.current);

          const updatedCount = status.result?.updated_count || status.info?.updated || 0;
          const errors = status.result?.errors || status.info?.errors || [];

          if (errors.length > 0) {
            notification.warning({
              key,
              message: '价格更新部分成功',
              description: `成功更新 ${updatedCount} 个商品，${errors.length} 个失败。查看控制台了解详情。`,
              duration: 8,
              placement: 'bottomRight',
            });
            console.error('价格更新错误:', errors);
          } else {
            notification.success({
              key,
              message: '价格更新完成',
              description: `成功更新 ${updatedCount} 个商品价格`,
              duration: 4,
              placement: 'bottomRight',
            });
          }

          // 刷新商品列表
          queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
        }
        // 任务失败
        else if (status.state === 'FAILURE' || status.info?.status === 'failed') {
          if (pollPriceIntervalRef.current) clearInterval(pollPriceIntervalRef.current);

          notification.error({
            key,
            message: '价格更新失败',
            description: status.error || status.result?.error || '更新失败，请重试',
            duration: 8,
            placement: 'bottomRight',
          });
        }
        // 任务执行中
        else {
          const progress = status.progress || status.info?.percent || 0;
          const current = status.info?.current || '处理中...';

          notification.info({
            key,
            message: '批量价格更新',
            description: `${current} (${progress}%)`,
            duration: 0,
            placement: 'bottomRight',
          });
        }
      } catch (error) {
        // 查询状态失败，但不立即停止轮询（可能是网络问题）
        console.error('查询价格任务状态失败:', error);
      }
    }, 2000); // 每2秒轮询一次
  };

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
  };
};
