/**
 * OZON新建商品页面 - 优化版
 * 参照OZON官方界面设计
 */
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  Form,
  Input,
  Button,
  Space,
  Modal,
  App,
  Select,
  Spin,
  List,
  Tag,
  Checkbox,
  Tooltip,
} from 'antd';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import styles from './ProductCreate.module.scss';

import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import * as categoryService from '@/services/ozon/categoryService';
import * as productSubmitService from '@/services/ozon/productSubmitService';
import { VariantImageManagerModal } from '@/components/ozon/VariantImageManagerModal';
import VideoManagerModal from './components/VideoManagerModal';
import { useVideoManager } from '@/hooks/useVideoManager';
import * as draftTemplateApi from '@/services/draftTemplateApi';
import { useFormAutosave } from '@/hooks/useFormAutosave';
import { loggers } from '@/utils/logger';
import { useVariantManager } from '@/hooks/useVariantManager';
import type { ProductVariant, VariantDimension } from '@/hooks/useVariantManager';
import type { VideoInfo } from '@/services/ozon/types/listing';
import { VariantTable } from './components/VariantTable';
import { useDraftTemplate } from '@/hooks/useDraftTemplate';
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import type { TaskStatus } from '@/hooks/useAsyncTaskPolling';
import { useCategoryManager } from '@/hooks/useCategoryManager';
import { useTitleTranslation } from '@/hooks/useTitleTranslation';
import { useDictionaryCache } from '@/hooks/useDictionaryCache';
import { BasicInfoSection } from './components/BasicInfoSection';
import { CategoryAttributesSection } from './components/CategoryAttributesSection';
import { PriceInfoSection } from './components/PriceInfoSection';
import { MediaSection } from './components/MediaSection';
import { ProductFormFooter } from './components/ProductFormFooter';

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

