/**
 * OZON 自动采集地址管理 Hook
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

// 类型定义
export interface CollectionSource {
  id: number;
  source_type: 'category' | 'seller';
  source_url: string;
  source_path: string;
  display_name: string | null;
  is_enabled: boolean;
  priority: number;
  target_count: number;
  status: 'pending' | 'collecting' | 'completed' | 'failed';
  last_collected_at: string | null;
  last_product_count: number;
  total_collected_count: number;
  last_error: string | null;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionSourcesResponse {
  items: CollectionSource[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateSourceRequest {
  source_url: string;
  display_name?: string;
  priority?: number;
  target_count?: number;
  is_enabled?: boolean;
}

export interface UpdateSourceRequest {
  source_url?: string;
  display_name?: string;
  priority?: number;
  target_count?: number;
  is_enabled?: boolean;
}

// API 基础路径
const API_BASE = '/api/ef/v1';

// API 函数
const fetchCollectionSources = async (params: {
  page?: number;
  page_size?: number;
  is_enabled?: boolean;
  status?: string;
}): Promise<CollectionSourcesResponse> => {
  const response = await axios.get(`${API_BASE}/ozon/collection-sources`, { params });
  return response.data.data;
};

const createSource = async (data: CreateSourceRequest): Promise<{ id: number }> => {
  const response = await axios.post(`${API_BASE}/ozon/collection-sources`, data);
  return response.data.data;
};

const updateSource = async ({ id, data }: { id: number; data: UpdateSourceRequest }): Promise<void> => {
  await axios.put(`${API_BASE}/ozon/collection-sources/${id}`, data);
};

const deleteSource = async (id: number): Promise<void> => {
  await axios.delete(`${API_BASE}/ozon/collection-sources/${id}`);
};

const batchDeleteSources = async (ids: number[]): Promise<{ deleted_count: number; failed_count: number }> => {
  const response = await axios.post(`${API_BASE}/ozon/collection-sources/batch-delete`, { ids });
  return response.data.data;
};

const resetSource = async (id: number): Promise<void> => {
  await axios.post(`${API_BASE}/ozon/collection-sources/${id}/reset`);
};

/**
 * 采集地址管理 Hook
 */
export function useCollectionSources(params?: {
  page?: number;
  pageSize?: number;
  isEnabled?: boolean;
  status?: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['collection-sources', params];

  // 查询列表
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchCollectionSources({
      page: params?.page || 1,
      page_size: params?.pageSize || 20,
      is_enabled: params?.isEnabled,
      status: params?.status,
    }),
    staleTime: 30000, // 30秒缓存
  });

  // 创建
  const createMutation = useMutation({
    mutationFn: createSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-sources'] });
      notifySuccess('采集地址创建成功');
    },
    onError: (error: any) => {
      const detail = error.response?.data?.detail;
      if (typeof detail === 'object' && detail.code === 'SOURCE_EXISTS') {
        notifyError('该采集地址已存在');
      } else {
        notifyError('创建失败: ' + (detail?.detail || error.message));
      }
    },
  });

  // 更新
  const updateMutation = useMutation({
    mutationFn: updateSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-sources'] });
      notifySuccess('更新成功');
    },
    onError: (error: any) => {
      notifyError('更新失败: ' + (error.response?.data?.detail?.detail || error.message));
    },
  });

  // 删除
  const deleteMutation = useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-sources'] });
      notifySuccess('删除成功');
    },
    onError: (error: any) => {
      notifyError('删除失败: ' + (error.response?.data?.detail?.detail || error.message));
    },
  });

  // 批量删除
  const batchDeleteMutation = useMutation({
    mutationFn: batchDeleteSources,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collection-sources'] });
      if (result.failed_count > 0) {
        notifySuccess(`删除成功 ${result.deleted_count} 条，失败 ${result.failed_count} 条`);
      } else {
        notifySuccess(`成功删除 ${result.deleted_count} 条记录`);
      }
    },
    onError: (error: any) => {
      notifyError('批量删除失败: ' + (error.response?.data?.detail?.detail || error.message));
    },
  });

  // 重置状态
  const resetMutation = useMutation({
    mutationFn: resetSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-sources'] });
      notifySuccess('状态已重置');
    },
    onError: (error: any) => {
      notifyError('重置失败: ' + (error.response?.data?.detail?.detail || error.message));
    },
  });

  // 切换启用状态
  const toggleEnabled = async (id: number, isEnabled: boolean) => {
    await updateMutation.mutateAsync({ id, data: { is_enabled: isEnabled } });
  };

  return {
    // 数据
    sources: data?.items || [],
    total: data?.total || 0,
    page: data?.page || 1,
    pageSize: data?.page_size || 20,
    isLoading,
    error,

    // 操作
    refetch,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    batchRemove: batchDeleteMutation.mutateAsync,
    reset: resetMutation.mutateAsync,
    toggleEnabled,

    // 加载状态
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending || batchDeleteMutation.isPending,
    isResetting: resetMutation.isPending,
  };
}
