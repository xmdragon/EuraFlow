import { useState, useEffect, useCallback, useMemo } from 'react';
import useAuth from './useAuth';

/**
 * 用户隔离的 localStorage Hook
 *
 * 自动在 key 前加上用户 ID 前缀，确保不同用户的数据互相隔离
 * 当用户未登录时，使用 'guest' 作为前缀
 *
 * @example
 * const { getValue, setValue, removeValue } = useUserStorage();
 *
 * // 读取
 * const items = getValue<QuickMenuItem[]>('quickMenuItems', []);
 *
 * // 写入
 * setValue('quickMenuItems', items);
 *
 * // 删除
 * removeValue('quickMenuItems');
 */
export const useUserStorage = () => {
  const { user } = useAuth();

  // 用户 ID，未登录时使用 'guest'
  const userId = user?.id ?? 'guest';

  // 生成带用户前缀的 key
  const getKey = useCallback(
    (key: string) => `user_${userId}_${key}`,
    [userId]
  );

  // 获取值
  const getValue = useCallback(
    <T>(key: string, defaultValue: T): T => {
      try {
        const prefixedKey = getKey(key);
        const stored = localStorage.getItem(prefixedKey);
        if (stored === null) {
          return defaultValue;
        }
        return JSON.parse(stored) as T;
      } catch {
        return defaultValue;
      }
    },
    [getKey]
  );

  // 设置值
  const setValue = useCallback(
    <T>(key: string, value: T): void => {
      try {
        const prefixedKey = getKey(key);
        localStorage.setItem(prefixedKey, JSON.stringify(value));
      } catch (error) {
        console.error(`Failed to save ${key} to localStorage:`, error);
      }
    },
    [getKey]
  );

  // 删除值
  const removeValue = useCallback(
    (key: string): void => {
      try {
        const prefixedKey = getKey(key);
        localStorage.removeItem(prefixedKey);
      } catch (error) {
        console.error(`Failed to remove ${key} from localStorage:`, error);
      }
    },
    [getKey]
  );

  return {
    userId,
    getKey,
    getValue,
    setValue,
    removeValue,
  };
};

/**
 * 带状态管理的用户隔离 localStorage Hook
 *
 * 自动管理 React 状态与 localStorage 的同步
 * 当用户切换时自动重新加载数据
 *
 * @example
 * const [items, setItems] = useUserStorageState<QuickMenuItem[]>('quickMenuItems', []);
 */
export function useUserStorageState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const { userId, getKey, getValue, setValue } = useUserStorage();

  // 初始状态从 localStorage 加载
  const [state, setState] = useState<T>(() => getValue(key, defaultValue));

  // 当用户切换时，重新从 localStorage 加载数据
  useEffect(() => {
    const newValue = getValue(key, defaultValue);
    setState(newValue);
  }, [userId, key]); // userId 变化时重新加载

  // 更新状态并同步到 localStorage
  const setStateAndStorage = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const newValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        setValue(key, newValue);
        return newValue;
      });
    },
    [key, setValue]
  );

  return [state, setStateAndStorage];
}

export default useUserStorage;
