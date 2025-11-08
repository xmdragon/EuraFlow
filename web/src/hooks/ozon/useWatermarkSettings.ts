/**
 * 水印设置状态管理 Hook
 * 统一管理图片的水印配置和位置设置
 */
import { useState, useCallback, useEffect } from 'react';
import type { WatermarkPosition } from '@/utils/ozon/watermarkUtils';

export interface WatermarkSetting {
  /** 水印配置ID */
  configId: number;
  /** 水印位置 */
  position?: WatermarkPosition;
}

export interface UseWatermarkSettingsOptions {
  /** 初始化的图片ID列表 */
  imageIds?: string[];
  /** 默认的水印配置ID */
  defaultConfigId?: number;
  /** 默认的水印位置（默认 'bottom_right'） */
  defaultPosition?: WatermarkPosition;
  /** 是否自动初始化（默认 true） */
  autoInitialize?: boolean;
}

export interface UseWatermarkSettingsReturn {
  /** 水印设置Map */
  settings: Map<string, WatermarkSetting>;
  /** 设置单个图片的位置 */
  setPosition: (imageId: string, position: WatermarkPosition) => void;
  /** 设置单个图片的配置ID */
  setConfigId: (imageId: string, configId: number) => void;
  /** 同时设置配置ID和位置 */
  setBoth: (imageId: string, configId: number, position?: WatermarkPosition) => void;
  /** 批量设置默认值 */
  setDefaults: (imageIds: string[], configId: number, position?: WatermarkPosition) => void;
  /** 获取单个图片的设置 */
  getSetting: (imageId: string) => WatermarkSetting | undefined;
  /** 检查是否有任何设置 */
  hasSettings: () => boolean;
  /** 重置所有设置 */
  reset: () => void;
}

/**
 * 水印设置状态管理 Hook
 */
export const useWatermarkSettings = (
  options: UseWatermarkSettingsOptions = {}
): UseWatermarkSettingsReturn => {
  const {
    imageIds = [],
    defaultConfigId,
    defaultPosition = 'bottom_right',
    autoInitialize = true,
  } = options;

  const [settings, setSettings] = useState<Map<string, WatermarkSetting>>(new Map());

  /**
   * 设置单个图片的位置
   */
  const setPosition = useCallback((imageId: string, position: WatermarkPosition) => {
    setSettings((prev) => {
      const newSettings = new Map(prev);
      const existing = newSettings.get(imageId);
      if (existing) {
        newSettings.set(imageId, { ...existing, position });
      } else if (defaultConfigId) {
        // 如果没有现有设置但有默认配置ID，创建新设置
        newSettings.set(imageId, { configId: defaultConfigId, position });
      }
      return newSettings;
    });
  }, [defaultConfigId]);

  /**
   * 设置单个图片的配置ID
   */
  const setConfigId = useCallback((imageId: string, configId: number) => {
    setSettings((prev) => {
      const newSettings = new Map(prev);
      const existing = newSettings.get(imageId);
      newSettings.set(imageId, {
        configId,
        position: existing?.position || defaultPosition,
      });
      return newSettings;
    });
  }, [defaultPosition]);

  /**
   * 同时设置配置ID和位置
   */
  const setBoth = useCallback(
    (imageId: string, configId: number, position?: WatermarkPosition) => {
      setSettings((prev) => {
        const newSettings = new Map(prev);
        newSettings.set(imageId, {
          configId,
          position: position || defaultPosition,
        });
        return newSettings;
      });
    },
    [defaultPosition]
  );

  /**
   * 批量设置默认值
   */
  const setDefaults = useCallback(
    (imageIds: string[], configId: number, position?: WatermarkPosition) => {
      setSettings((prev) => {
        const newSettings = new Map(prev);
        imageIds.forEach((id) => {
          // 只为没有设置的图片设置默认值
          if (!newSettings.has(id)) {
            newSettings.set(id, {
              configId,
              position: position || defaultPosition,
            });
          }
        });
        return newSettings;
      });
    },
    [defaultPosition]
  );

  /**
   * 获取单个图片的设置
   */
  const getSetting = useCallback(
    (imageId: string): WatermarkSetting | undefined => {
      return settings.get(imageId);
    },
    [settings]
  );

  /**
   * 检查是否有任何设置
   */
  const hasSettings = useCallback((): boolean => {
    return settings.size > 0;
  }, [settings]);

  /**
   * 重置所有设置
   */
  const reset = useCallback(() => {
    setSettings(new Map());
  }, []);

  /**
   * 自动初始化
   */
  useEffect(() => {
    if (autoInitialize && imageIds.length > 0 && defaultConfigId && !hasSettings()) {
      setDefaults(imageIds, defaultConfigId, defaultPosition);
    }
  }, [autoInitialize, imageIds, defaultConfigId, defaultPosition, hasSettings, setDefaults]);

  return {
    settings,
    setPosition,
    setConfigId,
    setBoth,
    setDefaults,
    getSetting,
    hasSettings,
    reset,
  };
};
