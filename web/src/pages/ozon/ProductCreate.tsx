/**
 * OZON新建商品页面 - 优化版
 * 参照OZON官方界面设计
 */
import {
  PlusOutlined,
  SyncOutlined,
  DeleteOutlined,
  EditOutlined,
  DownOutlined,
  UpOutlined,
  ThunderboltOutlined,
  QuestionCircleOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Cascader,
  Modal,
  App,
  Select,
  Spin,
  List,
  Tag,
  Checkbox,
  Tooltip,
  Row,
  Col,
  Dropdown,
} from 'antd';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import styles from './ProductCreate.module.scss';

import ShopSelector from '@/components/ozon/ShopSelector';
import * as ozonApi from '@/services/ozonApi';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozonApi';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import * as productTitleService from '@/services/ozon/productTitleService';
import * as categoryService from '@/services/ozon/categoryService';
import * as productSubmitService from '@/services/ozon/productSubmitService';
import { VariantImageManagerModal } from '@/components/ozon/VariantImageManagerModal';
import VideoManagerModal from './components/VideoManagerModal';
import { useVideoManager } from '@/hooks/useVideoManager';
import * as draftTemplateApi from '@/services/draftTemplateApi';
import { useFormAutosave } from '@/hooks/useFormAutosave';
import { loggers } from '@/utils/logger';
import * as translationApi from '@/services/translationApi';
import { useVariantManager } from '@/hooks/useVariantManager';
import type { ProductVariant } from '@/hooks/useVariantManager';
import { VariantTable } from './components/VariantTable';
import { AttributeField } from './components/AttributeField';
import { useDraftTemplate } from '@/hooks/useDraftTemplate';
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import type { TaskStatus } from '@/hooks/useAsyncTaskPolling';

// 类目选项接口
interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

// 类型定义已移至 @/hooks/useVariantManager

// 商品表单值接口
interface ProductFormValues {
  offer_id: string;
  title: string;
  description: string;
  barcode?: string;
  price?: number;
  old_price?: number;
  height: number;
  width: number;
  depth: number;
  weight: number;
  vat?: string;
}

const { TextArea } = Input;