const ProductCreate: React.FC = () => {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [mainProductImages, setMainProductImages] = useState<string[]>([]);
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [editingVariantForVideo, setEditingVariantForVideo] = useState<ProductVariant | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false); // 追踪未保存的更改
  const [optionalFieldsExpanded, setOptionalFieldsExpanded] = useState(false);
  const [autoColorSample, setAutoColorSample] = useState(false);
  const [specialFieldDescriptions, setSpecialFieldDescriptions] = useState<Record<string, string>>({});  // 特殊字段说明映射（4180=名称, 4191=简介, 8790=PDF文件）

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

  // 使用类目管理 Hook
  const categoryManager = useCategoryManager({
    selectedShop,
    autoAddVariantDimensions: variantManager.autoAddVariantDimensions,
    setSpecialFieldDescriptions,
  });

  // 使用字典缓存 Hook
  const dictionaryCache = useDictionaryCache({
    selectedShop,
  });

  // 使用标题翻译 Hook
  const titleTranslation = useTitleTranslation({
    form,
    selectedCategory: categoryManager.selectedCategory,
    categoryTree: categoryManager.categoryTree,
    categoryAttributes: categoryManager.categoryAttributes,
    dictionaryValuesCache: dictionaryCache.dictionaryValuesCache,
    variantDimensions: variantManager.variantDimensions,
    variants: variantManager.variants,
  });

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
    formatSuccessMessage: (result) => {
      const r = result as { sku?: string } | undefined;
      return {
        title: '导入成功',
        description: `商品已成功导入OZON平台！SKU: ${r?.sku || 'N/A'}`,
      };
    },
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
          categoryManager.setCategoryTree(tree);
          categoryManager.setHasCategoryData(tree.length > 0);
        } catch {
          categoryManager.setCategoryTree([]);
          categoryManager.setHasCategoryData(false);
        }
      } else {
        categoryManager.setCategoryTree([]);
        categoryManager.setHasCategoryData(false);
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
    if (categoryManager.categoryTree.length > 0 && categoryManager.pendingCategoryId) {
      const foundPath = categoryService.getCategoryPath(categoryManager.pendingCategoryId, categoryManager.categoryTree);

      if (foundPath) {
        // 设置Cascader的值（需要完整路径）
        form.setFieldValue('category_id', foundPath);
        categoryManager.setCategoryPath(foundPath); // 更新状态

        // 强制Cascader重新渲染
        categoryManager.setCascaderKey(categoryManager.cascaderKey + 1);

        // 清除待处理标记（仅成功时清除）
        categoryManager.setPendingCategoryId(null);
      }
    }
  }, [categoryManager.categoryTree, categoryManager.pendingCategoryId, form]);

  // 加载类目属性

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

      categoryManager.setSelectedCategory(categoryId);

      // 异步加载类目属性，加载完成后再恢复字段值
      categoryManager.loadCategoryAttributes(categoryId)
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
                categoryAttributesCount: categoryManager.categoryAttributes.length
              });

              // 预加载字典类型字段的选项到 cache
              Object.keys(attrFields).forEach((fieldName) => {
                const attrId = parseInt(fieldName.replace('attr_', ''));
                const attr = categoryManager.categoryAttributes.find(a => a.attribute_id === attrId);

                if (attr?.dictionary_id && attr.dictionary_values && attr.dictionary_values.length > 0) {
                  // 将预加载的字典值添加到 cache
                  dictionaryCache.setDictionaryValuesCache(prev => ({
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
        categoryManager.setCategoryPath(categoryIdPath); // 更新状态
        categoryManager.setPendingCategoryId(categoryId);
      } else {
        // 否则设置待恢复的类目ID，等待categoryTree加载完成后转换为路径数组
        categoryManager.setPendingCategoryId(categoryId);
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
      data.videos.forEach((video) => videoManager.addVideo(video as VideoInfo));
    }

    // 恢复变体
    if (data.variantDimensions) {
      variantManager.setVariantDimensions(data.variantDimensions as VariantDimension[]);
    }
    if (data.variants) {
      variantManager.setVariants(data.variants as ProductVariant[]);
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
    categoryManager.loadCategoryAttributes,
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
    selectedCategory: categoryManager.selectedCategory,
    skipDraftLoading: isFromCollectionRecord,
  });

  /**
   * 从采集记录恢复数据
   * 当从采集记录页面跳转过来时，自动填充表单数据
   */
  const collectionRecordRestoredRef = useRef(false);
  useEffect(() => {
    // 防止重复执行（React Strict Mode 或依赖变化）
    if (collectionRecordRestoredRef.current) {
      return;
    }

    const state = location.state as {
      draftData?: draftTemplateApi.FormData;
      source?: string;
      sourceRecordId?: number;
    };

    if (state?.draftData && state.source === 'collection_record') {
      collectionRecordRestoredRef.current = true;

      loggers.ozon.info('[CollectionRecord] 从采集记录恢复数据', {
        sourceRecordId: state.sourceRecordId,
        hasDraftData: !!state.draftData,
        hasVariants: !!state.draftData.variants,
        variantsCount: state.draftData.variants?.length || 0,
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
    // 从采集记录进入时禁用自动保存，避免覆盖用户之前的草稿
    enabled: autosaveEnabled && draftTemplate.draftLoaded && !isFromCollectionRecord,
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
   * 已迁移到 productSubmitService
   */
  const syncDimensionsToAttributes = useCallback(
    (changedFields: string[]) => {
      productSubmitService.syncDimensionsToAttributes({
        form,
        categoryAttributes: categoryManager.categoryAttributes,
        changedFields
      });
    },
    [categoryManager.categoryAttributes, form]
  );


  // 店铺选择后，如果Offer ID为空，则自动生成
  useEffect(() => {
    if (selectedShop && !variantManager.variantSectionExpanded) {
      const currentOfferId = form.getFieldValue('offer_id');
      if (!currentOfferId) {
        handleGenerateOfferId();
      }
    }
  }, [selectedShop, variantManager.variantSectionExpanded, form]);


  // 提交商品表单
  const handleProductSubmit = async (values: ProductFormValues) => {
    if (!selectedShop) {
      notifyError('操作失败', '请先选择店铺');
      return;
    }

    try {
      // 获取所有表单字段（包括 attr_*）
      const allFormValues = form.getFieldsValue(true);

      // 转换 attributes 为 OZON API 格式
      const attributes = productSubmitService.formatAttributesForAPI(form, categoryManager.categoryAttributes);

      loggers.ozon.info('提交商品，attributes 已转换', {
        attributesCount: attributes.length,
        attributes: attributes.slice(0, 3)  // 只打印前 3 个，避免日志过长
      });

      // 转换 variants 为 OZON API 格式
      const formattedVariants = productSubmitService.formatVariantsForAPI(
        variantManager.variants,
        categoryManager.categoryAttributes
      );

      loggers.ozon.info('提交商品，variants 已转换', {
        variantsCount: variantManager.variants.length,
        hasVariants: !!formattedVariants
      });

      // 处理展开属性字段
      const images360 = productSubmitService.parseTextAreaToArray(allFormValues.images360);
      const pdfList = productSubmitService.parseTextAreaToArray(allFormValues.pdf_list);
      const promotions = Array.isArray(allFormValues.promotions)
        ? allFormValues.promotions
        : undefined;

      // 自动颜色样本：如果勾选且有主图，则自动使用第一张主图作为 color_image
      const finalColorImage = autoColorSample && mainProductImages.length > 0
        ? mainProductImages[0]
        : (allFormValues.color_image || undefined);

      // 从类目路径中提取 description_category_id（父类目 ID）
      const descriptionCategoryId = productSubmitService.getDescriptionCategoryId(categoryManager.categoryPath);

      loggers.ozon.info('提交商品到 OZON', {
        category_id: categoryManager.selectedCategory,
        type_id: categoryManager.typeId,
        description_category_id: descriptionCategoryId,
        categoryPath: categoryManager.categoryPath
      });

      // 创建商品（使用已上传的图片 URL 和视频）
      await createProductMutation.mutateAsync({
        shop_id: selectedShop,
        offer_id: values.offer_id,
        title: values.title,
        description: values.description,
        barcode: values.barcode,
        price: values.price?.toString(),
        old_price: values.old_price?.toString(),
        category_id: categoryManager.selectedCategory || undefined,
        type_id: categoryManager.typeId || undefined,
        description_category_id: descriptionCategoryId,
        images: mainProductImages,
        videos: videoManager.videos,
        attributes,
        variants: formattedVariants,
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

        {/* 保存状态指示器（从采集记录进入时不显示） */}
        {autosaveEnabled && draftTemplate.draftLoaded && !isFromCollectionRecord && (
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
          <BasicInfoSection
            form={form}
            selectedShop={selectedShop}
            setSelectedShop={setSelectedShop}
            categoryTree={categoryManager.categoryTree}
            cascaderKey={categoryManager.cascaderKey}
            categoryPath={categoryManager.categoryPath}
            selectedCategory={categoryManager.selectedCategory}
            setSelectedCategory={categoryManager.setSelectedCategory}
            setCategoryPath={categoryManager.setCategoryPath}
            setCategoryAttributes={categoryManager.setCategoryAttributes}
            setTypeId={categoryManager.setTypeId}
            setTitleTranslationCache={titleTranslation.setTitleTranslationCache}
            setShowingTranslation={titleTranslation.setShowingTranslation}
            syncingCategoryAttributes={categoryManager.syncingCategoryAttributes}
            handleSyncCategoryAttributes={categoryManager.handleSyncCategoryAttributes}
            hasCategoryData={categoryManager.hasCategoryData}
            specialFieldDescriptions={specialFieldDescriptions}
            handleGenerateTitle={titleTranslation.handleGenerateTitle}
            handleTranslateTitle={titleTranslation.handleTranslateTitle}
            isTranslating={titleTranslation.isTranslating}
            showingTranslation={titleTranslation.showingTranslation}
            variantManager={variantManager}
            handleGenerateOfferId={handleGenerateOfferId}
          />

          {/* 类目特征 */}
          <CategoryAttributesSection
            selectedCategory={categoryManager.selectedCategory}
            loadingAttributes={categoryManager.loadingAttributes}
            categoryAttributes={categoryManager.categoryAttributes}
            dictionaryValuesCache={dictionaryCache.dictionaryValuesCache}
            loadDictionaryValues={dictionaryCache.loadDictionaryValues}
            setDictionaryValuesCache={dictionaryCache.setDictionaryValuesCache}
            variantManager={variantManager}
            optionalFieldsExpanded={optionalFieldsExpanded}
            setOptionalFieldsExpanded={setOptionalFieldsExpanded}
            autoColorSample={autoColorSample}
            specialFieldDescriptions={specialFieldDescriptions}
            promotionActions={promotionActions}
          />

          {/* 价格信息（仅在没有变体时显示整个section） */}
          <PriceInfoSection showSection={variantManager.variants.length === 0} />

          {/* 商品媒体（图片+视频，无变体时显示） */}
          <MediaSection
            showSection={!variantManager.variantSectionExpanded}
            mainProductImages={mainProductImages}
            videoCount={videoManager.videos.length}
            hasCoverVideo={!!videoManager.getCoverVideo()}
            handleOpenMainImageModal={handleOpenMainImageModal}
            handleOpenMainVideoModal={handleOpenMainVideoModal}
          />

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
                    dictionaryValuesCache={dictionaryCache.dictionaryValuesCache}
                    loadDictionaryValues={dictionaryCache.loadDictionaryValues}
                  />
                )}
              </div>
            )}
          </div>

        </Form>
      </div>

      {/* 底部操作栏 */}
      <ProductFormFooter
        hasUnsavedChanges={hasUnsavedChanges}
        createProductLoading={createProductMutation.isPending}
        uploadImageLoading={uploadImageMutation.isPending}
        handleManualSaveDraft={handleManualSaveDraft}
        handleDeleteDraft={handleDeleteDraft}
        handleOpenSaveTemplateModal={handleOpenSaveTemplateModal}
        handleOpenTemplateModal={() => draftTemplate.setTemplateModalVisible(true)}
        handleSubmit={() => form.submit()}
        handleReset={() => form.resetFields()}
      />

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
