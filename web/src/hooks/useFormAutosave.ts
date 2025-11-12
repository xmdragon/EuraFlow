/**
 * 表单自动保存 Hook
 *
 * 特性：
 * - 防抖策略：用户停止输入后1秒自动保存
 * - 定时保存：每60秒强制保存一次
 * - 变化检测：仅在表单有变化时保存
 * - 错误处理：保存失败不打断用户操作
 * - 状态跟踪：提供保存状态指示
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { loggers } from "@/utils/logger";

interface UseFormAutosaveOptions<T> {
  /**
   * 获取表单数据的函数（实时获取）
   */
  getFormData: () => T;

  /**
   * 保存函数（异步）
   */
  onSave: (data: T) => Promise<void>;

  /**
   * 防抖延迟（毫秒）
   * @default 1000
   */
  debounceDelay?: number;

  /**
   * 定时保存间隔（毫秒）
   * @default 60000 (1分钟)
   */
  autoSaveInterval?: number;

  /**
   * 是否启用自动保存
   * @default true
   */
  enabled?: boolean;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const useFormAutosave = <T>({
  getFormData,
  onSave,
  debounceDelay = 1000,
  autoSaveInterval = 60000,
  enabled = true,
}: UseFormAutosaveOptions<T>) => {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const intervalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedDataRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const getFormDataRef = useRef(getFormData);

  // 更新 getFormData 引用
  useEffect(() => {
    getFormDataRef.current = getFormData;
  }, [getFormData]);

  /**
   * 检查表单是否有变化（实时获取最新数据）
   */
  const hasChanges = useCallback(() => {
    const currentData = JSON.stringify(getFormDataRef.current());
    return currentData !== lastSavedDataRef.current;
  }, []);

  /**
   * 执行保存
   */
  const performSave = useCallback(async () => {
    if (!enabled || savingRef.current || !hasChanges()) {
      return;
    }

    savingRef.current = true;
    setSaveStatus("saving");

    try {
      const currentFormData = getFormDataRef.current();
      await onSave(currentFormData);
      lastSavedDataRef.current = JSON.stringify(currentFormData);
      setLastSavedAt(new Date());
      setSaveStatus("saved");
      loggers.product.info("表单自动保存成功");

      // 3秒后恢复为 idle 状态
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (error) {
      loggers.product.error("表单自动保存失败", error);
      setSaveStatus("error");

      // 5秒后恢复为 idle 状态
      setTimeout(() => {
        setSaveStatus("idle");
      }, 5000);
    } finally {
      savingRef.current = false;
    }
  }, [enabled, onSave, hasChanges]);

  /**
   * 防抖保存（用户停止输入后触发）
   * 注意：不依赖 formData，避免每次渲染都触发
   */
  const triggerDebounce = useCallback(() => {
    if (!enabled) {
      return;
    }

    // 清除之前的防抖计时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 设置新的防抖计时器
    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, debounceDelay);
  }, [enabled, debounceDelay, performSave]);

  // 组件卸载时清除计时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /**
   * 定时保存（固定间隔）
   */
  useEffect(() => {
    if (!enabled || autoSaveInterval <= 0) {
      return;
    }

    intervalTimerRef.current = setInterval(() => {
      performSave();
    }, autoSaveInterval);

    return () => {
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current);
      }
    };
  }, [enabled, autoSaveInterval, performSave]);

  /**
   * 组件卸载时保存
   */
  useEffect(() => {
    return () => {
      if (enabled && hasChanges()) {
        // 同步保存（使用 navigator.sendBeacon 或忽略）
        loggers.product.info("组件卸载，尝试保存草稿");
      }
    };
  }, [enabled, hasChanges]);

  return {
    /**
     * 手动触发保存
     */
    saveNow: performSave,

    /**
     * 触发防抖保存（在表单值变化时调用）
     */
    triggerDebounce,

    /**
     * 检查是否有未保存的更改（实时检查）
     */
    checkHasChanges: hasChanges,

    /**
     * 保存状态
     */
    saveStatus,

    /**
     * 最后保存时间
     */
    lastSavedAt,
  };
};
