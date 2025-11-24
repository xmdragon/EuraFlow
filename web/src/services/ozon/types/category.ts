/**
 * OZON 类目类型定义
 */

/**
 * 类目
 */
export interface Category {
  category_id: number;
  name: string;
  parent_id?: number;
  is_leaf: boolean;
  level: number;
}

/**
 * 字典值
 */
export interface DictionaryValue {
  value_id: number;
  value: string;
  info?: string;
  picture?: string;
}

/**
 * 类目属性
 */
export interface CategoryAttribute {
  attribute_id: number;
  category_id: number;
  name: string;
  description?: string;
  attribute_type: string;
  is_required: boolean;
  is_collection: boolean;
  is_aspect: boolean;
  dictionary_id?: number;
  category_dependent?: boolean;
  group_id?: number;
  group_name?: string;
  attribute_complex_id?: number;
  max_value_count?: number;
  complex_is_collection?: boolean;
  min_value?: number;
  max_value?: number;
  guide_values?: DictionaryValue[] | null;
  dictionary_value_count?: number | null;  // 字典值数量
  dictionary_values?: DictionaryValue[] | null;  // 预加载的字典值（≤100条时）
}

/**
 * 批量同步类目属性选项
 */
export interface BatchSyncCategoryAttributesOptions {
  categoryIds?: number[];
  syncAllLeaf?: boolean;
  syncDictionaryValues?: boolean;
  language?: string;
  maxConcurrent?: number;
}

/**
 * 同步单个类目属性选项
 */
export interface SyncSingleCategoryAttributesOptions {
  language?: string;
  forceRefresh?: boolean;
  syncDictionaryValues?: boolean;
}
