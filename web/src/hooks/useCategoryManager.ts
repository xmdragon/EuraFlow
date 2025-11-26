/**
 * 类目管理Hook
 * 管理商品类目选择、类目树、类目属性加载等逻辑
 */
import { useState, useCallback, useEffect } from 'react';
import type { CategoryAttribute } from '@/services/ozon';
import * as categoryService from '@/services/ozon/categoryService';
import { syncSingleCategoryAttributes } from '@/services/ozon';
import { notifyError } from '@/utils/notification';

// 类目选项接口
export interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

export interface UseCategoryManagerProps {
  selectedShop: number | null;
  /**
   * 自动添加变体维度的函数（从 variantManager 中提取，避免依赖整个对象导致无限循环）
   */
  autoAddVariantDimensions: (attributes: CategoryAttribute[]) => void;
  setSpecialFieldDescriptions: (descriptions: Record<string, string>) => void;
}

export interface UseCategoryManagerReturn {
  // 状态
  selectedCategory: number | null;
  categoryTree: CategoryOption[];
  categoryPath: number[] | undefined;
  cascaderKey: number;
  hasCategoryData: boolean;
  categoryAttributes: CategoryAttribute[];
  loadingAttributes: boolean;
  typeId: number | null;
  syncingCategoryAttributes: boolean;
  pendingCategoryId: number | null;

  // 状态更新函数
  setSelectedCategory: (categoryId: number | null) => void;
  setCategoryTree: (tree: CategoryOption[]) => void;
  setCategoryPath: (path: number[] | undefined) => void;
  setCascaderKey: (key: number) => void;
  setHasCategoryData: (hasData: boolean) => void;
  setCategoryAttributes: (attributes: CategoryAttribute[]) => void;
  setTypeId: (id: number | null) => void;
  setPendingCategoryId: (id: number | null) => void;

  // 业务逻辑函数
  loadCategoryAttributes: (categoryId: number) => Promise<void>;
  handleSyncCategoryAttributes: () => Promise<void>;
}

export const useCategoryManager = ({
  selectedShop,
  autoAddVariantDimensions,
  setSpecialFieldDescriptions,
}: UseCategoryManagerProps): UseCategoryManagerReturn => {
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [categoryTree, setCategoryTree] = useState<CategoryOption[]>([]);
  const [categoryPath, setCategoryPath] = useState<number[] | undefined>(undefined);
  const [cascaderKey, setCascaderKey] = useState(0);
  const [hasCategoryData, setHasCategoryData] = useState(false);
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [syncingCategoryAttributes, setSyncingCategoryAttributes] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<number | null>(null);

  /**
   * 加载类目属性
   */
  const loadCategoryAttributes = useCallback(
    async (categoryId: number) => {
      if (!selectedShop) {
        return;
      }

      setLoadingAttributes(true);
      try {
        const result = await categoryService.loadCategoryAttributes({
          shopId: selectedShop,
          categoryId,
        });

        if (result.success && result.data) {
          setCategoryAttributes(result.data);

          // 保存 type_id（如果后端返回了的话）
          if (result.type_id !== undefined) {
            setTypeId(result.type_id);
          }

          // 提取特殊字段的说明（用于更新默认字段的 tooltip/help）
          const specialDescriptions = categoryService.extractSpecialFieldDescriptions(result.data);
          setSpecialFieldDescriptions(specialDescriptions);

          // 自动添加 is_aspect=true 的属性到变体维度
          const aspectAttributes = categoryService.extractAspectAttributes(result.data);
          if (aspectAttributes.length > 0) {
            autoAddVariantDimensions(aspectAttributes);
          }
        } else {
          setCategoryAttributes([]);
          setTypeId(null);
        }
      } catch {
        setCategoryAttributes([]);
        setTypeId(null);
      } finally {
        setLoadingAttributes(false);
      }
    },
    [selectedShop, autoAddVariantDimensions, setSpecialFieldDescriptions]
  );

  /**
   * 同步当前类目特征
   */
  const handleSyncCategoryAttributes = useCallback(async () => {
    if (!selectedCategory || !selectedShop) {
      notifyError('操作失败', '请先选择店铺和类目');
      return;
    }

    setSyncingCategoryAttributes(true);
    try {
      const result = await syncSingleCategoryAttributes(selectedCategory, selectedShop, {
        language: 'ZH_HANS',
        forceRefresh: false,
        syncDictionaryValues: true,
      });

      if (result.success) {
        // 类目特征同步成功（不显示通知，避免干扰用户）
      } else {
        notifyError('同步失败', result.error || '未知错误');
      }
    } catch (error: unknown) {
      notifyError('同步失败', error instanceof Error ? error.message : '网络错误');
    } finally {
      setSyncingCategoryAttributes(false);
    }
  }, [selectedCategory, selectedShop]);

  /**
   * 类目选择变化时自动加载属性
   */
  useEffect(() => {
    if (selectedCategory && selectedShop) {
      loadCategoryAttributes(selectedCategory);
    } else {
      setCategoryAttributes([]);
    }
  }, [selectedCategory, selectedShop, loadCategoryAttributes]);

  return {
    // 状态
    selectedCategory,
    categoryTree,
    categoryPath,
    cascaderKey,
    hasCategoryData,
    categoryAttributes,
    loadingAttributes,
    typeId,
    syncingCategoryAttributes,
    pendingCategoryId,

    // 状态更新函数
    setSelectedCategory,
    setCategoryTree,
    setCategoryPath,
    setCascaderKey,
    setHasCategoryData,
    setCategoryAttributes,
    setTypeId,
    setPendingCategoryId,

    // 业务逻辑函数
    loadCategoryAttributes,
    handleSyncCategoryAttributes,
  };
};
