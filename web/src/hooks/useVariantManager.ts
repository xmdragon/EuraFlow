/**
 * 变体管理 Hook
 *
 * 功能：
 * - 变体维度管理（添加/移除/自动添加可变属性）
 * - 变体行CRUD（添加/删除/更新）
 * - 批量操作（生成Offer ID、批量设价）
 */
import { useState, useCallback } from 'react';
import type { CategoryAttribute } from '@/services/ozonApi';
import type { VideoInfo } from '@/services/ozonApi';
import { notifySuccess, notifyWarning } from '@/utils/notification';

// 变体维度（用户选择的属性作为变体维度）
export interface VariantDimension {
  attribute_id: number;
  category_id: number; // 新增：类目ID（用于调用搜索API）
  name: string;
  attribute_type: string;
  dictionary_id?: number;
  dictionary_value_count?: number | null;  // 字典值数量
  dictionary_values?: Array<{ value_id: number; value: string; info?: string; picture?: string }> | null;  // 预加载的字典值
  // 原始字段key（用于恢复显示）
  original_field_key?: string;
}

// 变体接口
export interface ProductVariant {
  id: string;
  // 维度值：attribute_id -> value
  dimension_values: Record<number, unknown>;
  offer_id: string;
  title?: string;  // 标题（变体可以有不同的标题）
  images?: string[];  // 图片数组（支持多图）
  videos?: VideoInfo[];  // 视频数组
  price?: number;
  old_price?: number;
  barcode?: string;
}

// Hook返回接口
export interface UseVariantManagerReturn {
  // 状态
  variants: ProductVariant[];
  variantDimensions: VariantDimension[];
  hiddenFields: Set<string>;
  variantSectionExpanded: boolean;
  variantTableCollapsed: boolean;
  selectedVariantIds: Set<number>;

  // 维度管理
  addVariantDimension: (attr: CategoryAttribute) => void;
  removeVariantDimension: (attributeId: number) => void;
  autoAddVariantDimensions: (aspectAttrs: CategoryAttribute[]) => void;
  addFieldAsVariant: (fieldKey: string, fieldName: string, fieldType?: string) => void;

  // 变体行CRUD
  addVariantRow: () => void;
  deleteVariantRow: (id: string) => void;
  updateVariantRow: (id: string, field: string, value: unknown) => void;

  // 批量操作
  batchGenerateOfferId: () => void;
  batchSetPrice: (price: number | null) => void;
  batchSetOldPrice: (oldPrice: number | null) => void;

  // UI状态管理
  setVariantSectionExpanded: (expanded: boolean) => void;
  setVariantTableCollapsed: (collapsed: boolean) => void;
  setSelectedVariantIds: (ids: Set<number>) => void;

  // 内部状态（供序列化/反序列化使用）
  setVariants: (variants: ProductVariant[]) => void;
  setVariantDimensions: (dimensions: VariantDimension[]) => void;
  setHiddenFields: (fields: Set<string>) => void;
}

/**
 * 生成Offer ID（格式：ef_16位数字）
 */
const generateOfferId = (): string => {
  const timestamp = Date.now().toString(); // 13位时间戳
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0'); // 3位随机数
  return `ef_${timestamp}${random}`; // ef_ + 16位数字
};

/**
 * 变体管理 Hook
 */
