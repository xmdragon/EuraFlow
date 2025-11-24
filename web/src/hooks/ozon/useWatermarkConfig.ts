/**
 * 水印配置管理 Hook
 * 统一管理水印配置的加载和状态
 */
import { useState, useEffect, useCallback } from 'react';
import { notification } from 'antd';
import { getWatermarkConfigs, type WatermarkConfig } from '@/services/watermarkApi';
import { loggers } from '@/utils/logger';

export interface UseWatermarkConfigOptions {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 外部传入的配置列表（如果提供，则不自动加载） */
  initialConfigs?: WatermarkConfig[];
  /** 是否只返回激活的配置（默认 true） */
  onlyActive?: boolean;
}

export interface UseWatermarkConfigReturn {
  /** 水印配置列表 */
  configs: WatermarkConfig[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 手动刷新配置 */
  refresh: () => Promise<void>;
  /** 获取默认配置（第一个配置） */
  getDefaultConfig: () => WatermarkConfig | null;
}

/**
 * 水印配置管理 Hook
 */
export const useWatermarkConfig = (
  options: UseWatermarkConfigOptions = {}
): UseWatermarkConfigReturn => {
  const { enabled = true, initialConfigs, onlyActive = true } = options;

  const [configs, setConfigs] = useState<WatermarkConfig[]>(initialConfigs || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 加载水印配置
   */
  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedConfigs = await getWatermarkConfigs();
      const filteredConfigs = onlyActive
        ? fetchedConfigs.filter((c) => c.is_active)
        : fetchedConfigs;
      setConfigs(filteredConfigs);
      loggers.ozon.debug('水印配置加载成功', { count: filteredConfigs.length });
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      loggers.ozon.error('加载水印配置失败', err);
      notification.error({
        message: '加载失败',
        description: '无法加载水印配置列表',
        placement: 'bottomRight',
      });
    } finally {
      setLoading(false);
    }
  }, [onlyActive]);

  /**
   * 获取默认配置（第一个配置）
   */
  const getDefaultConfig = useCallback((): WatermarkConfig | null => {
    return configs.length > 0 ? configs[0] : null;
  }, [configs]);

  /**
   * 自动加载（仅在没有初始配置时）
   */
  useEffect(() => {
    if (enabled && !initialConfigs) {
      loadConfigs();
    }
  }, [enabled, initialConfigs, loadConfigs]);

  /**
   * 同步外部传入的配置
   */
  useEffect(() => {
    if (initialConfigs) {
      setConfigs(initialConfigs);
    }
  }, [initialConfigs]);

  return {
    configs,
    loading,
    error,
    refresh: loadConfigs,
    getDefaultConfig,
  };
};
