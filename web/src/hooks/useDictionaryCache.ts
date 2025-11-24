/**
 * 字典值缓存Hook
 * 管理类目属性的字典值缓存和加载
 */
import { useState } from 'react';
import type { DictionaryValue } from '@/services/ozon';
import * as categoryService from '@/services/ozon/categoryService';

export interface UseDictionaryCacheProps {
  selectedShop: number | null;
}

export interface UseDictionaryCacheReturn {
  // 状态
  dictionaryValuesCache: Record<number, DictionaryValue[]>;

  // 状态更新函数
  setDictionaryValuesCache: React.Dispatch<React.SetStateAction<Record<number, DictionaryValue[]>>>;

  // 业务逻辑函数
  loadDictionaryValues: (
    categoryId: number,
    attributeId: number,
    query?: string
  ) => Promise<DictionaryValue[]>;
}

export const useDictionaryCache = ({
  selectedShop,
}: UseDictionaryCacheProps): UseDictionaryCacheReturn => {
  const [dictionaryValuesCache, setDictionaryValuesCache] = useState<Record<number, DictionaryValue[]>>(
    {}
  );

  /**
   * 加载字典值（直接调用 OZON 搜索 API）
   */
  const loadDictionaryValues = async (
    categoryId: number,
    attributeId: number,
    query?: string
  ): Promise<DictionaryValue[]> => {
    if (!selectedShop) {
      return [];
    }

    return categoryService.loadDictionaryValues(selectedShop, categoryId, attributeId, query, 100);
  };

  return {
    // 状态
    dictionaryValuesCache,

    // 状态更新函数
    setDictionaryValuesCache,

    // 业务逻辑函数
    loadDictionaryValues,
  };
};