export const useVariantManager = (): UseVariantManagerReturn => {
  // 变体相关状态
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantDimensions, setVariantDimensions] = useState<VariantDimension[]>([]);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());

  // UI状态
  const [variantSectionExpanded, setVariantSectionExpanded] = useState<boolean>(false);
  const [variantTableCollapsed, setVariantTableCollapsed] = useState<boolean>(false);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<number>>(new Set());

  // ==================== 维度管理 ====================

  /**
   * 添加变体维度（支持类目属性）
   */
  const addVariantDimension = useCallback((attr: CategoryAttribute) => {
    const fieldKey = `attr_${attr.attribute_id}`;

    setVariantDimensions((prev) => {
      // 检查是否已添加
      if (prev.find((d) => d.attribute_id === attr.attribute_id)) {
        notifyWarning('已添加', '该属性已作为变体维度');
        return prev;
      }

      const dimension: VariantDimension = {
        attribute_id: attr.attribute_id,
        category_id: attr.category_id,
        name: attr.name,
        attribute_type: attr.attribute_type,
        dictionary_id: attr.dictionary_id,
        dictionary_value_count: attr.dictionary_value_count,
        dictionary_values: attr.dictionary_values,
        original_field_key: fieldKey,
      };

      return [...prev, dimension];
    });

    setHiddenFields((prev) => new Set([...prev, fieldKey]));

    // 自动展开变体部分
    setVariantSectionExpanded(true);

    // 如果还没有变体行，自动创建2行（首次添加维度时）
    setVariants((prevVariants) => {
      if (prevVariants.length === 0) {
        const variant1: ProductVariant = {
          id: Date.now().toString(),
          dimension_values: {},
          offer_id: generateOfferId(),
          title: '',
          price: undefined,
          old_price: undefined,
        };
        const variant2: ProductVariant = {
          id: (Date.now() + 1).toString(),
          dimension_values: {},
          offer_id: generateOfferId(),
          title: '',
          price: undefined,
          old_price: undefined,
        };
        return [variant1, variant2];
      }
      return prevVariants;
    });
  }, []);

  /**
   * 移除变体维度
   */
  const removeVariantDimension = useCallback((attributeId: number) => {
    setVariantDimensions((prev) => {
      // 找到要移除的维度
      const removedDimension = prev.find((d) => d.attribute_id === attributeId);

      // 恢复原字段显示
      if (removedDimension && removedDimension.original_field_key) {
        setHiddenFields((fields) => {
          const newFields = new Set(fields);
          newFields.delete(removedDimension.original_field_key!);
          return newFields;
        });
      }

      return prev.filter((d) => d.attribute_id !== attributeId);
    });

    // 只移除该维度的值，不清空所有变体
    setVariants((prev) =>
      prev.map((v) => {
        const newDimensionValues = { ...v.dimension_values };
        delete newDimensionValues[attributeId];
        return { ...v, dimension_values: newDimensionValues };
      })
    );
  }, []);

  /**
   * 自动添加多个变体维度（用于 is_aspect 属性，类目切换时调用）
   */
  const autoAddVariantDimensions = useCallback((aspectAttrs: CategoryAttribute[]) => {
    // 获取新类目的所有可变属性ID
    const newAspectAttrIds = new Set(aspectAttrs.map((attr) => attr.attribute_id));

    setVariantDimensions((prevDimensions) => {
      // 过滤现有变体维度，保留新类目中仍然存在的可变属性
      const validDimensions = prevDimensions.filter((dim) => {
        // 如果是自定义字段（负数ID），保留
        if (dim.attribute_id < 0) return true;
        // 如果新类目中包含这个属性，保留
        return newAspectAttrIds.has(dim.attribute_id);
      });

      // 找出需要添加的新属性
      const dimensionsToAdd: VariantDimension[] = [];
      aspectAttrs.forEach((attr) => {
        // 检查是否已存在（包括validDimensions中）
        if (!validDimensions.find((d) => d.attribute_id === attr.attribute_id)) {
          const fieldKey = `attr_${attr.attribute_id}`;

          dimensionsToAdd.push({
            attribute_id: attr.attribute_id,
            category_id: attr.category_id,
            name: attr.name,
            attribute_type: attr.attribute_type,
            dictionary_id: attr.dictionary_id,
            dictionary_value_count: attr.dictionary_value_count,
            dictionary_values: attr.dictionary_values,
            original_field_key: fieldKey,
          });
        }
      });

      // 找出需要移除的属性
      const removedDimensions = prevDimensions.filter((dim) => {
        // 自定义字段不移除
        if (dim.attribute_id < 0) return false;
        // 新类目中不存在的属性需要移除
        return !newAspectAttrIds.has(dim.attribute_id);
      });

      // 合并所有有效的变体维度
      const finalDimensions = [...validDimensions, ...dimensionsToAdd];

      // 更新 hiddenFields
      const newHiddenFields = new Set<string>();
      finalDimensions.forEach((dim) => {
        if (dim.original_field_key) {
          newHiddenFields.add(dim.original_field_key);
        }
      });
      setHiddenFields(newHiddenFields);

      // 更新变体数据：移除多余字段，添加缺失字段
      setVariants((prevVariants) =>
        prevVariants.map((variant) => {
          const newVariant = { ...variant };

          // 移除多余的属性
          removedDimensions.forEach((dim) => {
            if (dim.original_field_key && newVariant[dim.original_field_key] !== undefined) {
              delete newVariant[dim.original_field_key];
            }
          });

          // 为新添加的属性设置默认值
          dimensionsToAdd.forEach((dim) => {
            if (dim.original_field_key && newVariant[dim.original_field_key] === undefined) {
              newVariant[dim.original_field_key] = '';
            }
          });

          return newVariant;
        })
      );

      // 提示用户
      if (dimensionsToAdd.length > 0 || removedDimensions.length > 0) {
        if (removedDimensions.length > 0 && dimensionsToAdd.length > 0) {
          notifyWarning(
            '变体属性已调整',
            `移除了 ${removedDimensions.length} 个旧属性，添加了 ${dimensionsToAdd.length} 个新属性`
          );
        } else if (removedDimensions.length > 0) {
          notifyWarning('变体属性已调整', `移除了 ${removedDimensions.length} 个不再需要的属性`);
        } else if (dimensionsToAdd.length > 0) {
          notifySuccess('变体属性已添加', `自动添加了 ${dimensionsToAdd.length} 个可变属性`);
          setVariantSectionExpanded(true);
        }
      }

      return finalDimensions;
    });
  }, []);

  /**
   * 添加普通字段为变体维度
   */
  const addFieldAsVariant = useCallback(
    (fieldKey: string, fieldName: string, fieldType: string = 'String') => {
      setHiddenFields((prev) => {
        // 检查是否已添加
        if (prev.has(fieldKey)) {
          return prev;
        }

        // 使用字段key的hash作为ID（保持唯一性）
        const fieldId = -Math.abs(
          fieldKey.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        );

        const dimension: VariantDimension = {
          attribute_id: fieldId,
          name: fieldName,
          attribute_type: fieldType,
          original_field_key: fieldKey,
        };

        setVariantDimensions((dimensions) => [...dimensions, dimension]);

        // 自动展开变体部分并创建2行（首次）
        if (!variantSectionExpanded) {
          setVariantSectionExpanded(true);

          // 如果还没有变体行，自动创建2行
          setVariants((prevVariants) => {
            if (prevVariants.length === 0) {
              const variant1: ProductVariant = {
                id: Date.now().toString(),
                dimension_values: {},
                offer_id: generateOfferId(),
                title: '',
                price: undefined,
                old_price: undefined,
              };
              const variant2: ProductVariant = {
                id: (Date.now() + 1).toString(),
                dimension_values: {},
                offer_id: generateOfferId(),
                title: '',
                price: undefined,
                old_price: undefined,
              };
              return [variant1, variant2];
            }
            return prevVariants;
          });
        }

        return new Set([...prev, fieldKey]);
      });
    },
    [variantSectionExpanded]
  );

  // ==================== 变体行CRUD ====================

  /**
   * 添加变体行
   */
  const addVariantRow = useCallback(() => {
    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      dimension_values: {},
      offer_id: generateOfferId(),
      title: '',
      price: undefined,
      old_price: undefined,
    };
    setVariants((prev) => [...prev, newVariant]);
  }, []);

  /**
   * 删除变体行
   */
  const deleteVariantRow = useCallback((id: string) => {
    setVariants((prev) => prev.filter((v) => v.id !== id));
  }, []);

  /**
   * 更新变体行数据
   */
  const updateVariantRow = useCallback((id: string, field: string, value: unknown) => {
    setVariants((prev) =>
      prev.map((v) => {
        if (v.id === id) {
          if (field.startsWith('dim_')) {
            // 维度值更新
            const attrId = parseInt(field.replace('dim_', ''));
            return {
              ...v,
              dimension_values: {
                ...v.dimension_values,
                [attrId]: value,
              },
            };
          } else {
            // 普通字段更新
            return { ...v, [field]: value };
          }
        }
        return v;
      })
    );
  }, []);

  // ==================== 批量操作 ====================

  /**
   * 批量生成 Offer ID
   */
  const batchGenerateOfferId = useCallback(() => {
    setVariants((prev) => {
      if (prev.length === 0) return prev;

      return prev.map((v, index) => {
        // 为每个变体生成唯一的Offer ID
        if (index > 0) {
          // 添加索引来确保唯一性
          const timestamp = Date.now().toString();
          const random = (Math.floor(Math.random() * 900) + index).toString().padStart(3, '0');
          return { ...v, offer_id: `ef_${timestamp}${random}` };
        }
        return { ...v, offer_id: generateOfferId() };
      });
    });
  }, []);

  /**
   * 批量设置售价
   */
  const batchSetPrice = useCallback((price: number | null) => {
    if (price === null || price === undefined) return;
    setVariants((prev) => prev.map((v) => ({ ...v, price })));
  }, []);

  /**
   * 批量设置原价
   */
  const batchSetOldPrice = useCallback((oldPrice: number | null) => {
    if (oldPrice === null || oldPrice === undefined) return;
    setVariants((prev) => prev.map((v) => ({ ...v, old_price: oldPrice })));
  }, []);

  // ==================== 返回接口 ====================

  return {
    // 状态
    variants,
    variantDimensions,
    hiddenFields,
    variantSectionExpanded,
    variantTableCollapsed,
    selectedVariantIds,

    // 维度管理
    addVariantDimension,
    removeVariantDimension,
    autoAddVariantDimensions,
    addFieldAsVariant,

    // 变体行CRUD
    addVariantRow,
    deleteVariantRow,
    updateVariantRow,

    // 批量操作
    batchGenerateOfferId,
    batchSetPrice,
    batchSetOldPrice,

    // UI状态管理
    setVariantSectionExpanded,
    setVariantTableCollapsed,
    setSelectedVariantIds,

    // 内部状态（供序列化/反序列化使用）
    setVariants,
    setVariantDimensions,
    setHiddenFields,
  };
};