const ProductCreate: React.FC = () => {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [pendingCategoryId, setPendingCategoryId] = useState<number | null>(null); // 待恢复的类目ID（用于草稿/模板恢复）
  const [categoryTree, setCategoryTree] = useState<CategoryOption[]>([]);
  const [cascaderKey, setCascaderKey] = useState(0); // 用于强制Cascader重新渲染
  const [categoryPath, setCategoryPath] = useState<number[] | undefined>(undefined); // 类目路径数组（用于Cascader显示）
  const [hasCategoryData, setHasCategoryData] = useState(false);
  const [syncingCategoryAttributes, setSyncingCategoryAttributes] = useState(false);
  const [form] = Form.useForm();
  const [mainProductImages, setMainProductImages] = useState<string[]>([]);
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [editingVariantForVideo, setEditingVariantForVideo] = useState<ProductVariant | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false); // 追踪未保存的更改

  // 主商品视频管理Hook
  const videoManager = useVideoManager({
    initialVideos: [],
    maxVideos: 10,
  });

  // 变体视频管理Hook
  const variantVideoManager = useVideoManager({
    initialVideos: [],
    maxVideos: 10,
  });

  // 使用变体管理 Hook
  const variantManager = useVariantManager();

  // 图片管理弹窗状态
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);

  // 类目属性相关状态
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [optionalFieldsExpanded, setOptionalFieldsExpanded] = useState(false);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [specialFieldDescriptions, setSpecialFieldDescriptions] = useState<Record<string, string>>({});  // 特殊字段说明映射（4180=名称, 4191=简介, 8790=PDF文件）

  // 自动颜色样本状态
  const [autoColorSample, setAutoColorSample] = useState(false);

  // 标题翻译相关状态
  const [titleTranslationCache, setTitleTranslationCache] = useState<string>('');  // 翻译缓存
  const [showingTranslation, setShowingTranslation] = useState(false);  // 是否显示翻译
  const [isTranslating, setIsTranslating] = useState(false);  // 翻译中

  // 字典值缓存（key: dictionary_id, value: 字典值列表）
  const [dictionaryValuesCache, setDictionaryValuesCache] = useState<Record<number, DictionaryValue[]>>({});

  // 查询促销活动列表
  const { data: promotionActions } = useQuery({
    queryKey: ['promotionActions', selectedShop],
    queryFn: () => selectedShop ? ozonApi.getPromotionActions(selectedShop) : Promise.resolve([]),
    enabled: !!selectedShop,
  });

  // 草稿/模板管理（稍后初始化，因为需要 serialize/deserialize 函数）
  // 暂时保留 autosaveEnabled 状态
  const [autosaveEnabled, _setAutosaveEnabled] = useState(true);

  // 商品导入状态轮询
  const { startPolling } = useAsyncTaskPolling({
    getStatus: async (taskId: string): Promise<TaskStatus> => {
      if (!selectedShop) {
        return {
          state: 'FAILURE',
          error: '店铺信息丢失'
        };
      }

      const status = await ozonApi.getProductImportStatus(taskId, selectedShop);

      if (status.status === 'imported') {
        return {
          state: 'SUCCESS',
          result: status,
        };
      } else if (status.status === 'failed') {
        const errorMsg = status.error_messages?.join('; ') || status.message || '未知错误';
        return {
          state: 'FAILURE',
          error: errorMsg,
        };
      } else {
        // processing, pending, unknown
        return {
          state: 'PROGRESS',
          info: {
            status: status.status,
            message: status.message || '处理中...',
          },
        };
      }
    },
    pollingInterval: 3000, // 每3秒轮询一次
    timeout: 5 * 60 * 1000, // 5分钟超时
    notificationKey: 'product-import',
    initialMessage: '商品导入中',
    formatSuccessMessage: (result) => ({
      title: '导入成功',
      description: `商品已成功导入OZON平台！SKU: ${result.sku || 'N/A'}`,
    }),
    onSuccess: () => {
      // 刷新商品列表
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // 跳转到商品列表
      navigate('/dashboard/ozon/products');
    },
  });

  // 创建商品
  const createProductMutation = useMutation({
    mutationFn: async (data: ozonApi.CreateProductRequest) => {
      return await ozonApi.createProduct(data);
    },
    onSuccess: (data) => {
      if (data.success) {
        // 检查是否有 task_id（需要轮询导入状态）
        if (data.data?.task_id) {
          loggers.ozon.info('商品已提交OZON，启动状态轮询', {
            task_id: data.data.task_id,
            offer_id: data.data.offer_id
          });
          // 启动轮询
          startPolling(String(data.data.task_id));
        } else {
          // 没有 task_id，直接显示成功消息并跳转
          notifySuccess('创建成功', '商品创建成功！');
          queryClient.invalidateQueries({ queryKey: ['products'] });
          navigate('/dashboard/ozon/products');
        }
      } else {
        notifyError('创建失败', data.error || '创建失败');
      }
    },
    onError: (error: Error) => {
      notifyError('创建失败', `创建失败: ${error.message}`);
    },
  });

  // 上传图片到Cloudinary
  const uploadImageMutation = useMutation({
    mutationFn: async (data: ozonApi.UploadMediaRequest) => {
      return await ozonApi.uploadMedia(data);
    },
  });

  // 店铺变化时动态加载类目（从 public 目录）
  useEffect(() => {
    const loadTree = async () => {
      if (selectedShop) {
        try {
          const tree = await categoryService.loadCategoryTree();
          setCategoryTree(tree);
          setHasCategoryData(tree.length > 0);
        } catch (error) {
          setCategoryTree([]);
          setHasCategoryData(false);
        }
      } else {
        setCategoryTree([]);
        setHasCategoryData(false);
      }
    };

    loadTree();
  }, [selectedShop]);

  /**
   * 根据类目ID获取完整路径（用于Cascader）
   * 已迁移到 categoryService
   */

  // 监听类目树加载完成，恢复待处理的类目（草稿/模板恢复）
  useEffect(() => {
    if (categoryTree.length > 0 && pendingCategoryId) {
      const foundPath = categoryService.getCategoryPath(pendingCategoryId, categoryTree);

      if (foundPath) {
        // 设置Cascader的值（需要完整路径）
        form.setFieldValue('category_id', foundPath);
        setCategoryPath(foundPath); // 更新状态

        // 强制Cascader重新渲染
        setCascaderKey((prev) => prev + 1);

        // 清除待处理标记（仅成功时清除）
        setPendingCategoryId(null);
      }
    }
  }, [categoryTree, pendingCategoryId, form]);

  // 加载类目属性
  const loadCategoryAttributes = useCallback(async (categoryId: number) => {
    if (!selectedShop) {
      return;
    }

    setLoadingAttributes(true);
    try {
      const result = await categoryService.loadCategoryAttributes({
        shopId: selectedShop,
        categoryId
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
          variantManager.autoAddVariantDimensions(aspectAttributes);
        }
      } else {
        setCategoryAttributes([]);
        setTypeId(null);
      }
    } catch (error) {
      setCategoryAttributes([]);
      setTypeId(null);
    } finally {
      setLoadingAttributes(false);
    }
  }, [selectedShop, variantManager]);

  // 加载字典值（直接调用 OZON 搜索 API）
  const loadDictionaryValues = async (
    categoryId: number,
    attributeId: number,
    query?: string
  ) => {
    if (!selectedShop) {
      return [];
    }

    return categoryService.loadDictionaryValues(
      selectedShop,
      categoryId,
      attributeId,
      query,
      100
    );
  };

  // ========== 标题生成和翻译功能 ==========
  // 已迁移到 productTitleService 和 categoryService

  /**
   * 生成商品标题（根据 OZON 官方命名规范）
   * 格式：类型 + 品牌 + 型号（系列 + 说明）+ 制造商货号 + ，（逗号）+ 属性
   */
  const handleGenerateTitle = () => {
    // 检查是否为 OZON 自动生成标题的类目
    const categoryName = selectedCategory
      ? productTitleService.getCategoryNameById(selectedCategory, categoryTree)
      : null;

    if (categoryName && productTitleService.isAutoTitleCategory(categoryName)) {
      Modal.info({
        title: '提示',
        content: `"${categoryName}"类目的商品标题由 OZON 平台自动生成，无需手动填写。`,
        okText: '知道了',
      });
      return;
    }

    // ============ 主要部分（用空格连接）============
    const mainParts: string[] = [];

    // 1. 类型（使用类目名称）
    if (categoryName) {
      mainParts.push(categoryName.toLowerCase());
    }

    // 2. 品牌（从attributes中查找品牌属性）
    const brandAttr = categoryAttributes.find(attr =>
      attr.name?.toLowerCase().includes('品牌') ||
      attr.name?.toLowerCase().includes('brand') ||
      attr.name?.toLowerCase().includes('бренд')
    );
    if (brandAttr) {
      const brandFieldName = `attr_${brandAttr.attribute_id}`;
      const brandValue = form.getFieldValue(brandFieldName);
      if (brandValue) {
        // 查找字典值的文本
        if (brandAttr.dictionary_id && dictionaryValuesCache[brandAttr.dictionary_id]) {
          const dictValue = dictionaryValuesCache[brandAttr.dictionary_id].find(
            v => v.value_id === brandValue
          );
          if (dictValue) {
            mainParts.push(String(dictValue.value).toLowerCase());
          }
        } else {
          mainParts.push(String(brandValue).toLowerCase());
        }
      }
    }

    // 3. 型号/系列（从attributes中查找型号、系列、模型等属性）
    const modelAttr = categoryAttributes.find(attr =>
      attr.name?.toLowerCase().includes('型号') ||
      attr.name?.toLowerCase().includes('系列') ||
      attr.name?.toLowerCase().includes('模型') ||
      attr.name?.toLowerCase().includes('model') ||
      attr.name?.toLowerCase().includes('модель')
    );
    if (modelAttr) {
      const modelFieldName = `attr_${modelAttr.attribute_id}`;
      const modelValue = form.getFieldValue(modelFieldName);
      if (modelValue) {
        if (modelAttr.dictionary_id && dictionaryValuesCache[modelAttr.dictionary_id]) {
          const dictValue = dictionaryValuesCache[modelAttr.dictionary_id].find(
            v => v.value_id === modelValue
          );
          if (dictValue) {
            mainParts.push(String(dictValue.value).toLowerCase());
          }
        } else {
          mainParts.push(String(modelValue).toLowerCase());
        }
      }
    }

    // 4. 制造商货号（从attributes中查找制造商货号、货号、SKU等属性）
    const skuAttr = categoryAttributes.find(attr =>
      attr.name?.toLowerCase().includes('制造商货号') ||
      attr.name?.toLowerCase().includes('货号') ||
      attr.name?.toLowerCase().includes('sku') ||
      attr.name?.toLowerCase().includes('артикул')
    );
    if (skuAttr) {
      const skuFieldName = `attr_${skuAttr.attribute_id}`;
      const skuValue = form.getFieldValue(skuFieldName);
      if (skuValue) {
        if (skuAttr.dictionary_id && dictionaryValuesCache[skuAttr.dictionary_id]) {
          const dictValue = dictionaryValuesCache[skuAttr.dictionary_id].find(
            v => v.value_id === skuValue
          );
          if (dictValue) {
            mainParts.push(String(dictValue.value).toLowerCase());
          }
        } else {
          mainParts.push(String(skuValue).toLowerCase());
        }
      }
    }

    // ============ 属性部分（用逗号连接）============
    const attrParts: string[] = [];

    // 1. 颜色（从变体维度或属性中查找）
    const colorDim = variantManager.variantDimensions.find(d =>
      d.name?.toLowerCase().includes('颜色') ||
      d.name?.toLowerCase().includes('цвет') ||
      d.name?.toLowerCase().includes('color')
    );
    if (colorDim) {
      // 如果有多个变体，取第一个变体的颜色值
      if (variantManager.variants.length > 0) {
        const firstVariant = variantManager.variants[0];
        const colorValue = firstVariant.dimension_values[colorDim.attribute_id];
        if (colorValue) {
          // 查找字典值的文本
          if (colorDim.dictionary_id && dictionaryValuesCache[colorDim.dictionary_id]) {
            const dictValue = dictionaryValuesCache[colorDim.dictionary_id].find(
              v => v.value_id === colorValue
            );
            if (dictValue) {
              // 颜色用小写，不加"颜色"这个词
              attrParts.push(String(dictValue.value).toLowerCase());
            }
          } else {
            attrParts.push(String(colorValue).toLowerCase());
          }
        }
      }
    } else {
      // 如果没有作为变体维度，从普通属性中查找
      const colorAttr = categoryAttributes.find(attr =>
        attr.name?.toLowerCase().includes('颜色') ||
        attr.name?.toLowerCase().includes('цвет') ||
        attr.name?.toLowerCase().includes('color')
      );
      if (colorAttr) {
        const colorFieldName = `attr_${colorAttr.attribute_id}`;
        const colorValue = form.getFieldValue(colorFieldName);
        if (colorValue) {
          if (colorAttr.dictionary_id && dictionaryValuesCache[colorAttr.dictionary_id]) {
            const dictValue = dictionaryValuesCache[colorAttr.dictionary_id].find(
              v => v.value_id === colorValue
            );
            if (dictValue) {
              attrParts.push(String(dictValue.value).toLowerCase());
            }
          } else {
            attrParts.push(String(colorValue).toLowerCase());
          }
        }
      }
    }

    // 2. 重量（从表单获取）
    const weight = form.getFieldValue('weight');
    if (weight) {
      attrParts.push(`${weight}г`);
    }

    // 3. 体积/包装尺寸（从表单获取）
    const depth = form.getFieldValue('depth');
    const width = form.getFieldValue('width');
    const height = form.getFieldValue('height');
    if (depth && width && height) {
      attrParts.push(`${depth}x${width}x${height}мм`);
    }

    // 4. 包装中的件数（从attributes中查找）
    const quantityAttr = categoryAttributes.find(attr =>
      attr.name?.toLowerCase().includes('包装中的件数') ||
      attr.name?.toLowerCase().includes('件数') ||
      attr.name?.toLowerCase().includes('数量') ||
      attr.name?.toLowerCase().includes('количество в упаковке')
    );
    if (quantityAttr) {
      const quantityFieldName = `attr_${quantityAttr.attribute_id}`;
      const quantityValue = form.getFieldValue(quantityFieldName);
      if (quantityValue) {
        if (quantityAttr.dictionary_id && dictionaryValuesCache[quantityAttr.dictionary_id]) {
          const dictValue = dictionaryValuesCache[quantityAttr.dictionary_id].find(
            v => v.value_id === quantityValue
          );
          if (dictValue) {
            attrParts.push(`${dictValue.value}шт`);
          }
        } else {
          attrParts.push(`${quantityValue}шт`);
        }
      }
    }

    // ============ 组合最终标题 ============
    let generatedTitle = '';

    // 主要部分用空格连接
    if (mainParts.length > 0) {
      generatedTitle = mainParts.join(' ');
    }

    // 如果有属性，用逗号+空格连接
    if (attrParts.length > 0) {
      if (generatedTitle) {
        generatedTitle += ', ' + attrParts.join(', ');
      } else {
        generatedTitle = attrParts.join(', ');
      }
    }

    // 如果生成的标题为空，提示用户
    if (!generatedTitle) {
      notifyWarning(
        '无法生成标题',
        '请先选择类目并填写品牌、型号等关键信息'
      );
      return;
    }

    // 设置生成的标题
    form.setFieldsValue({ title: generatedTitle });

    // 清空翻译缓存
    setTitleTranslationCache('');
    setShowingTranslation(false);

    // 提示用户
    notifySuccess(
      '标题已生成',
      'OZON官方命名规范：类型 + 品牌 + 型号 + 制造商货号 + ，（逗号）+ 属性（颜色、重量、体积等）'
    );
  };

  /**
   * 翻译标题（中文 <-> 俄文）
   */
  const handleTranslateTitle = async () => {
    const currentTitle = form.getFieldValue('title');

    if (!currentTitle?.trim()) {
      notifyWarning('无标题', '请先输入或生成标题');
      return;
    }

    // 如果正在显示翻译，切换回原文
    if (showingTranslation && titleTranslationCache) {
      form.setFieldsValue({ title: titleTranslationCache });
      setShowingTranslation(false);
      return;
    }

    // 如果有缓存且当前显示的是原文，直接使用缓存
    if (titleTranslationCache && !showingTranslation) {
      const originalTitle = currentTitle;
      form.setFieldsValue({ title: titleTranslationCache });
      setTitleTranslationCache(originalTitle);  // 缓存原文
      setShowingTranslation(true);
      return;
    }

    // 执行翻译（使用真实翻译API）
    setIsTranslating(true);
    try {
      // 调用通用翻译API（中文 -> 俄文）
      const translatedText = await translationApi.translateText(currentTitle, 'zh', 'ru');

      setTitleTranslationCache(currentTitle);  // 缓存原文
      form.setFieldsValue({ title: translatedText });
      setShowingTranslation(true);
      notifySuccess('翻译成功', '标题已翻译为俄文');
    } catch (error) {
      const err = error as { message?: string; response?: { data?: { detail?: { detail?: string } } } };
      loggers.product.error('标题翻译失败', { error: err.message });
      notifyError('翻译失败', err.response?.data?.detail?.detail || '翻译服务暂时不可用');
    } finally {
      setIsTranslating(false);
    }
  };

  // ========== 草稿/模板相关函数 ==========

  /**
   * 序列化表单数据
   * 注意：不使用 useCallback 缓存，确保每次都获取最新的表单值
   */
  const serializeFormData = (): draftTemplateApi.FormData => {
    // 使用 true 参数强制获取所有字段值，包括未触碰的字段
    const values = form.getFieldsValue(true);

    // 处理类目ID：Cascader保存的是路径数组，需要提取最后一个ID
    const categoryIdPath = form.getFieldValue('category_id');
    let categoryId: number | undefined;
    if (Array.isArray(categoryIdPath)) {
      // 提取最后一个ID（给后端API）
      categoryId = categoryIdPath[categoryIdPath.length - 1];
    } else if (typeof categoryIdPath === 'number') {
      // 兼容单个ID
      categoryId = categoryIdPath;
    }
    // 如果是字符串（搜索关键词），则忽略，设为 undefined

    // 提取类目属性字段（包括空值）
    const attrFields = Object.keys(values)
      .filter((k) => k.startsWith('attr_'))
      .reduce((acc, k) => ({ ...acc, [k]: values[k] }), {});

    // 统计空值字段
    const emptyAttrFields = Object.keys(attrFields).filter(k =>
      attrFields[k] === undefined || attrFields[k] === null || attrFields[k] === ''
    );

    loggers.ozon.info('[serializeFormData] 序列化表单数据', {
      totalFields: Object.keys(values).length,
      attrFieldsCount: Object.keys(attrFields).length,
      emptyAttrFieldsCount: emptyAttrFields.length,
      attrFieldsSample: Object.keys(attrFields).slice(0, 10),
      valuesSample: Object.keys(attrFields).slice(0, 5).reduce((acc, k) => ({...acc, [k]: attrFields[k]}), {}),
      categoryId,
      shopId: selectedShop
    });

    return {
      shop_id: selectedShop ?? undefined,
      category_id: categoryId ?? undefined,  // 单个ID（后端API需要）
      title: values.title,
      description: values.description,
      offer_id: values.offer_id,
      price: values.price,
      old_price: values.old_price,
      premium_price: values.premium_price,
      width: values.width,
      height: values.height,
      depth: values.depth,
      weight: values.weight,
      dimension_unit: 'mm',
      weight_unit: 'g',
      barcode: values.barcode,
      vat: values.vat,
      attributes: {
        // 保存类目路径数组（用于前端恢复Cascader）
        ...(Array.isArray(categoryIdPath) && { _category_id_path: categoryIdPath }),
        // 保存所有类目属性字段
        ...attrFields,
      },
      images: mainProductImages,
      videos: videoManager.videos,
      images360: values.images360,
      color_image: values.color_image,
      pdf_list: values.pdf_list,
      promotions: values.promotions,
      variantDimensions: variantManager.variantDimensions,
      variants: variantManager.variants,
      hiddenFields: Array.from(variantManager.hiddenFields),
      variantSectionExpanded: variantManager.variantSectionExpanded,
      variantTableCollapsed: variantManager.variantTableCollapsed,
      optionalFieldsExpanded,
      autoColorSample,
    };
  };

  /**
   * 反序列化 FormData 到表单状态
   */
  const deserializeFormData = useCallback((data: draftTemplateApi.FormData) => {
    loggers.ozon.info('[deserializeFormData] 开始反序列化', {
      hasShopId: !!data.shop_id,
      hasCategoryId: !!data.category_id,
      hasAttributes: !!data.attributes,
      attributesCount: data.attributes ? Object.keys(data.attributes).length : 0,
    });

    // 恢复店铺和类目
    if (data.shop_id) setSelectedShop(data.shop_id);
    if (data.category_id) {
      // 优先使用保存的路径数组
      const categoryIdPath = data.attributes?._category_id_path as number[] | undefined;
      const categoryId = data.category_id;

      setSelectedCategory(categoryId);

      // 异步加载类目属性，加载完成后再恢复字段值
      loadCategoryAttributes(categoryId)
        .then(() => {
          loggers.ozon.info('[deserializeFormData] 类目属性加载完成，准备恢复字段值');

          // 延迟恢复，确保字段已渲染（增加延迟到 500ms）
          setTimeout(() => {
            if (data.attributes) {
              // 过滤掉内部字段（_开头的）
              const attrFields = Object.keys(data.attributes)
                .filter((k) => !k.startsWith('_'))
                .reduce((acc, k) => ({ ...acc, [k]: data.attributes![k] }), {});

              loggers.ozon.info('[deserializeFormData] 恢复属性字段', {
                fieldsCount: Object.keys(attrFields).length,
                fieldsSample: Object.keys(attrFields).slice(0, 10),
                valuesSample: Object.keys(attrFields).slice(0, 5).reduce((acc, k) => ({...acc, [k]: attrFields[k]}), {}),
                categoryAttributesCount: categoryAttributes.length
              });

              // 预加载字典类型字段的选项到 cache
              Object.keys(attrFields).forEach((fieldName) => {
                const attrId = parseInt(fieldName.replace('attr_', ''));
                const attr = categoryAttributes.find(a => a.attribute_id === attrId);

                if (attr?.dictionary_id && attr.dictionary_values && attr.dictionary_values.length > 0) {
                  // 将预加载的字典值添加到 cache
                  setDictionaryValuesCache(prev => ({
                    ...prev,
                    [attr.dictionary_id!]: attr.dictionary_values || []
                  }));
                  loggers.ozon.debug(`[deserializeFormData] 预加载字典值: attr_id=${attrId}, count=${attr.dictionary_values.length}`);
                }
              });

              form.setFieldsValue(attrFields);

              // 验证恢复是否成功
              setTimeout(() => {
                const currentValues = form.getFieldsValue(true);
                const restoredAttrFields = Object.keys(currentValues).filter(k => k.startsWith('attr_'));
                loggers.ozon.info('[deserializeFormData] 验证字段恢复', {
                  expectedCount: Object.keys(attrFields).length,
                  actualCount: restoredAttrFields.length,
                  success: restoredAttrFields.length === Object.keys(attrFields).length
                });
              }, 100);
            }
          }, 500);
        })
        .catch((error) => {
          loggers.ozon.error('[deserializeFormData] 类目属性加载失败', error);
        });

      // 恢复类目路径
      if (categoryIdPath && Array.isArray(categoryIdPath)) {
        form.setFieldValue('category_id', categoryIdPath);
        setCategoryPath(categoryIdPath); // 更新状态
        setPendingCategoryId(categoryId);
      } else {
        // 否则设置待恢复的类目ID，等待categoryTree加载完成后转换为路径数组
        setPendingCategoryId(categoryId);
      }
    }

    // 恢复表单字段
    form.setFieldsValue({
      title: data.title,
      description: data.description,
      offer_id: data.offer_id,
      price: data.price,
      old_price: data.old_price,
      premium_price: data.premium_price,
      width: data.width,
      height: data.height,
      depth: data.depth,
      weight: data.weight,
      barcode: data.barcode,
      images360: data.images360,
      color_image: data.color_image,
      pdf_list: data.pdf_list,
      promotions: data.promotions,
      // 类目属性字段延迟恢复（在loadCategoryAttributes完成后）
    });

    // 恢复图片
    if (data.images) setMainProductImages(data.images);

    // 恢复视频
    if (data.videos && data.videos.length > 0) {
      videoManager.clearVideos();
      data.videos.forEach((video) => videoManager.addVideo(video));
    }

    // 恢复变体
    if (data.variantDimensions) {
      variantManager.setVariantDimensions(data.variantDimensions);
    }
    if (data.variants) {
      variantManager.setVariants(data.variants);
    }
    if (data.hiddenFields) variantManager.setHiddenFields(new Set(data.hiddenFields));

    // 恢复 UI 状态
    if (data.variantSectionExpanded !== undefined)
      variantManager.setVariantSectionExpanded(data.variantSectionExpanded);
    if (data.variantTableCollapsed !== undefined)
      variantManager.setVariantTableCollapsed(data.variantTableCollapsed);
    if (data.optionalFieldsExpanded !== undefined)
      setOptionalFieldsExpanded(data.optionalFieldsExpanded);
    if (data.autoColorSample !== undefined)
      setAutoColorSample(data.autoColorSample);
  }, [
    loadCategoryAttributes,
    videoManager.clearVideos,
    videoManager.addVideo,
  ]);

  /**
   * 检测是否从采集记录进入（如果是，则跳过草稿加载提示）
   */
  const isFromCollectionRecord = useMemo(() => {
    const state = location.state as {
      source?: string;
    };
    return state?.source === 'collection_record';
  }, [location.state]);

  /**
   * 草稿模板管理 Hook
   */
  const draftTemplate = useDraftTemplate({
    serializeFormData,
    deserializeFormData,
    selectedShop,
    selectedCategory,
    skipDraftLoading: isFromCollectionRecord,
  });

  /**
   * 从采集记录恢复数据
   * 当从采集记录页面跳转过来时，自动填充表单数据
   */
  useEffect(() => {
    const state = location.state as {
      draftData?: draftTemplateApi.FormData;
      source?: string;
      sourceRecordId?: number;
    };

    if (state?.draftData && state.source === 'collection_record') {
      loggers.ozon.info('[CollectionRecord] 从采集记录恢复数据', {
        sourceRecordId: state.sourceRecordId,
        hasDraftData: !!state.draftData,
      });

      // 使用 deserializeFormData 将采集记录数据填充到表单
      try {
        deserializeFormData(state.draftData);
        notifySuccess('数据已恢复', '已从采集记录恢复商品数据，请检查并完善信息');

        // 清除 location.state，避免刷新页面时重复恢复
        window.history.replaceState({}, document.title);
      } catch (error) {
        loggers.ozon.error('[CollectionRecord] 恢复数据失败', error);
        notifyError('恢复失败', '从采集记录恢复数据失败，请重试');
      }
    }
  }, [location.state, deserializeFormData]);

  /**
   * 检查表单是否有实质性内容（排除初始状态和只有Offer ID的情况）
   */
  const hasSubstantiveContent = (data: draftTemplateApi.FormData): boolean => {
    // 检查关键字段是否有值（排除 offer_id）
    const hasShop = !!data.shop_id;
    const hasCategory = !!data.category_id;
    const hasTitle = !!data.title && data.title.trim().length > 0;
    const hasDescription = !!data.description && data.description.trim().length > 0;
    const hasPrice = !!data.price && data.price > 0;
    const hasOldPrice = !!data.old_price && data.old_price > 0;
    const hasDimensions = (!!data.width && data.width > 0) || (!!data.height && data.height > 0) || (!!data.depth && data.depth > 0);
    const hasWeight = !!data.weight && data.weight > 0;
    const hasBarcode = !!data.barcode && data.barcode.trim().length > 0;
    const hasImages = !!data.images && data.images.length > 0;
    const hasVideos = !!data.videos && data.videos.length > 0;

    // 检查是否有类目属性（attributes对象中除了_category_id_path之外的字段）
    const hasAttributes = !!data.attributes && Object.keys(data.attributes).some(key =>
      key !== '_category_id_path' && data.attributes![key] !== undefined && data.attributes![key] !== null && data.attributes![key] !== ''
    );

    // 检查是否有变体
    const hasVariants = !!data.variants && data.variants.length > 0;

    // 只要有任何一个实质性字段有值，就认为有内容
    return hasShop || hasCategory || hasTitle || hasDescription || hasPrice || hasOldPrice ||
           hasDimensions || hasWeight || hasBarcode || hasImages || hasVideos ||
           hasAttributes || hasVariants;
  };

  /**
   * 自动保存草稿
   *
   * 注意：不使用 useMemo 缓存，确保表单字段（包括 attr_* 类目特征）变化时能立即检测到
   */
  const getFormDataForAutosave = () => {
    try {
      return serializeFormData();
    } catch (error) {
      loggers.ozon.error('序列化表单数据失败', error);
      // 返回空对象，避免阻塞自动保存
      return {} as draftTemplateApi.FormData;
    }
  };

  const { saveNow, checkHasChanges, triggerDebounce, saveStatus, lastSavedAt } = useFormAutosave({
    getFormData: getFormDataForAutosave,  // 传入函数引用，而不是调用结果
    onSave: async (data) => {
      // 检查是否有实质性内容，如果没有则跳过保存
      if (!hasSubstantiveContent(data)) {
        loggers.ozon.info('[saveDraft] 表单为初始状态或只有Offer ID，跳过自动保存');
        return;
      }

      // 添加详细日志，与保存模板的日志格式保持一致
      loggers.ozon.info('[saveDraft] 准备保存草稿', {
        shop_id: data.shop_id,
        category_id: data.category_id,
        hasTitle: !!data.title,
        hasDescription: !!data.description,
        hasPrice: !!data.price,
        hasImages: !!data.images && data.images.length > 0,
        imagesCount: data.images?.length || 0,
        hasVideos: !!data.videos && data.videos.length > 0,
        videosCount: data.videos?.length || 0,
        hasAttributes: !!data.attributes,
        attributesCount: data.attributes ? Object.keys(data.attributes).length : 0,
        attributesSample: data.attributes ? Object.keys(data.attributes).slice(0, 10) : [],
        hasVariants: !!data.variants && data.variants.length > 0,
        variantsCount: data.variants?.length || 0,
        hasVariantDimensions: !!data.variantDimensions && data.variantDimensions.length > 0,
        variantDimensionsCount: data.variantDimensions?.length || 0,
        allFields: Object.keys(data),
      });

      try {
        await draftTemplateApi.saveDraft({
          shop_id: data.shop_id,
          category_id: data.category_id,
          form_data: data,
        });
        loggers.ozon.info('[saveDraft] 草稿自动保存成功');
      } catch (error) {
        loggers.ozon.error('[saveDraft] 草稿自动保存失败', error);
        throw error;
      }
    },
    debounceDelay: 1000,
    autoSaveInterval: 60000,
    enabled: autosaveEnabled && draftTemplate.draftLoaded,
  });

  // 监听自动保存状态，保存成功后清除未保存标志
  useEffect(() => {
    if (saveStatus === 'saved') {
      setHasUnsavedChanges(false);
    }
  }, [saveStatus]);

  /**
   * 手动保存草稿
   */
  const handleManualSaveDraft = async () => {
    try {
      // 实时检查是否有未保存的更改
      if (!checkHasChanges()) {
        notifySuccess('已是最新', '草稿已是最新状态，无需保存');
        return;
      }

      await saveNow();
      setHasUnsavedChanges(false); // 清除未保存标志
      notifySuccess('已保存草稿', '草稿已成功保存');
    } catch {
      notifyError('保存失败', '保存草稿失败，请重试');
    }
  };

  /**
   * 打开"保存为模板"弹窗
   */
  const handleOpenSaveTemplateModal = () => {
    draftTemplate.setTemplateNameInput('');
    draftTemplate.setTemplateTagsInput([]);
    draftTemplate.setSaveTemplateModalVisible(true);
  };

  /**
   * 删除草稿
   */
  const handleDeleteDraft = async () => {
    modal.confirm({
      title: '确认删除',
      content: '确定要删除当前草稿吗？此操作无法撤销。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 获取最新草稿
          const draft = await draftTemplateApi.getLatestDraft();
          if (draft) {
            await draftTemplateApi.deleteDraft(draft.id);
            notifySuccess('已删除', '草稿已成功删除');
            setHasUnsavedChanges(false);
          } else {
            notifyWarning('无草稿', '当前没有可删除的草稿');
          }
        } catch {
          notifyError('删除失败', '删除草稿失败，请重试');
        }
      },
    });
  };

  /**
   * 同步包装尺寸到类目特征
   * 当用户修改包装尺寸（长/宽/高/重量）时，自动填充对应的类目属性
   */
  const syncDimensionsToAttributes = useCallback(
    (changedFields: string[]) => {
      if (categoryAttributes.length === 0) return;

      // 获取当前表单值
      const values = form.getFieldsValue();
      const { width, height, depth, weight } = values;

      // 定义属性名称映射（支持多语言）
      const attributeMapping = {
        weight: ['含包装重量，克', 'Вес товара с упаковкой', 'Weight with packaging', '重量', '含包装重量'],
        width: ['宽度，厘米', 'Ширина, см', 'Width, cm', '宽度'],
        depth: ['深度，厘米', 'Глубина, см', 'Depth, cm', '深度', '长度'],
        height: ['高度，厘米', 'Высота, см', 'Height, cm', '高度'],
        dimensions: ['尺寸，毫米', 'Размеры, мм', 'Dimensions, mm', '尺寸'],
      };

      // 构建待更新的字段
      const fieldsToUpdate: Record<string, number | string | number[] | string[]> = {};

      // 1. 同步重量（克）
      if (changedFields.includes('weight') && weight) {
        const weightAttr = categoryAttributes.find((attr) =>
          attributeMapping.weight.some((name) => attr.name?.includes(name))
        );
        if (weightAttr) {
          const fieldName = `attr_${weightAttr.attribute_id}`;
          fieldsToUpdate[fieldName] = Math.round(weight); // 直接使用克
          loggers.ozon.debug(`[同步尺寸] 重量: ${weight}克 → ${fieldName}`);
        }
      }

      // 2. 同步宽度（毫米 → 厘米）
      if (changedFields.includes('width') && width) {
        const widthAttr = categoryAttributes.find((attr) =>
          attributeMapping.width.some((name) => attr.name?.includes(name))
        );
        if (widthAttr) {
          const fieldName = `attr_${widthAttr.attribute_id}`;
          fieldsToUpdate[fieldName] = Math.round(width / 10); // 毫米转厘米
          loggers.ozon.debug(`[同步尺寸] 宽度: ${width}mm → ${width / 10}cm → ${fieldName}`);
        }
      }

      // 3. 同步深度/长度（毫米 → 厘米）
      if (changedFields.includes('depth') && depth) {
        const depthAttr = categoryAttributes.find((attr) =>
          attributeMapping.depth.some((name) => attr.name?.includes(name))
        );
        if (depthAttr) {
          const fieldName = `attr_${depthAttr.attribute_id}`;
          fieldsToUpdate[fieldName] = Math.round(depth / 10); // 毫米转厘米
          loggers.ozon.debug(`[同步尺寸] 深度: ${depth}mm → ${depth / 10}cm → ${fieldName}`);
        }
      }

      // 4. 同步高度（毫米 → 厘米）
      if (changedFields.includes('height') && height) {
        const heightAttr = categoryAttributes.find((attr) =>
          attributeMapping.height.some((name) => attr.name?.includes(name))
        );
        if (heightAttr) {
          const fieldName = `attr_${heightAttr.attribute_id}`;
          fieldsToUpdate[fieldName] = Math.round(height / 10); // 毫米转厘米
          loggers.ozon.debug(`[同步尺寸] 高度: ${height}mm → ${height / 10}cm → ${fieldName}`);
        }
      }

      // 5. 同步尺寸组合（长x宽x高，毫米）
      if (
        (changedFields.includes('depth') || changedFields.includes('width') || changedFields.includes('height')) &&
        depth &&
        width &&
        height
      ) {
        const dimensionsAttr = categoryAttributes.find((attr) =>
          attributeMapping.dimensions.some((name) => attr.name?.includes(name))
        );
        if (dimensionsAttr) {
          const fieldName = `attr_${dimensionsAttr.attribute_id}`;
          // 注意：这里是字符串格式，用x连接，不是计算
          fieldsToUpdate[fieldName] = `${depth}x${width}x${height}`;
          loggers.ozon.debug(`[同步尺寸] 尺寸: ${depth}x${width}x${height}mm → ${fieldName}`);
        }
      }

      // 批量更新字段
      if (Object.keys(fieldsToUpdate).length > 0) {
        form.setFieldsValue(fieldsToUpdate);
        loggers.ozon.info(`[同步尺寸] 已同步 ${Object.keys(fieldsToUpdate).length} 个类目属性`);
      }
    },
    [categoryAttributes, form]
  );

  // 类目选择变化时加载属性
  useEffect(() => {
    if (selectedCategory && selectedShop) {
      loadCategoryAttributes(selectedCategory);
    } else {
      setCategoryAttributes([]);
    }
  }, [selectedCategory, selectedShop]);

  // 店铺选择后，如果Offer ID为空，则自动生成
  useEffect(() => {
    if (selectedShop && !variantManager.variantSectionExpanded) {
      const currentOfferId = form.getFieldValue('offer_id');
      if (!currentOfferId) {
        handleGenerateOfferId();
      }
    }
  }, [selectedShop, variantManager.variantSectionExpanded, form]);

  // 处理图片上传
  // 同步当前类目特征
  const handleSyncCategoryAttributes = async () => {
    if (!selectedCategory || !selectedShop) {
      notifyError('操作失败', '请先选择店铺和类目');
      return;
    }

    setSyncingCategoryAttributes(true);
    try {
      const result = await ozonApi.syncSingleCategoryAttributes(selectedCategory, selectedShop, {
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
  };

  // 提交商品表单
  const handleProductSubmit = async (values: ProductFormValues) => {
    if (!selectedShop) {
      notifyError('操作失败', '请先选择店铺');
      return;
    }

    try {
      // 获取所有表单字段（包括attr_*）
      const allFormValues = form.getFieldsValue(true);

      // 转换attributes为OZON API格式
      const attributes = categoryAttributes
        .filter(attr => {
          const fieldName = `attr_${attr.attribute_id}`;
          const value = allFormValues[fieldName];
          // 过滤掉未填写的字段（undefined, null, 空字符串, 空数组）
          if (value === undefined || value === null || value === '') return false;
          if (Array.isArray(value) && value.length === 0) return false;
          return true;
        })
        .map(attr => {
          const fieldName = `attr_${attr.attribute_id}`;
          const value = allFormValues[fieldName];

          // 构建OZON API格式的attribute对象
          const attrValue: {
            complex_id: number;
            id: number;
            values: Array<{ dictionary_value_id?: number; value: string }>;
          } = {
            complex_id: 0,
            id: attr.attribute_id,
            values: []
          };

          // 处理字典值类型（下拉选择）
          if (attr.dictionary_id) {
            // 支持多选：值可能是数组（多选）或单个值（单选）
            const values = Array.isArray(value) ? value : [value];
            values.forEach(v => {
              attrValue.values.push({
                dictionary_value_id: Number(v),
                value: String(v)
              });
            });
          } else {
            // 处理普通值（文本、数字、布尔等）
            const values = Array.isArray(value) ? value : [value];
            values.forEach(v => {
              attrValue.values.push({
                value: String(v)
              });
            });
          }

          return attrValue;
        });

      loggers.ozon.info('提交商品，attributes已转换', {
        attributesCount: attributes.length,
        attributes: attributes.slice(0, 3)  // 只打印前3个，避免日志过长
      });

      // 转换variants为OZON API格式
      const formattedVariants = variantManager.variants.length > 0 ? variantManager.variants.map(variant => {
        // 将dimension_values转换为OZON API的attributes格式
        const variantAttributes = Object.entries(variant.dimension_values).map(([attrIdStr, value]) => {
          const attrId = Number(attrIdStr);
          // 从categoryAttributes中查找对应的属性定义
          const attrDef = categoryAttributes.find(a => a.attribute_id === attrId);

          const attr: {
            complex_id: number;
            id: number;
            values: Array<{ dictionary_value_id?: number; value: string }>;
          } = {
            complex_id: 0,
            id: attrId,
            values: []
          };

          if (attrDef?.dictionary_id) {
            // 字典值类型（支持多选）
            const values = Array.isArray(value) ? value : [value];
            values.forEach(v => {
              attr.values.push({
                dictionary_value_id: Number(v),
                value: String(v)
              });
            });
          } else {
            // 普通值（支持多选）
            const values = Array.isArray(value) ? value : [value];
            values.forEach(v => {
              attr.values.push({
                value: String(v)
              });
            });
          }

          return attr;
        });

        return {
          offer_id: variant.offer_id,
          title: variant.title,
          price: variant.price?.toString(),
          old_price: variant.old_price?.toString(),
          barcode: variant.barcode,
          images: variant.images || [],
          videos: variant.videos || [],
          attributes: variantAttributes
        };
      }) : undefined;

      loggers.ozon.info('提交商品，variants已转换', {
        variantsCount: variantManager.variants.length,
        hasVariants: !!formattedVariants
      });

      // 处理展开属性字段
      // images360: 将TextArea中的多行文本转换为数组
      const images360 = allFormValues.images360
        ? String(allFormValues.images360)
            .split('\n')
            .map((url: string) => url.trim())
            .filter((url: string) => url.length > 0)
        : undefined;

      // pdf_list: 将TextArea中的多行文本转换为数组
      const pdfList = allFormValues.pdf_list
        ? String(allFormValues.pdf_list)
            .split('\n')
            .map((url: string) => url.trim())
            .filter((url: string) => url.length > 0)
        : undefined;

      // promotions: 如果是数组则直接使用，否则转换
      const promotions = Array.isArray(allFormValues.promotions)
        ? allFormValues.promotions
        : undefined;

      // 自动颜色样本：如果勾选且有主图，则自动使用第一张主图作为color_image
      const finalColorImage = autoColorSample && mainProductImages.length > 0
        ? mainProductImages[0]
        : (allFormValues.color_image || undefined);

      // 从类目路径中提取 description_category_id（父类目ID）
      // categoryPath 示例：[200001506, 200001034, 971405141]
      // description_category_id = 倒数第二个ID（200001034）
      const descriptionCategoryId = categoryPath && categoryPath.length >= 2
        ? categoryPath[categoryPath.length - 2]
        : undefined;

      loggers.ozon.info('提交商品到OZON', {
        category_id: selectedCategory,
        type_id: typeId,
        description_category_id: descriptionCategoryId,
        categoryPath
      });

      // 创建商品（使用已上传的图片URL和视频）
      await createProductMutation.mutateAsync({
        shop_id: selectedShop,
        offer_id: values.offer_id,
        title: values.title,
        description: values.description,
        barcode: values.barcode,
        price: values.price?.toString(),
        old_price: values.old_price?.toString(),
        category_id: selectedCategory || undefined,
        type_id: typeId || undefined,
        description_category_id: descriptionCategoryId,  // 传递父类目ID
        images: mainProductImages,
        videos: videoManager.videos,
        attributes,  // 添加转换后的attributes
        variants: formattedVariants,  // 添加转换后的variants
        // 展开属性字段
        color_image: finalColorImage,
        premium_price: allFormValues.premium_price?.toString() || undefined,
        images360,
        pdf_list: pdfList,
        promotions,
        height: values.height,
        width: values.width,
        depth: values.depth,
        weight: values.weight,
        dimension_unit: 'mm',
        weight_unit: 'g',
        vat: values.vat || '0',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '操作失败';
      notifyError('操作失败', `操作失败: ${errorMsg}`);
    }
  };


  // 打开图片管理弹窗（变体）
  const handleOpenImageModal = (variant: ProductVariant) => {
    setEditingVariant(variant);
    setImageModalVisible(true);
  };

  // 打开主商品图片管理弹窗
  const handleOpenMainImageModal = () => {
    setEditingVariant(null); // 标识为主商品图片
    setImageModalVisible(true);
  };

  // 保存图片
  const handleSaveImages = (images: string[]) => {
    if (editingVariant) {
      // 保存变体图片
      variantManager.updateVariantRow(editingVariant.id, 'images', images);
    } else {
      // 保存主商品图片
      setMainProductImages(images);
    }
    setImageModalVisible(false);
    setEditingVariant(null);
  };

  // 打开视频管理弹窗（变体）
  const handleOpenVideoModal = (variant: ProductVariant) => {
    setEditingVariantForVideo(variant);
    // 加载变体的视频到 variantVideoManager
    variantVideoManager.resetVideos();
    if (variant.videos) {
      variant.videos.forEach(video => {
        variantVideoManager.addVideo(video);
      });
    }
    setVideoModalVisible(true);
  };

  // 打开主商品视频管理弹窗
  const handleOpenMainVideoModal = () => {
    setEditingVariantForVideo(null); // 标识为主商品视频
    setVideoModalVisible(true);
  };

  // 关闭视频管理弹窗
  const handleCloseVideoModal = () => {
    if (editingVariantForVideo) {
      // 保存变体视频
      variantManager.updateVariantRow(editingVariantForVideo.id, 'videos', variantVideoManager.videos);
    }
    // 主商品视频已经通过 videoManager 自动管理，不需要手动保存
    setVideoModalVisible(false);
    setEditingVariantForVideo(null);
    variantVideoManager.clearVideos();
  };

  // 取消编辑图片
  const handleCancelImageModal = () => {
    setImageModalVisible(false);
    setEditingVariant(null);
  };


  // 生成Offer ID（用于主商品表单）
  const handleGenerateOfferId = () => {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const offerId = `ef_${timestamp}${random}`;
    form.setFieldValue('offer_id', offerId);
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <h2 className={styles.pageTitle}>
          <PlusOutlined />
          新建商品
        </h2>

        {/* 保存状态指示器 */}
        {autosaveEnabled && draftTemplate.draftLoaded && (
          <div className={styles.saveStatusIndicator}>
            {saveStatus === 'saving' && (
              <>
                <Spin size="small" />
                <span className={styles.statusSaving}>保存中...</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <span className={styles.statusSaved}>✓ 已保存</span>
                {lastSavedAt && (
                  <span className={styles.statusTime}>
                    {lastSavedAt.toLocaleTimeString()}
                  </span>
                )}
              </>
            )}
            {saveStatus === 'error' && (
              <span className={styles.statusError}>✗ 保存失败</span>
            )}
            {saveStatus === 'idle' && hasUnsavedChanges && (
              <span className={styles.statusUnsaved}>● 有未保存的更改</span>
            )}
          </div>
        )}
      </div>

      <div className={styles.formCard}>
        <Form
          form={form}
          layout="horizontal"
          onFinish={handleProductSubmit}
          onValuesChange={(changedValues) => {
            // 表单值变化时：1) 设置未保存标志 2) 触发防抖保存
            setHasUnsavedChanges(true);
            triggerDebounce();

            // 3) 检测包装尺寸字段变化，自动同步到类目特征
            const dimensionFields = ['width', 'height', 'depth', 'weight'];
            const changedDimensionFields = Object.keys(changedValues).filter((field) =>
              dimensionFields.includes(field)
            );
            if (changedDimensionFields.length > 0) {
              syncDimensionsToAttributes(changedDimensionFields);
            }
          }}
        >
          {/* 主要信息 */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>主要信息</h3>

            <Form.Item
              label="选择店铺"
              name="shop_id"
              rules={[{ required: true, message: '请选择店铺' }]}
            >
              <ShopSelector
                id="shop_id"
                value={selectedShop}
                onChange={(shopId) => setSelectedShop(shopId as number)}
                showAllOption={false}
                style={{ width: '300px' }}
              />
            </Form.Item>

            <Form.Item
              label="商品类目"
              name="category_id"
              rules={[{ required: true, message: '请选择商品类目' }]}
            >
              <div className={styles.categorySelector}>
                <Cascader
                  key={cascaderKey}  // 用于强制重新渲染
                  id="category_id"
                  className={styles.cascader}
                  value={categoryPath}  // 使用状态变量
                  options={categoryTree}
                  onChange={(value) => {
                    const catId =
                      value && value.length > 0 ? (value[value.length - 1] as number) : null;
                    setSelectedCategory(catId);
                    setCategoryPath(value as number[] | undefined); // 更新状态
                    form.setFieldValue('category_id', value);

                    // 类目变化时，清空类目属性（会由useEffect重新加载）
                    if (!catId) {
                      setCategoryAttributes([]);
                      setTypeId(null);
                    }

                    // 重置标题字段（商品名称）
                    form.setFieldValue('title', '');
                    setTitleTranslationCache('');
                    setShowingTranslation(false);
                  }}
                  placeholder="请选择商品类目"
                  expandTrigger="click"
                  changeOnSelect={false}
                  showSearch={{
                    filter: (inputValue, path) =>
                      path.some((option) =>
                        (option.label as string).toLowerCase().includes(inputValue.toLowerCase())
                      ),
                  }}
                  disabled={!selectedShop || false}
                  loading={false}
                />
                {selectedCategory && (
                  <Button
                    type="default"
                    icon={<SyncOutlined spin={syncingCategoryAttributes} />}
                    onClick={handleSyncCategoryAttributes}
                    loading={syncingCategoryAttributes}
                    disabled={!selectedShop || !selectedCategory}
                    style={{ marginLeft: 8 }}
                    title="同步当前类目的特征数据"
                  >
                    同步特征
                  </Button>
                )}
              </div>
              {!hasCategoryData && selectedShop && (
                <span className={styles.errorText}>数据库无类目数据，请前往"系统配置 - 全局设置"同步类目</span>
              )}
            </Form.Item>

            <Form.Item
              label={
                <span>
                  商品名称
                  <Tooltip title={specialFieldDescriptions['4180'] || "使用俄文，推荐格式: 类目+品牌（如有品牌）+名称+变体属性，标题过长或重复单词可能导致审核失败"}>
                    <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                  </Tooltip>
                </span>
              }
              required
              style={{ marginBottom: 12 }}
            >
              <Space.Compact style={{ width: 'auto' }}>
                <Form.Item
                  name="title"
                  rules={[{ required: true, message: '请输入商品名称' }]}
                  noStyle
                >
                  <Input
                    placeholder="商品标题"
                    maxLength={200}
                    showCount
                    style={{ width: '500px' }}
                  />
                </Form.Item>
                <Button onClick={handleGenerateTitle}>生成</Button>
                <Button
                  icon={<TranslationOutlined />}
                  onClick={handleTranslateTitle}
                  loading={isTranslating}
                >
                  {showingTranslation ? '原文' : '翻译'}
                </Button>
              </Space.Compact>
            </Form.Item>

            {!variantManager.hiddenFields.has('description') && (
              <Form.Item
                label="商品描述"
                tooltip={specialFieldDescriptions['4191'] || "商品的详细描述、营销文本等信息"}
                style={{ marginBottom: 12 }}
              >
                <Space.Compact style={{ width: 'auto', alignItems: 'flex-start' }}>
                  <Form.Item name="description" noStyle>
                    <TextArea
                      rows={4}
                      placeholder="商品详细描述"
                      maxLength={5000}
                      showCount
                      style={{ width: '600px' }}
                    />
                  </Form.Item>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => variantManager.addFieldAsVariant('description', '商品描述', 'String')}
                    title="将当前属性添加变体属性"
                  />
                </Space.Compact>
              </Form.Item>
            )}

            {!variantManager.variantSectionExpanded && (
              <Form.Item label="Offer ID" required style={{ marginBottom: 12 }}>
                <Space.Compact>
                  <Form.Item
                    name="offer_id"
                    rules={[{ required: true, message: '请输入Offer ID' }]}
                    noStyle
                  >
                    <Input placeholder="OZON商品标识符（卖家SKU）" style={{ width: '300px' }} />
                  </Form.Item>
                  <Button
                    type="default"
                    icon={<ThunderboltOutlined />}
                    onClick={handleGenerateOfferId}
                  >
                    生成
                  </Button>
                </Space.Compact>
              </Form.Item>
            )}

            <div className={styles.dimensionGroup}>
              {!variantManager.hiddenFields.has('depth') && (
                <div className={styles.dimensionItem}>
                  <Form.Item label="包装长度（mm）" required style={{ marginBottom: 12 }}>
                    <Space.Compact style={{ width: 'auto' }}>
                      <Form.Item
                        name="depth"
                        rules={[
                          { required: true, message: '请输入包装长度' },
                          { type: 'number', min: 0.01, message: '包装长度必须大于0' },
                        ]}
                        noStyle
                      >
                        <InputNumber min={0.01} placeholder="长" controls={false} />
                      </Form.Item>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => variantManager.addFieldAsVariant('depth', '包装长度', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
              {!variantManager.hiddenFields.has('width') && (
                <div className={styles.dimensionItem}>
                  <Form.Item label="包装宽度（mm）" required style={{ marginBottom: 12 }}>
                    <Space.Compact style={{ width: 'auto' }}>
                      <Form.Item
                        name="width"
                        rules={[
                          { required: true, message: '请输入包装宽度' },
                          { type: 'number', min: 0.01, message: '包装宽度必须大于0' },
                        ]}
                        noStyle
                      >
                        <InputNumber min={0.01} placeholder="宽" controls={false} />
                      </Form.Item>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => variantManager.addFieldAsVariant('width', '包装宽度', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
              {!variantManager.hiddenFields.has('height') && (
                <div className={styles.dimensionItem}>
                  <Form.Item label="包装高度（mm）" required style={{ marginBottom: 12 }}>
                    <Space.Compact style={{ width: 'auto' }}>
                      <Form.Item
                        name="height"
                        rules={[
                          { required: true, message: '请输入包装高度' },
                          { type: 'number', min: 0.01, message: '包装高度必须大于0' },
                        ]}
                        noStyle
                      >
                        <InputNumber min={0.01} placeholder="高" controls={false} />
                      </Form.Item>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => variantManager.addFieldAsVariant('height', '包装高度', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
              {!variantManager.hiddenFields.has('weight') && (
                <div className={styles.dimensionItem}>
                  <Form.Item label="重量（g）" required style={{ marginBottom: 12 }}>
                    <Space.Compact style={{ width: 'auto' }}>
                      <Form.Item
                        name="weight"
                        rules={[
                          { required: true, message: '请输入重量' },
                          { type: 'number', min: 0.01, message: '重量必须大于0' },
                        ]}
                        noStyle
                      >
                        <InputNumber min={0.01} placeholder="重量" controls={false} />
                      </Form.Item>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => variantManager.addFieldAsVariant('weight', '重量', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
            </div>
          </div>

          {/* 类目特征 */}
          {selectedCategory && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>类目特征</h3>

              {loadingAttributes ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <Spin tip="正在加载类目属性..." />
                </div>
              ) : categoryAttributes.length > 0 ? (
                <>
                  {/* 必填属性 */}
                  {categoryAttributes
                    .filter((attr) => attr.is_required)
                    .map((attr) => (
                      <AttributeField
                        key={attr.attribute_id}
                        attr={attr}
                        dictionaryValuesCache={dictionaryValuesCache}
                        loadDictionaryValues={loadDictionaryValues}
                        setDictionaryValuesCache={setDictionaryValuesCache}
                        variantManager={variantManager}
                      />
                    ))}

                  {/* 选填属性（折叠）+ 条形码 + 增值税 + 高级字段 */}
                  {(categoryAttributes.filter((attr) => !attr.is_required).length > 0 || !variantManager.hiddenFields.has('barcode') || !variantManager.hiddenFields.has('vat')) && (
                    <div style={{ marginTop: '16px' }}>
                      <Button
                        type="link"
                        onClick={() => setOptionalFieldsExpanded(!optionalFieldsExpanded)}
                        icon={optionalFieldsExpanded ? <UpOutlined /> : <DownOutlined />}
                        style={{ padding: 0 }}
                      >
                        {optionalFieldsExpanded ? '收起' : '展开'}选填属性 (
                        {categoryAttributes.filter((attr) => !attr.is_required).length + (!variantManager.hiddenFields.has('barcode') ? 1 : 0) + (!variantManager.hiddenFields.has('vat') ? 1 : 0) + (autoColorSample ? 3 : 4) + 1} 个)
                      </Button>

                      <div style={{ marginTop: '12px', display: optionalFieldsExpanded ? 'block' : 'none' }}>
                          {/* 条形码（选填） */}
                          {!variantManager.hiddenFields.has('barcode') && (
                            <Form.Item label="条形码 (Barcode)" style={{ marginBottom: 12 }}>
                              <Space.Compact style={{ width: 'auto' }}>
                                <Form.Item name="barcode" noStyle>
                                  <Input placeholder="商品条形码（FBP模式必填）" style={{ width: '250px' }} />
                                </Form.Item>
                                <Button
                                  icon={<PlusOutlined />}
                                  onClick={() => variantManager.addFieldAsVariant('barcode', '条形码', 'String')}
                                  title="将当前属性添加变体属性"
                                />
                              </Space.Compact>
                            </Form.Item>
                          )}

                          {/* 增值税（选填） */}
                          {!variantManager.hiddenFields.has('vat') && (
                            <Form.Item
                              label="增值税 (VAT)"
                              tooltip="增值税率，0表示免税，0.1表示10%，0.2表示20%"
                              style={{ marginBottom: 12 }}
                              initialValue="0"
                            >
                              <Form.Item name="vat" noStyle initialValue="0">
                                <Input placeholder="0" style={{ width: '250px' }} />
                              </Form.Item>
                            </Form.Item>
                          )}

                          {/* 其他选填属性 */}
                          {categoryAttributes
                            .filter((attr) => !attr.is_required)
                            .map((attr) => (
                              <AttributeField
                                key={attr.attribute_id}
                                attr={attr}
                                dictionaryValuesCache={dictionaryValuesCache}
                                loadDictionaryValues={loadDictionaryValues}
                                setDictionaryValuesCache={setDictionaryValuesCache}
                                variantManager={variantManager}
                              />
                            ))}

                          {/* 高级字段 */}
                          {/* 颜色营销图 - 只在未勾选"自动颜色样本"时显示 */}
                          {!autoColorSample && (
                            <Form.Item
                              label="颜色营销图"
                              name="color_image"
                              tooltip="用于商品列表中展示该SKU的代表颜色，通常为商品颜色特写图"
                              style={{ marginBottom: 12 }}
                            >
                              <Input
                                placeholder="输入颜色营销图URL"
                                style={{ width: '500px' }}
                              />
                            </Form.Item>
                          )}

                          {/* 会员价 */}
                          <Form.Item
                            label="会员价"
                            name="premium_price"
                            tooltip="OZON Premium会员专享价格（可选）"
                            style={{ marginBottom: 12 }}
                          >
                            <InputNumber
                              style={{ minWidth: '300px', maxWidth: '100%' }}
                              min={0}
                              precision={2}
                              placeholder="输入会员价"
                            />
                          </Form.Item>

                          {/* 全景图片 */}
                          <Form.Item
                            label="全景图片"
                            name="images360"
                            tooltip="上传一组连续角度拍摄的图片（建议36-72张），用于商品详情页360度展示"
                            style={{ marginBottom: 12 }}
                          >
                            <Input.TextArea
                              placeholder="每行输入一个图片URL"
                              rows={4}
                              style={{ width: '500px' }}
                            />
                          </Form.Item>

                          {/* PDF文档 */}
                          <Form.Item
                            label="PDF文档"
                            name="pdf_list"
                            tooltip={specialFieldDescriptions['8790'] || "上传商品说明书、认证证书等PDF文档URL（最多5个）"}
                            style={{ marginBottom: 12 }}
                          >
                            <Input.TextArea
                              placeholder="每行输入一个PDF文件URL"
                              rows={3}
                              style={{ width: '500px' }}
                            />
                          </Form.Item>

                          {/* 参与促销 */}
                          <Form.Item
                            label="参与促销"
                            name="promotions"
                            tooltip="选择该商品要参与的促销活动（可多选）"
                            style={{ marginBottom: 12 }}
                          >
                            <Select
                              mode="multiple"
                              placeholder="选择促销活动"
                              style={{ width: '500px' }}
                              popupMatchSelectWidth={false}
                              loading={!promotionActions}
                              options={promotionActions?.map(action => ({
                                label: `${action.title}${action.date_end ? ` (截止: ${action.date_end})` : ''}`,
                                value: action.action_id
                              }))}
                            />
                          </Form.Item>
                        </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                  该类目暂无属性数据
                </div>
              )}
            </div>
          )}

          {/* 价格信息（仅在没有变体时显示整个section） */}
          {variantManager.variants.length === 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>价格信息</h3>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="售价" required style={{ marginBottom: 12 }}>
                    <Form.Item
                      name="price"
                      rules={[{ required: true, message: '请输入售价' }]}
                      noStyle
                    >
                      <InputNumber
                        min={0}
                        placeholder="0"
                        controls={false}
                        formatter={getNumberFormatter(2)}
                        parser={getNumberParser()}
                        style={{ width: '150px' }}
                      />
                    </Form.Item>
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item label="原价（划线价）" style={{ marginBottom: 12 }}>
                    <Form.Item name="old_price" noStyle>
                      <InputNumber
                        min={0}
                        placeholder="0"
                        controls={false}
                        formatter={getNumberFormatter(2)}
                        parser={getNumberParser()}
                        style={{ width: '150px' }}
                      />
                    </Form.Item>
                  </Form.Item>
                </Col>
              </Row>

              {/* 采购信息 */}
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label="建议采购价"
                    name="suggested_purchase_price"
                    tooltip="内部采购参考价格，用于打包发货时查看"
                    style={{ marginBottom: 12 }}
                  >
                    <InputNumber
                      min={0}
                      placeholder="0"
                      controls={false}
                      formatter={getNumberFormatter(2)}
                      parser={getNumberParser()}
                      style={{ width: '150px' }}
                    />
                  </Form.Item>
                </Col>

                <Col span={12}>
                  <Form.Item
                    label="采购地址"
                    name="purchase_url"
                    tooltip="采购链接，在打包发货时可扫码打开"
                    style={{ marginBottom: 12 }}
                  >
                    <Input placeholder="https://..." />
                  </Form.Item>
                </Col>
              </Row>
            </div>
          )}

          {/* 商品媒体（图片+视频，无变体时显示） */}
          {!variantManager.variantSectionExpanded && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>商品媒体</h3>

              <div className={styles.mediaContainer}>
                {/* 商品图片 */}
                <div className={styles.mediaItem}>
                  <div
                    className={styles.mainImagePreviewWrapper}
                    onClick={handleOpenMainImageModal}
                  >
                    {mainProductImages && mainProductImages.length > 0 ? (
                      <div className={styles.mainImagePreview}>
                        <img src={mainProductImages[0]} alt="product" className={styles.mainImage} />
                        <span className={styles.mainImageCount}>{mainProductImages.length}</span>
                      </div>
                    ) : (
                      <div className={styles.mainImagePlaceholder}>
                        <PlusOutlined style={{ fontSize: 24 }} />
                        <div style={{ marginTop: 8 }}>点击添加图片</div>
                        <span className={styles.mainImageCountZero}>0</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 商品视频 */}
                <div className={styles.mediaItem}>
                  <div
                    className={styles.mainImagePreviewWrapper}
                    onClick={handleOpenMainVideoModal}
                  >
                    {videoManager.videos.length > 0 ? (
                      <div className={styles.mainImagePreview}>
                        <div className={styles.videoPreviewIcon}>
                          <PlusOutlined style={{ fontSize: 32 }} />
                          <div style={{ marginTop: 8 }}>视频</div>
                        </div>
                        <span className={styles.mainImageCount}>{videoManager.videos.length}</span>
                        {videoManager.getCoverVideo() && (
                          <Tag color="gold" style={{ position: 'absolute', top: 8, left: 8 }}>
                            封面
                          </Tag>
                        )}
                      </div>
                    ) : (
                      <div className={styles.mainImagePlaceholder}>
                        <PlusOutlined style={{ fontSize: 24 }} />
                        <div style={{ marginTop: 8 }}>点击添加视频</div>
                        <span className={styles.mainImageCountZero}>0</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 变体设置（重新设计） */}
          <div className={styles.section}>
            {!variantManager.variantSectionExpanded ? (
              // 默认折叠状态：只显示"添加变体"按钮
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    variantManager.setVariantSectionExpanded(true);
                    // 首次展开时，如果没有变体，自动创建2个变体行
                    if (variantManager.variants.length === 0) {
                      variantManager.addVariantRow();
                      variantManager.addVariantRow();
                    }
                  }}
                >
                  添加变体
                </Button>
                {variantManager.variantDimensions.length > 0 && (
                  <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                    已选择 {variantManager.variantDimensions.length} 个变体维度：
                    {variantManager.variantDimensions.map((d) => d.name).join('、')}
                  </div>
                )}
              </div>
            ) : (
              // 展开状态：显示变体表格
              <div className={styles.variantSection}>
                <div className={styles.variantHeader}>
                  <div className={styles.variantInfo}>
                    <span>变体管理 (共 {variantManager.variants.length} 个变体)</span>
                    <Tooltip title="勾选后，所有SKU自动将主图作为颜色样本">
                      <Checkbox
                        checked={autoColorSample}
                        onChange={(e) => setAutoColorSample(e.target.checked)}
                        style={{ marginLeft: 16 }}
                      >
                        自动颜色样本
                      </Checkbox>
                    </Tooltip>
                  </div>
                  <div className={styles.variantActions}>
                    <Button icon={<PlusOutlined />} onClick={variantManager.addVariantRow}>
                      添加变体行
                    </Button>
                    <Button
                      icon={variantManager.variantTableCollapsed ? <DownOutlined /> : <UpOutlined />}
                      onClick={() => variantManager.setVariantTableCollapsed(!variantManager.variantTableCollapsed)}
                    >
                      {variantManager.variantTableCollapsed ? '展开' : '折叠'}
                    </Button>
                    <Button
                      danger
                      onClick={() => {
                        variantManager.setVariantSectionExpanded(false);
                        variantManager.setVariants([]);
                        variantManager.setVariantDimensions([]);
                        variantManager.setHiddenFields(new Set());
                        variantManager.setVariantTableCollapsed(false);
                      }}
                    >
                      重置变体
                    </Button>
                  </div>
                </div>

                {!variantManager.variantTableCollapsed && variantManager.variants.length > 0 && (
                  <VariantTable
                    variants={variantManager.variants}
                    variantDimensions={variantManager.variantDimensions}
                    onUpdateVariant={variantManager.updateVariantRow}
                    onDeleteVariant={variantManager.deleteVariantRow}
                    onBatchGenerateOfferId={variantManager.batchGenerateOfferId}
                    onBatchSetPrice={variantManager.batchSetPrice}
                    onBatchSetOldPrice={variantManager.batchSetOldPrice}
                    onRemoveVariantDimension={variantManager.removeVariantDimension}
                    onOpenImageModal={handleOpenImageModal}
                    onOpenVideoModal={handleOpenVideoModal}
                    dictionaryValuesCache={dictionaryValuesCache}
                    loadDictionaryValues={loadDictionaryValues}
                  />
                )}
              </div>
            )}
          </div>

        </Form>
      </div>

      {/* 底部操作栏 */}
      <div className={styles.actionBar}>
        <div className={styles.leftActions}>
          {/* 左侧留空 */}
        </div>
        <div className={styles.rightActions}>
          {hasUnsavedChanges && (
            <span className={styles.unsavedIndicator}>
              有未保存的更改
            </span>
          )}

          {/* 草稿下拉菜单 */}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'save',
                  label: '保存',
                  onClick: handleManualSaveDraft,
                },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onClick: handleDeleteDraft,
                },
              ],
            }}
          >
            <Button size="large">
              草稿 <DownOutlined />
            </Button>
          </Dropdown>

          {/* 模板下拉菜单 */}
          <Dropdown
            menu={{
              items: [
                {
                  key: 'save-template',
                  label: '保存模板',
                  onClick: handleOpenSaveTemplateModal,
                },
                {
                  key: 'apply-template',
                  label: '引用模板',
                  onClick: () => draftTemplate.setTemplateModalVisible(true),
                },
              ],
            }}
          >
            <Button size="large">
              模板 <DownOutlined />
            </Button>
          </Dropdown>

          <Button
            type="primary"
            size="large"
            className={styles.primaryBtn}
            icon={<PlusOutlined />}
            loading={createProductMutation.isPending || uploadImageMutation.isPending}
            onClick={() => form.submit()}
          >
            提交至OZON
          </Button>

          <Button size="large" onClick={() => form.resetFields()}>
            重置
          </Button>
        </div>
      </div>

      {/* 图片管理弹窗 */}
      {selectedShop && imageModalVisible && (
        <VariantImageManagerModal
          visible={imageModalVisible}
          offerId={editingVariant?.offer_id || form.getFieldValue('offer_id') || '主商品'}
          images={editingVariant ? (editingVariant.images || []) : (mainProductImages || [])}
          shopId={selectedShop}
          onOk={handleSaveImages}
          onCancel={handleCancelImageModal}
        />
      )}

      {/* 视频管理弹窗 */}
      <VideoManagerModal
        visible={videoModalVisible}
        videos={editingVariantForVideo ? variantVideoManager.videos : videoManager.videos}
        shopId={selectedShop || undefined}
        offerId={editingVariantForVideo?.offer_id || form.getFieldValue('offer_id') || '主商品'}
        onAddVideo={editingVariantForVideo ? variantVideoManager.addVideo : videoManager.addVideo}
        onDeleteVideo={editingVariantForVideo ? variantVideoManager.removeVideo : videoManager.removeVideo}
        onSetCoverVideo={editingVariantForVideo ? variantVideoManager.setCoverVideo : videoManager.setCoverVideo}
        onClose={handleCloseVideoModal}
        maxVideos={10}
      />

      {/* 保存模板弹窗 */}
      <Modal
        title="保存为模板"
        open={draftTemplate.saveTemplateModalVisible}
        onOk={draftTemplate.handleSaveTemplate}
        onCancel={() => draftTemplate.setSaveTemplateModalVisible(false)}
        confirmLoading={draftTemplate.saveTemplateMutation.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="请输入模板名称"
            value={draftTemplate.templateNameInput}
            onChange={(e) => draftTemplate.setTemplateNameInput(e.target.value)}
            maxLength={200}
            showCount
            onPressEnter={draftTemplate.handleSaveTemplate}
          />
          <Select
            mode="tags"
            style={{ width: '100%' }}
            placeholder="添加标签（可选，最多10个）"
            value={draftTemplate.templateTagsInput}
            onChange={(tags) => draftTemplate.setTemplateTagsInput(tags.slice(0, 10))}
            maxCount={10}
            tokenSeparators={[',']}
          />
        </Space>
      </Modal>

      {/* 引用模板弹窗 */}
      <Modal
        title="选择模板"
        open={draftTemplate.templateModalVisible}
        onCancel={() => {
          draftTemplate.setTemplateModalVisible(false);
          draftTemplate.setTemplateSearchQuery('');
          draftTemplate.setSelectedTagFilter(undefined);
          draftTemplate.setEditingTemplateId(null);
          draftTemplate.setEditingTemplateName('');
        }}
        footer={null}
        width={700}
      >
        {/* 筛选区域 */}
        <Space style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="搜索模板名称..."
            value={draftTemplate.templateSearchQuery}
            onChange={(e) => draftTemplate.setTemplateSearchQuery(e.target.value)}
            allowClear
            style={{ width: '300px' }}
          />
          <Select
            style={{ width: '200px' }}
            placeholder="按标签筛选"
            value={draftTemplate.selectedTagFilter}
            onChange={draftTemplate.setSelectedTagFilter}
            allowClear
            options={draftTemplate.availableTags.map((tag) => ({ label: tag, value: tag }))}
          />
        </Space>

        {draftTemplate.filteredTemplates.length > 0 ? (
          <List
            dataSource={draftTemplate.filteredTemplates}
            renderItem={(template) => (
              <List.Item
                actions={[
                  draftTemplate.editingTemplateId === template.id ? (
                    <Space key="edit" size={4}>
                      <Button
                        type="link"
                        size="small"
                        onClick={draftTemplate.handleSaveEdit}
                        loading={draftTemplate.updateTemplateMutation.isPending}
                        style={{ padding: '0 4px' }}
                      >
                        保存
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          draftTemplate.setEditingTemplateId(null);
                          draftTemplate.setEditingTemplateName('');
                          draftTemplate.setEditingTemplateTags([]);
                        }}
                        style={{ padding: '0 4px' }}
                      >
                        取消
                      </Button>
                    </Space>
                  ) : (
                    <Space key="actions" size={4}>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => draftTemplate.applyTemplateMutation.mutate(template.id)}
                        loading={draftTemplate.applyTemplateMutation.isPending}
                        style={{ padding: '0 4px' }}
                      >
                        应用
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() =>
                          draftTemplate.handleStartEditTemplate(template.id, template.template_name, template.tags)
                        }
                        style={{ padding: '0 4px' }}
                      >
                        编辑
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          draftTemplate.handleDeleteTemplate(template.id, template.template_name)
                        }
                        loading={draftTemplate.deleteTemplateMutation.isPending}
                        style={{ padding: '0 4px' }}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                ]}
              >
                {draftTemplate.editingTemplateId === template.id ? (
                  <List.Item.Meta
                    description={
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Input
                          value={draftTemplate.editingTemplateName}
                          onChange={(e) => draftTemplate.setEditingTemplateName(e.target.value)}
                          onPressEnter={draftTemplate.handleSaveEdit}
                          placeholder="模板名称"
                          autoFocus
                        />
                        <Select
                          mode="tags"
                          style={{ width: '100%' }}
                          placeholder="添加标签（可选，最多10个）"
                          value={draftTemplate.editingTemplateTags}
                          onChange={(tags) => draftTemplate.setEditingTemplateTags(tags.slice(0, 10))}
                          maxCount={10}
                          tokenSeparators={[',']}
                        />
                      </Space>
                    }
                  />
                ) : (
                  <List.Item.Meta
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          title={(() => {
                            const updateDate = new Date(template.updated_at);
                            const updateMonth = updateDate.getMonth() + 1;
                            const updateDay = updateDate.getDate();
                            const updateHours = String(updateDate.getHours()).padStart(2, '0');
                            const updateMinutes = String(updateDate.getMinutes()).padStart(2, '0');
                            const updateTimeStr = `${updateMonth}-${updateDay} ${updateHours}:${updateMinutes}`;

                            const parts = [`更新: ${updateTimeStr}`];
                            if (template.used_count > 0) {
                              parts.push(`次数: ${template.used_count}`);
                            }
                            if (template.last_used_at) {
                              const lastDate = new Date(template.last_used_at);
                              const lastMonth = lastDate.getMonth() + 1;
                              const lastDay = lastDate.getDate();
                              const lastHours = String(lastDate.getHours()).padStart(2, '0');
                              const lastMinutes = String(lastDate.getMinutes()).padStart(2, '0');
                              parts.push(`上次: ${lastMonth}-${lastDay} ${lastHours}:${lastMinutes}`);
                            }
                            return parts.join('\n');
                          })()}
                        >
                          {template.template_name}
                        </span>
                        {template.tags && template.tags.length > 0 && (
                          <span>
                            {template.tags.map((tag) => (
                              <Tag key={tag} color="blue" style={{ marginRight: 4 }}>
                                {tag}
                              </Tag>
                            ))}
                          </span>
                        )}
                      </div>
                    }
                  />
                )}
              </List.Item>
            )}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
            {draftTemplate.templateSearchQuery ? '未找到匹配的模板' : '暂无模板'}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProductCreate;
