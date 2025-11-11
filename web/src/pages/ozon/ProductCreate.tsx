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
  MinusCircleOutlined,
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
  Switch,
  Select,
  Spin,
  List,
  Tag,
  Checkbox,
  Tooltip,
  Row,
  Col,
} from 'antd';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import styles from './ProductCreate.module.scss';

import ShopSelector from '@/components/ozon/ShopSelector';
import * as ozonApi from '@/services/ozonApi';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozonApi';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import { VariantImageManagerModal } from '@/components/ozon/VariantImageManagerModal';
import VideoManagerModal from './components/VideoManagerModal';
import { useVideoManager } from '@/hooks/useVideoManager';
import type { VideoInfo } from '@/services/ozonApi';
import * as draftTemplateApi from '@/services/draftTemplateApi';
import { useFormAutosave } from '@/hooks/useFormAutosave';
import { loggers } from '@/utils/logger';
import { isColorAttribute, getColorValue, getTextColor } from '@/utils/colorMapper';
import * as translationApi from '@/services/translationApi';
import { useVariantManager } from '@/hooks/useVariantManager';
import type { ProductVariant, VariantDimension } from '@/hooks/useVariantManager';
import { VariantTable } from './components/VariantTable';
import { AttributeField } from './components/AttributeField';
import { useDraftTemplate } from '@/hooks/useDraftTemplate';

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

  // 创建商品
  const createProductMutation = useMutation({
    mutationFn: async (data: ozonApi.CreateProductRequest) => {
      return await ozonApi.createProduct(data);
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('创建成功', '商品创建成功！');
        queryClient.invalidateQueries({ queryKey: ['products'] });
        navigate('/dashboard/ozon/listing');
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
    const loadCategoryTree = async () => {
      if (selectedShop) {
        try {
          const timestamp = Date.now();
          const response = await fetch(`/data/categoryTree.json?t=${timestamp}`);
          if (!response.ok) {
            throw new Error('加载类目树失败');
          }
          const json = await response.json();
          setCategoryTree(json.data || []);
          setHasCategoryData(json.data?.length > 0);
        } catch (error) {
          console.error('加载类目树失败:', error);
          notifyError('加载失败', '无法加载类目树数据，请刷新页面重试');
          setCategoryTree([]);
          setHasCategoryData(false);
        }
      } else {
        setCategoryTree([]);
        setHasCategoryData(false);
      }
    };

    loadCategoryTree();
  }, [selectedShop]);

  /**
   * 根据类目ID获取完整路径（用于Cascader）
   */
  const getCategoryPath = (categoryId: number, tree: CategoryOption[], path: number[] = []): number[] | null => {
    for (const node of tree) {
      const currentPath = [...path, node.value];
      if (node.value === categoryId) {
        return currentPath;
      }
      if (node.children) {
        const found = getCategoryPath(categoryId, node.children, currentPath);
        if (found) return found;
      }
    }
    return null;
  };

  // 监听类目树加载完成，恢复待处理的类目（草稿/模板恢复）
  useEffect(() => {
    if (categoryTree.length > 0 && pendingCategoryId) {
      const foundPath = getCategoryPath(pendingCategoryId, categoryTree);

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
      const result = await ozonApi.getCategoryAttributes(selectedShop, categoryId);
      if (result.success && result.data) {
        setCategoryAttributes(result.data);

        // 保存type_id（如果后端返回了的话）
        if (result.type_id !== undefined) {
          setTypeId(result.type_id);
          loggers.ozon.info('类目type_id已获取', { categoryId, type_id: result.type_id });
        }

        // 提取特殊字段的说明（用于更新默认字段的tooltip/help）
        const specialDescriptions: Record<string, string> = {};
        result.data.forEach((attr) => {
          if (attr.attribute_id === 4180 || attr.attribute_id === 4191 || attr.attribute_id === 8790) {
            specialDescriptions[attr.attribute_id.toString()] = attr.description || '';
          }
        });
        setSpecialFieldDescriptions(specialDescriptions);

        // 自动添加 is_aspect=true 的属性到变体维度
        const aspectAttributes = result.data.filter((attr) => attr.is_aspect);
        if (aspectAttributes.length > 0) {
          variantManager.autoAddVariantDimensions(aspectAttributes);
        }
      } else {
        setCategoryAttributes([]);
        setTypeId(null);
        notifyWarning('提示', '该类目暂无属性数据');
      }
    } catch (error) {
      console.error('Failed to load category attributes:', error);
      setCategoryAttributes([]);
      setTypeId(null);
      notifyError('加载失败', '加载类目属性失败');
    } finally {
      setLoadingAttributes(false);
    }
  }, [selectedShop]);

  // 加载字典值
  const loadDictionaryValues = async (dictionaryId: number, query?: string) => {
    if (!selectedShop) {
      return [];
    }

    // 如果是搜索，不使用缓存
    if (query) {
      try {
        const result = await ozonApi.searchDictionaryValues(selectedShop, dictionaryId, query, 100);
        return result.data || [];
      } catch (error) {
        console.error('Failed to search dictionary values:', error);
        return [];
      }
    }

    // 非搜索情况，检查缓存
    if (dictionaryValuesCache[dictionaryId]) {
      return dictionaryValuesCache[dictionaryId];
    }

    // 加载字典值并缓存
    try {
      const result = await ozonApi.searchDictionaryValues(selectedShop, dictionaryId, undefined, 100);
      const values = result.data || [];
      setDictionaryValuesCache((prev) => ({ ...prev, [dictionaryId]: values }));
      return values;
    } catch (error) {
      console.error('Failed to load dictionary values:', error);
      return [];
    }
  };

  // ========== 标题生成和翻译功能 ==========

  /**
   * 从类目树中查找类目名称
   */
  const getCategoryNameById = (categoryId: number, tree: CategoryOption[]): string | null => {
    for (const node of tree) {
      if (node.value === categoryId) {
        return node.label;
      }
      if (node.children) {
        const found = getCategoryNameById(categoryId, node.children);
        if (found) return found;
      }
    }
    return null;
  };

  /**
   * OZON自动生成标题的类目列表（一级类目）
   */
  const OZON_AUTO_TITLE_CATEGORIES = [
    '汽车用品', '医药保健', '家用电器', '电子游戏', '服饰用品和配饰',
    '居家生活', '印刷书籍', '美容与健康', '家具', '音乐',
    '鞋子', '服装', '维修与施工', '运动与休闲', '珠宝饰品', '电子产品'
  ];

  /**
   * 生成商品标题（根据OZON官方建议）
   */
  const handleGenerateTitle = () => {
    // 1. 检查当前标题状态
    const currentTitle = form.getFieldValue('title');

    // 如果标题为空，提示先填写商品名称
    if (!currentTitle || !currentTitle.trim()) {
      notifyWarning('请先填写商品名称', '生成标题需要先填写商品基础名称（连续文字，无空格标点）');
      return;
    }

    // 如果标题包含空格或标点符号（已生成过的格式），提示不能重复生成
    if (/[\s\p{P}]/u.test(currentTitle)) {
      Modal.info({
        title: '提示',
        content: '标题已生成，无需重复生成。如需重新生成，请先清空标题或修改为基础名称。',
        okText: '知道了',
      });
      return;
    }

    // 2. 获取当前选择的类目名称
    const categoryName = selectedCategory ? getCategoryNameById(selectedCategory, categoryTree) : null;

    // 3. 检查是否为OZON自动生成标题的类目
    if (categoryName && OZON_AUTO_TITLE_CATEGORIES.includes(categoryName)) {
      Modal.info({
        title: '提示',
        content: `"${categoryName}"类目的商品标题由OZON平台自动生成，无需手动填写。`,
        okText: '知道了',
      });
      return;
    }

    const parts: string[] = [];

    // 1. 品牌（从attributes中查找品牌属性）
    const brandAttr = categoryAttributes.find(attr =>
      attr.name?.toLowerCase().includes('品牌') ||
      attr.name?.toLowerCase().includes('brand')
    );
    let brandValue = '';
    if (brandAttr) {
      const brandFieldName = `attr_${brandAttr.attribute_id}`;
      brandValue = form.getFieldValue(brandFieldName);
      if (brandValue) {
        parts.push(String(brandValue));
      }
    }

    // 2. 类型（使用类目名称或占位符）
    if (categoryName) {
      parts.push(categoryName);
    } else {
      parts.push('商品类型');
    }

    // 3. 重要特征（根据变体维度）
    if (variantManager.variantDimensions.length > 0) {
      const features = variantManager.variantDimensions.map(d => d.name).join(' ');
      parts.push(features);
    } else {
      parts.push('重要特征');
    }

    // 用空格连接所有部分
    const generatedTitle = parts.filter(p => p).join(' ');
    form.setFieldsValue({ title: generatedTitle });

    // 清空翻译缓存
    setTitleTranslationCache('');
    setShowingTranslation(false);

    // 提示用户参考官方建议
    notifySuccess(
      '标题已生成',
      '请根据OZON官方建议调整标题格式。建议格式：品牌（如有）+ 类型 + 型号/系列（如有）+ 重要特征'
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
    } catch (error: any) {
      loggers.product.error('标题翻译失败', { error: error.message });
      notifyError('翻译失败', error.response?.data?.detail?.detail || '翻译服务暂时不可用');
    } finally {
      setIsTranslating(false);
    }
  };

  // ========== 草稿/模板相关函数 ==========

  /**
   * 序列化当前表单状态为 FormData
   */
  const serializeFormData = useCallback((): draftTemplateApi.FormData => {
    // 使用 true 参数强制获取所有字段值，包括未触碰的字段
    const values = form.getFieldsValue(true);

    // 处理类目ID：Cascader保存的是路径数组，需要提取最后一个ID
    const categoryIdPath = form.getFieldValue('category_id');
    const categoryId = Array.isArray(categoryIdPath)
      ? categoryIdPath[categoryIdPath.length - 1]  // 提取最后一个ID（给后端API）
      : categoryIdPath;  // 兼容单个ID

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
      attributes: {
        // 保存类目路径数组（用于前端恢复Cascader）
        ...(Array.isArray(categoryIdPath) && { _category_id_path: categoryIdPath }),
        // 保存所有类目属性字段
        ...Object.keys(values)
          .filter((k) => k.startsWith('attr_'))
          .reduce((acc, k) => ({ ...acc, [k]: values[k] }), {}),
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
  }, [
    selectedShop,
    selectedCategory,
    mainProductImages,
    videoManager.videos,
    variantManager.variantDimensions,
    variantManager.variants,
    variantManager.hiddenFields,
    variantManager.variantSectionExpanded,
    variantManager.variantTableCollapsed,
    optionalFieldsExpanded,
    autoColorSample,
    // form 是稳定引用，不需要加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  /**
   * 反序列化 FormData 到表单状态
   */
  const deserializeFormData = useCallback((data: draftTemplateApi.FormData) => {
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
          // 延迟恢复，确保字段已渲染
          setTimeout(() => {
            if (data.attributes) {
              // 过滤掉内部字段（_开头的）
              const attrFields = Object.keys(data.attributes)
                .filter((k) => !k.startsWith('_'))
                .reduce((acc, k) => ({ ...acc, [k]: data.attributes![k] }), {});

              form.setFieldsValue(attrFields);
            }
          }, 100);
        })
        .catch((error) => {
          loggers.ozon.error('类目属性加载失败', error);
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
    // form 是稳定引用，不需要加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  /**
   * 草稿模板管理 Hook
   */
  const draftTemplate = useDraftTemplate({
    serializeFormData,
    deserializeFormData,
    selectedShop,
    selectedCategory,
  });

  /**
   * 自动保存草稿
   */
  // 使用 useMemo 缓存 formData，避免每次渲染都创建新对象
  const formDataForAutosave = useMemo(() => {
    try {
      const data = serializeFormData();
      loggers.ozon.debug('序列化表单数据用于自动保存', {
        hasTitle: !!data.title,
        hasCategoryId: !!data.category_id,
        variantCount: variantManager.variants?.length || 0,
      });
      return data;
    } catch (error) {
      loggers.ozon.error('序列化表单数据失败', error);
      // 返回空对象，避免阻塞自动保存
      return {} as draftTemplateApi.FormData;
    }
  }, [
    selectedShop,
    selectedCategory,
    mainProductImages,
    videoManager.videos,
    variantManager.variantDimensions,
    variantManager.variants,
    variantManager.hiddenFields,
    variantManager.variantSectionExpanded,
    variantManager.variantTableCollapsed,
    optionalFieldsExpanded,
    autoColorSample,
    serializeFormData,
  ]);

  const { saveNow, hasUnsavedChanges, saveStatus, lastSavedAt } = useFormAutosave({
    formData: formDataForAutosave,
    onSave: async (data) => {
      loggers.ozon.info('开始自动保存草稿');
      try {
        await draftTemplateApi.saveDraft({
          shop_id: data.shop_id,
          category_id: data.category_id,
          form_data: data,
        });
        loggers.ozon.info('草稿自动保存成功');
      } catch (error) {
        loggers.ozon.error('草稿自动保存失败', error);
        throw error;
      }
    },
    debounceDelay: 1000,
    autoSaveInterval: 60000,
    enabled: autosaveEnabled && draftTemplate.draftLoaded,
  });

  /**
   * 手动保存草稿
   */
  const handleManualSaveDraft = async () => {
    try {
      await saveNow();
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
          // 过滤掉未填写的字段（undefined, null, 空字符串）
          return value !== undefined && value !== null && value !== '';
        })
        .map(attr => {
          const fieldName = `attr_${attr.attribute_id}`;
          const value = allFormValues[fieldName];

          // 构建OZON API格式的attribute对象
          const attrValue: any = {
            complex_id: 0,
            id: attr.attribute_id,
            values: []
          };

          // 处理字典值类型（下拉选择）
          if (attr.dictionary_id) {
            attrValue.values.push({
              dictionary_value_id: Number(value),
              value: String(value)
            });
          } else {
            // 处理普通值（文本、数字、布尔等）
            attrValue.values.push({
              value: String(value)
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

          const attr: any = {
            complex_id: 0,
            id: attrId,
            values: []
          };

          if (attrDef?.dictionary_id) {
            // 字典值类型
            attr.values.push({
              dictionary_value_id: Number(value),
              value: String(value)
            });
          } else {
            // 普通值
            attr.values.push({
              value: String(value)
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
        type_id: typeId || undefined,  // 添加type_id
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

                    // 类目变化时，加载类目属性
                    if (catId) {
                      loadCategoryAttributes(catId);
                    } else {
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

                      {optionalFieldsExpanded && (
                        <div style={{ marginTop: '12px' }}>
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
                                style={{ minWidth: '300px', maxWidth: '100%' }}
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
                              style={{ minWidth: '300px', maxWidth: '100%' }}
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
                              style={{ minWidth: '300px', maxWidth: '100%' }}
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
                              style={{ minWidth: '300px', maxWidth: '100%' }}
                              popupMatchSelectWidth={false}
                              loading={!promotionActions}
                              options={promotionActions?.map(action => ({
                                label: `${action.title}${action.date_end ? ` (截止: ${action.date_end})` : ''}`,
                                value: action.action_id
                              }))}
                            />
                          </Form.Item>
                        </div>
                      )}
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
                      重置
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
          <Button onClick={() => form.resetFields()}>重置</Button>
          <Button onClick={() => draftTemplate.setTemplateModalVisible(true)}>引用模板</Button>
        </div>
        <div className={styles.rightActions}>
          {hasUnsavedChanges && (
            <span className={styles.unsavedIndicator}>
              有未保存的更改
            </span>
          )}
          <Button size="large" onClick={handleManualSaveDraft}>
            保存草稿
          </Button>
          <Button size="large" onClick={handleOpenSaveTemplateModal}>
            保存为模板
          </Button>
          <Button
            type="primary"
            size="large"
            className={styles.primaryBtn}
            icon={<PlusOutlined />}
            loading={createProductMutation.isPending || uploadImageMutation.isPending}
            onClick={() => form.submit()}
          >
            上架至 OZON
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
