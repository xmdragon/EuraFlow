/**
 * OZON新建商品页面 - 优化版
 * 参照OZON官方界面设计
 */
import {
  PlusOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  DownOutlined,
  UpOutlined,
  ThunderboltOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import md5 from 'md5';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Upload,
  Cascader,
  Modal,
  App,
  Table,
  Collapse,
  Switch,
  Select,
  Spin,
  List,
  Tag,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import styles from './ProductCreate.module.scss';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import * as ozonApi from '@/services/ozonApi';
import type { CategoryAttribute } from '@/services/ozonApi';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import { VariantImageManagerModal } from '@/components/ozon/VariantImageManagerModal';
import * as draftTemplateApi from '@/services/draftTemplateApi';
import { useFormAutosave } from '@/hooks/useFormAutosave';
import { loggers } from '@/utils/logger';

// 类目选项接口
interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

// 变体维度（用户选择的属性作为变体维度）
interface VariantDimension {
  attribute_id: number;
  name: string;
  attribute_type: string;
  dictionary_id?: number;
  // 原始字段key（用于恢复显示）
  original_field_key?: string;
}

// 变体接口（重新设计）
interface ProductVariant {
  id: string;
  // 维度值：attribute_id -> value
  dimension_values: Record<number, any>;
  offer_id: string;
  title?: string;  // 标题（变体可以有不同的标题）
  images?: string[];  // 图片数组（支持多图）
  video?: string;  // 视频
  price?: number;
  old_price?: number;
  barcode?: string;
}

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
}

const { TextArea } = Input;

const ProductCreate: React.FC = () => {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [categoryTree, setCategoryTree] = useState<CategoryOption[]>([]);
  const [hasCategoryData, setHasCategoryData] = useState(false);
  const [syncingCategoryAttributes, setSyncingCategoryAttributes] = useState(false);
  const [form] = Form.useForm();
  const [mainProductImages, setMainProductImages] = useState<string[]>([]);

  // 变体相关状态（重新设计）
  const [variantDimensions, setVariantDimensions] = useState<VariantDimension[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantSectionExpanded, setVariantSectionExpanded] = useState(false);
  const [variantTableCollapsed, setVariantTableCollapsed] = useState(false); // 表格折叠状态
  // 隐藏的字段（已添加为变体维度的字段）
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());
  // 图片管理弹窗状态
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  // 变体行选中状态
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);

  // 类目属性相关状态
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [optionalFieldsExpanded, setOptionalFieldsExpanded] = useState(false);

  // 字典值缓存（key: dictionary_id, value: 字典值列表）
  const [dictionaryValuesCache, setDictionaryValuesCache] = useState<Record<number, any[]>>({});

  // 草稿/模板相关状态
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [saveTemplateModalVisible, setSaveTemplateModalVisible] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [templateTagsInput, setTemplateTagsInput] = useState<string[]>([]);
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | undefined>(undefined);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');

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

  // 加载类目属性
  const loadCategoryAttributes = async (categoryId: number) => {
    if (!selectedShop) {
      return;
    }

    setLoadingAttributes(true);
    try {
      const result = await ozonApi.getCategoryAttributes(selectedShop, categoryId);
      if (result.success && result.data) {
        setCategoryAttributes(result.data);
      } else {
        setCategoryAttributes([]);
        notifyWarning('提示', '该类目暂无属性数据');
      }
    } catch (error) {
      console.error('Failed to load category attributes:', error);
      setCategoryAttributes([]);
      notifyError('加载失败', '加载类目属性失败');
    } finally {
      setLoadingAttributes(false);
    }
  };

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

  // ========== 草稿/模板相关函数 ==========

  /**
   * 序列化当前表单状态为 FormData
   */
  const serializeFormData = useCallback((): draftTemplateApi.FormData => {
    const values = form.getFieldsValue();

    return {
      shop_id: selectedShop ?? undefined,
      category_id: selectedCategory ?? undefined,
      title: values.title,
      description: values.description,
      offer_id: values.offer_id,
      price: values.price,
      old_price: values.old_price,
      width: values.width,
      height: values.height,
      depth: values.depth,
      weight: values.weight,
      dimension_unit: 'mm',
      weight_unit: 'g',
      barcode: values.barcode,
      attributes: Object.keys(values)
        .filter((k) => k.startsWith('attr_'))
        .reduce((acc, k) => ({ ...acc, [k]: values[k] }), {}),
      images: mainProductImages,
      variantDimensions,
      variants,
      hiddenFields: Array.from(hiddenFields),
      variantSectionExpanded,
      variantTableCollapsed,
      optionalFieldsExpanded,
    };
  }, [
    form,
    selectedShop,
    selectedCategory,
    mainProductImages,
    variantDimensions,
    variants,
    hiddenFields,
    variantSectionExpanded,
    variantTableCollapsed,
    optionalFieldsExpanded,
  ]);

  /**
   * 反序列化 FormData 到表单状态
   */
  const deserializeFormData = useCallback((data: draftTemplateApi.FormData) => {
    // 恢复店铺和类目
    if (data.shop_id) setSelectedShop(data.shop_id);
    if (data.category_id) setSelectedCategory(data.category_id);

    // 恢复表单字段
    form.setFieldsValue({
      title: data.title,
      description: data.description,
      offer_id: data.offer_id,
      price: data.price,
      old_price: data.old_price,
      width: data.width,
      height: data.height,
      depth: data.depth,
      weight: data.weight,
      barcode: data.barcode,
      ...data.attributes,
    });

    // 恢复图片
    if (data.images) setMainProductImages(data.images);

    // 恢复变体
    if (data.variantDimensions) setVariantDimensions(data.variantDimensions);
    if (data.variants) setVariants(data.variants);
    if (data.hiddenFields) setHiddenFields(new Set(data.hiddenFields));

    // 恢复 UI 状态
    if (data.variantSectionExpanded !== undefined)
      setVariantSectionExpanded(data.variantSectionExpanded);
    if (data.variantTableCollapsed !== undefined)
      setVariantTableCollapsed(data.variantTableCollapsed);
    if (data.optionalFieldsExpanded !== undefined)
      setOptionalFieldsExpanded(data.optionalFieldsExpanded);
  }, [form]);

  /**
   * 加载最新草稿（页面初始化时）
   */
  useQuery({
    queryKey: ['latest-draft'],
    queryFn: draftTemplateApi.getLatestDraft,
    enabled: !draftLoaded,
    onSuccess: (draft) => {
      if (draft) {
        Modal.confirm({
          title: '发现未保存的草稿',
          content: `上次编辑时间：${new Date(draft.updated_at).toLocaleString()}。是否恢复？`,
          onOk: () => {
            deserializeFormData(draft.form_data);
            notifySuccess('已恢复草稿', '草稿已成功恢复');
            loggers.product.info('已恢复草稿', { draft_id: draft.id });
          },
          onCancel: () => {
            loggers.product.info('用户拒绝恢复草稿');
          },
        });
      }
      setDraftLoaded(true);
    },
    onError: (error: Error) => {
      loggers.product.error('加载草稿失败', error);
      setDraftLoaded(true);
    },
  });

  /**
   * 自动保存草稿
   */
  const { saveNow, hasUnsavedChanges, saveStatus, lastSavedAt } = useFormAutosave({
    formData: serializeFormData(),
    onSave: async (data) => {
      await draftTemplateApi.saveDraft({
        shop_id: data.shop_id,
        category_id: data.category_id,
        form_data: data,
      });
    },
    debounceDelay: 1000,
    autoSaveInterval: 60000,
    enabled: autosaveEnabled && draftLoaded,
  });

  /**
   * 手动保存草稿
   */
  const handleManualSaveDraft = async () => {
    try {
      await saveNow();
      notifySuccess('已保存草稿', '草稿已成功保存');
    } catch (error) {
      notifyError('保存失败', '保存草稿失败，请重试');
    }
  };

  /**
   * 打开"保存为模板"弹窗
   */
  const handleOpenSaveTemplateModal = () => {
    setTemplateNameInput('');
    setTemplateTagsInput([]);
    setSaveTemplateModalVisible(true);
  };

  /**
   * 保存为模板
   */
  const saveTemplateMutation = useMutation({
    mutationFn: async (params: { name: string; tags: string[] }) => {
      const formData = serializeFormData();
      return await draftTemplateApi.createTemplate({
        template_name: params.name,
        shop_id: formData.shop_id,
        category_id: formData.category_id,
        form_data: formData,
        tags: params.tags.length > 0 ? params.tags : undefined,
      });
    },
    onSuccess: () => {
      notifySuccess('已保存模板', '模板已成功保存');
      setSaveTemplateModalVisible(false);
      setTemplateNameInput('');
      setTemplateTagsInput([]);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error: Error) => {
      notifyError('保存失败', `保存模板失败: ${error.message}`);
    },
  });

  const handleSaveTemplate = () => {
    if (!templateNameInput.trim()) {
      notifyWarning('请输入模板名称', '模板名称不能为空');
      return;
    }
    saveTemplateMutation.mutate({ name: templateNameInput.trim(), tags: templateTagsInput });
  };

  /**
   * 获取模板列表
   */
  const { data: templates = [] } = useQuery({
    queryKey: ['templates', selectedShop, selectedCategory, selectedTagFilter],
    queryFn: () =>
      draftTemplateApi.getTemplates({
        shop_id: selectedShop ?? undefined,
        category_id: selectedCategory ?? undefined,
        tag: selectedTagFilter,
      }),
    enabled: templateModalVisible,
  });

  /**
   * 从模板列表中提取所有唯一标签
   */
  const availableTags = useMemo(() => {
    const tagsSet = new Set<string>();
    templates.forEach((t) => {
      if (t.tags) {
        t.tags.forEach((tag) => tagsSet.add(tag));
      }
    });
    return Array.from(tagsSet).sort();
  }, [templates]);

  /**
   * 应用模板
   */
  const applyTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return await draftTemplateApi.getTemplate(templateId);
    },
    onSuccess: (template) => {
      Modal.confirm({
        title: '确认引用模板',
        content: `即将使用模板"${template.template_name}"覆盖当前表单，是否继续？`,
        onOk: () => {
          deserializeFormData(template.form_data);
          notifySuccess('已应用模板', `模板"${template.template_name}"已成功应用`);
          setTemplateModalVisible(false);
        },
      });
    },
    onError: (error: Error) => {
      notifyError('加载失败', `加载模板失败: ${error.message}`);
    },
  });

  /**
   * 删除模板
   */
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return await draftTemplateApi.deleteTemplate(templateId);
    },
    onSuccess: () => {
      notifySuccess('已删除模板', '模板已成功删除');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error: Error) => {
      notifyError('删除失败', `删除模板失败: ${error.message}`);
    },
  });

  /**
   * 重命名模板
   */
  const renameTemplateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return await draftTemplateApi.updateTemplate(id, { template_name: name });
    },
    onSuccess: () => {
      notifySuccess('已重命名', '模板已成功重命名');
      setEditingTemplateId(null);
      setEditingTemplateName('');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error: Error) => {
      notifyError('重命名失败', `重命名模板失败: ${error.message}`);
    },
  });

  /**
   * 处理模板删除
   */
  const handleDeleteTemplate = (templateId: number, templateName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除模板"${templateName}"吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteTemplateMutation.mutate(templateId);
      },
    });
  };

  /**
   * 开始编辑模板名称
   */
  const handleStartEditTemplate = (templateId: number, currentName: string) => {
    setEditingTemplateId(templateId);
    setEditingTemplateName(currentName);
  };

  /**
   * 保存模板重命名
   */
  const handleSaveRename = () => {
    if (!editingTemplateId || !editingTemplateName.trim()) {
      notifyWarning('请输入模板名称', '模板名称不能为空');
      return;
    }
    renameTemplateMutation.mutate({
      id: editingTemplateId,
      name: editingTemplateName.trim(),
    });
  };

  /**
   * 过滤后的模板列表
   */
  const filteredTemplates = useMemo(() => {
    if (!templateSearchQuery.trim()) {
      return templates;
    }
    const query = templateSearchQuery.toLowerCase();
    return templates.filter((t) =>
      t.template_name.toLowerCase().includes(query)
    );
  }, [templates, templateSearchQuery]);

  // 类目选择变化时加载属性
  useEffect(() => {
    if (selectedCategory && selectedShop) {
      loadCategoryAttributes(selectedCategory);
    } else {
      setCategoryAttributes([]);
    }
  }, [selectedCategory, selectedShop]);

  // 处理图片上传
  const handleImageUpload = async (file: File): Promise<string> => {
    if (!selectedShop) {
      return Promise.reject(new Error('请先选择店铺'));
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const result = await uploadImageMutation.mutateAsync({
            shop_id: selectedShop,
            type: 'base64',
            data: base64,
            folder: 'products',
          });

          if (result && result.success) {
            resolve(result.url);
          } else {
            reject(new Error(result?.error || '上传失败'));
          }
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  };

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
    } catch (error: any) {
      notifyError('同步失败', error.message || '网络错误');
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
      // 创建商品（使用已上传的图片URL）
      await createProductMutation.mutateAsync({
        shop_id: selectedShop,
        offer_id: values.offer_id,
        title: values.title,
        description: values.description,
        barcode: values.barcode,
        price: values.price?.toString(),
        old_price: values.old_price?.toString(),
        category_id: selectedCategory || undefined,
        images: mainProductImages,
        height: values.height,
        width: values.width,
        depth: values.depth,
        weight: values.weight,
        dimension_unit: 'mm',
        weight_unit: 'g',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '操作失败';
      notifyError('操作失败', `操作失败: ${errorMsg}`);
    }
  };

  // 添加变体维度（支持类目属性）
  const handleAddVariantDimension = (attr: CategoryAttribute) => {
    const fieldKey = `attr_${attr.attribute_id}`;

    // 检查是否已添加
    if (variantDimensions.find((d) => d.attribute_id === attr.attribute_id)) {
      notifyWarning('已添加', '该属性已作为变体维度');
      return;
    }

    const dimension: VariantDimension = {
      attribute_id: attr.attribute_id,
      name: attr.name,
      attribute_type: attr.attribute_type,
      dictionary_id: attr.dictionary_id,
      original_field_key: fieldKey,
    };

    setVariantDimensions([...variantDimensions, dimension]);
    setHiddenFields(new Set([...hiddenFields, fieldKey]));
    // 添加到变体维度（不显示通知，避免干扰用户）

    // 自动展开变体部分
    if (!variantSectionExpanded) {
      setVariantSectionExpanded(true);
    }
  };

  // 添加普通字段为变体维度
  const handleAddFieldAsVariant = (
    fieldKey: string,
    fieldName: string,
    fieldType: string = 'String',
  ) => {
    // 检查是否已添加
    if (hiddenFields.has(fieldKey)) {
      return;
    }

    // 使用字段key的hash作为ID（保持唯一性）
    const fieldId = -Math.abs(
      fieldKey.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0),
    );

    const dimension: VariantDimension = {
      attribute_id: fieldId,
      name: fieldName,
      attribute_type: fieldType,
      original_field_key: fieldKey,
    };

    setVariantDimensions([...variantDimensions, dimension]);
    setHiddenFields(new Set([...hiddenFields, fieldKey]));

    // 自动展开变体部分并创建2行（首次）
    if (!variantSectionExpanded) {
      setVariantSectionExpanded(true);

      // 如果还没有变体行，自动创建2行
      if (variants.length === 0) {
        const variant1: ProductVariant = {
          id: Date.now().toString(),
          dimension_values: {},
          offer_id: '',
          title: '',
          price: undefined,
          old_price: undefined,
        };
        const variant2: ProductVariant = {
          id: (Date.now() + 1).toString(),
          dimension_values: {},
          offer_id: '',
          title: '',
          price: undefined,
          old_price: undefined,
        };
        setVariants([variant1, variant2]);
      }
    }
  };

  // 移除变体维度
  const handleRemoveVariantDimension = (attributeId: number) => {
    // 找到要移除的维度
    const removedDimension = variantDimensions.find((d) => d.attribute_id === attributeId);

    setVariantDimensions(variantDimensions.filter((d) => d.attribute_id !== attributeId));

    // 恢复原字段显示
    if (removedDimension && removedDimension.original_field_key) {
      const newHiddenFields = new Set(hiddenFields);
      newHiddenFields.delete(removedDimension.original_field_key);
      setHiddenFields(newHiddenFields);
    }

    // 只移除该维度的值，不清空所有变体
    setVariants(
      variants.map((v) => {
        const newDimensionValues = { ...v.dimension_values };
        delete newDimensionValues[attributeId];
        return { ...v, dimension_values: newDimensionValues };
      }),
    );
  };

  // 添加变体行
  const handleAddVariantRow = () => {
    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      dimension_values: {},
      offer_id: '',
      title: '',
      price: undefined,
      old_price: undefined,
    };
    setVariants([...variants, newVariant]);
  };

  // 删除变体行
  const handleDeleteVariantRow = (id: string) => {
    setVariants(variants.filter((v) => v.id !== id));
  };

  // 更新变体行数据
  const handleUpdateVariantRow = (id: string, field: string, value: any) => {
    setVariants(
      variants.map((v) => {
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
      }),
    );
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
      handleUpdateVariantRow(editingVariant.id, 'images', images);
    } else {
      // 保存主商品图片
      setMainProductImages(images);
    }
    setImageModalVisible(false);
    setEditingVariant(null);
  };

  // 取消编辑图片
  const handleCancelImageModal = () => {
    setImageModalVisible(false);
    setEditingVariant(null);
  };

  // 批量生成 Offer ID
  const handleBatchGenerateOfferId = () => {
    if (variants.length === 0) {
      return;
    }

    const updatedVariants = variants.map((v) => {
      const timestamp = Date.now() + Math.random() * 1000; // 添加随机数确保唯一性
      const hash = md5(timestamp.toString());
      return { ...v, offer_id: `ef_${hash}` };
    });

    setVariants(updatedVariants);
  };

  // 批量设置售价
  const handleBatchSetPrice = (price: number | null) => {
    if (price === null || price === undefined) return;
    setVariants(variants.map((v) => ({ ...v, price })));
  };

  // 批量设置原价
  const handleBatchSetOldPrice = (oldPrice: number | null) => {
    if (oldPrice === null || oldPrice === undefined) return;
    setVariants(variants.map((v) => ({ ...v, old_price: oldPrice })));
  };

  // 动态生成变体表格列（图片、视频在最前面，参照 OZON 官方界面）
  const getVariantColumns = () => {
    const columns: any[] = [];

    // 图片列（第一列，左固定）
    columns.push({
      title: '图片',
      key: 'image',
      width: 64,
      fixed: 'left',
      render: (_: any, record: ProductVariant) => {
        const imageCount = record.images?.length || 0;
        return (
          <div
            className={styles.variantImageCell}
            onClick={() => handleOpenImageModal(record)}
          >
            {imageCount > 0 ? (
              <div className={styles.variantImagePreview}>
                <img src={record.images![0]} alt="variant" className={styles.variantImage} />
                <span className={styles.imageCount}>{imageCount}</span>
              </div>
            ) : (
              <div className={styles.variantImagePlaceholder}>
                <PlusOutlined />
                <span className={styles.imageCountZero}>0</span>
              </div>
            )}
          </div>
        );
      },
    });

    // 视频列（第二列）
    columns.push({
      title: '视频',
      key: 'video',
      width: 64,
      render: (_: any, record: ProductVariant) => (
        <div className={styles.variantVideoCell}>
          {record.video ? (
            <div className={styles.variantVideoPreview}>
              有
              <span className={styles.videoCount}>1</span>
            </div>
          ) : (
            <div className={styles.variantVideoPlaceholder}>
              <PlusOutlined />
              <span className={styles.videoCountZero}>0</span>
            </div>
          )}
        </div>
      ),
    });

    // Offer ID 列（第三列，表头带批量生成）
    columns.push({
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span>货号</span>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={handleBatchGenerateOfferId}
            title="批量生成所有变体的 Offer ID"
          >
            生成
          </Button>
        </div>
      ),
      key: 'offer_id',
      width: 160,
      render: (_: any, record: ProductVariant) => (
        <Input
          size="small"
          value={record.offer_id}
          onChange={(e) => handleUpdateVariantRow(record.id, 'offer_id', e.target.value)}
          placeholder="货号"
        />
      ),
    });

    // 标题列（第四列）
    columns.push({
      title: '标题',
      key: 'title',
      width: 150,
      render: (_: any, record: ProductVariant) => (
        <Input
          size="small"
          value={record.title}
          onChange={(e) => handleUpdateVariantRow(record.id, 'title', e.target.value)}
          placeholder="标题"
        />
      ),
    });

    // 添加用户选择的维度列
    variantDimensions.forEach((dim) => {
      columns.push({
        title: (
          <Space size={4}>
            {dim.name}
            <MinusCircleOutlined
              style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 14 }}
              onClick={() => handleRemoveVariantDimension(dim.attribute_id)}
              title="移除此维度"
            />
          </Space>
        ),
        key: `dim_${dim.attribute_id}`,
        width: 110,
        render: (_: any, record: ProductVariant) => (
          <Input
            size="small"
            value={record.dimension_values[dim.attribute_id] || ''}
            onChange={(e) =>
              handleUpdateVariantRow(record.id, `dim_${dim.attribute_id}`, e.target.value)
            }
            placeholder={`${dim.name}`}
          />
        ),
      });
    });

    // 售价列（表头带批量设置输入框）
    columns.push({
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ whiteSpace: 'nowrap' }}>售价</span>
          <InputNumber
            size="small"
            placeholder="批量"
            min={0}
            controls={false}
            style={{ width: '60px' }}
            onChange={handleBatchSetPrice}
            onPressEnter={(e: any) => handleBatchSetPrice(e.target.value)}
          />
        </div>
      ),
      key: 'price',
      width: 100,
      render: (_: any, record: ProductVariant) => (
        <InputNumber
          size="small"
          value={record.price}
          onChange={(value) => handleUpdateVariantRow(record.id, 'price', value)}
          placeholder="0"
          min={0}
          controls={false}
        />
      ),
    });

    // 原价列（表头带批量设置输入框）
    columns.push({
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ whiteSpace: 'nowrap' }}>原价</span>
          <InputNumber
            size="small"
            placeholder="批量"
            min={0}
            controls={false}
            style={{ width: '60px' }}
            onChange={handleBatchSetOldPrice}
            onPressEnter={(e: any) => handleBatchSetOldPrice(e.target.value)}
          />
        </div>
      ),
      key: 'old_price',
      width: 100,
      render: (_: any, record: ProductVariant) => (
        <InputNumber
          size="small"
          value={record.old_price}
          onChange={(value) => handleUpdateVariantRow(record.id, 'old_price', value)}
          placeholder="0"
          min={0}
          controls={false}
        />
      ),
    });

    // 操作列（固定在右侧）
    columns.push({
      title: '操作',
      key: 'action',
      width: 60,
      fixed: 'right',
      render: (_: any, record: ProductVariant) => (
        <Button
          type="link"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDeleteVariantRow(record.id)}
        >
          删除
        </Button>
      ),
    });

    return columns;
  };

  // 生成Offer ID
  const handleGenerateOfferId = () => {
    const timestamp = Date.now(); // 当前时间戳（ms）
    const hash = md5(timestamp.toString()); // 生成MD5哈希
    const offerId = `ef_${hash}`; // 添加ef_前缀
    form.setFieldValue('offer_id', offerId);
    // 生成Offer ID（不显示通知，避免干扰用户）
  };

  // 从label中提取括号内容
  const extractBracketContent = (text: string): { label: string; bracketContent: string | null } => {
    // 匹配中文括号（）或英文括号()中的内容
    const match = text.match(/^(.+?)[（(]([^）)]+)[）)]$/);
    if (match) {
      return {
        label: match[1].trim(),
        bracketContent: match[2].trim(),
      };
    }
    return { label: text, bracketContent: null };
  };

  // 长标题缩写映射表（中文标题 -> 英文缩写）
  const LABEL_ABBREVIATIONS: Record<string, string> = {
    欧亚经济联盟对外经济活动商品命名代码: 'EAEU Code',
    // 可以继续添加其他长标题的缩写
  };

  // 处理长标题缩写（优先使用映射表，否则超过10个字符则自动缩写）
  const abbreviateLongLabel = (
    label: string,
    maxLength: number = 10,
  ): { displayLabel: string; originalLabel: string | null } => {
    // 优先检查映射表
    if (LABEL_ABBREVIATIONS[label]) {
      return {
        displayLabel: LABEL_ABBREVIATIONS[label],
        originalLabel: label,
      };
    }

    // 如果没有映射且超过最大长度，则自动缩写
    if (label.length > maxLength) {
      return {
        displayLabel: label.substring(0, maxLength) + '...',
        originalLabel: label,
      };
    }

    return { displayLabel: label, originalLabel: null };
  };

  // 渲染tooltip内容（支持HTML链接 + 完整标题）
  const renderTooltipContent = (
    description?: string,
    bracketContent?: string | null,
    originalLabel?: string | null,
  ) => {
    if (!description && !bracketContent && !originalLabel) return undefined;

    const parts: React.ReactNode[] = [];

    // 添加完整标题（如果被缩写）
    if (originalLabel) {
      parts.push(
        <div key="original-label" style={{ fontWeight: 600, marginBottom: '4px' }}>
          {originalLabel}
        </div>,
      );
    }

    // 添加括号内容
    if (bracketContent) {
      parts.push(<div key="bracket">{bracketContent}</div>);
    }

    // 处理description中的HTML链接
    if (description) {
      // 简单的HTML链接解析：匹配 <a href="...">text</a>
      const linkRegex = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
      const textParts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;

      while ((match = linkRegex.exec(description)) !== null) {
        // 添加链接前的文本
        if (match.index > lastIndex) {
          textParts.push(description.substring(lastIndex, match.index));
        }
        // 添加链接
        textParts.push(
          <a
            key={match.index}
            href={match[1]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#1890ff', textDecoration: 'underline' }}
          >
            {match[2]}
          </a>
        );
        lastIndex = match.index + match[0].length;
      }

      // 添加剩余文本
      if (lastIndex < description.length) {
        textParts.push(description.substring(lastIndex));
      }

      // 如果没有匹配到链接，直接使用原文本
      if (textParts.length === 0) {
        textParts.push(description);
      }

      parts.push(
        <div key="description" style={{ marginTop: bracketContent ? '8px' : 0 }}>
          {textParts}
        </div>
      );
    }

    return <div>{parts}</div>;
  };

  // 渲染属性字段（带"+"按钮添加到变体）
  const renderAttributeField = (attr: CategoryAttribute) => {
    const fieldName = `attr_${attr.attribute_id}`;
    const { label, bracketContent } = extractBracketContent(attr.name);
    const { displayLabel, originalLabel } = abbreviateLongLabel(label);
    const required = attr.is_required;
    const tooltipContent = renderTooltipContent(attr.description, bracketContent, originalLabel);

    // 根据类型渲染不同的控件
    // 使用完整label用于提示信息，使用displayLabel用于显示
    const fullLabel = originalLabel || displayLabel;

    // 检查是否已添加到变体维度（已隐藏的不显示）
    if (hiddenFields.has(fieldName)) {
      return null;
    }

    // 检查是否已添加到变体维度
    const isInVariant = variantDimensions.some((d) => d.attribute_id === attr.attribute_id);

    // 渲染输入控件
    let inputControl: React.ReactNode;

    // 优先检查是否有字典值（所有类型都可能有字典值）
    if (attr.dictionary_id) {
      inputControl = (
        <Select
          showSearch
          placeholder={`请选择${fullLabel}`}
          style={{ width: '100%' }}
          filterOption={false}
          onSearch={async (value) => {
            // 搜索时动态加载并更新缓存
            if (value) {
              const values = await loadDictionaryValues(attr.dictionary_id!, value);
              // 更新缓存以触发重新渲染
              setDictionaryValuesCache((prev) => ({
                ...prev,
                [attr.dictionary_id!]: values,
              }));
            }
          }}
          onFocus={async () => {
            // 获取焦点时加载初始值（如果缓存为空）
            if (!dictionaryValuesCache[attr.dictionary_id!]) {
              await loadDictionaryValues(attr.dictionary_id!);
            }
          }}
          options={
            dictionaryValuesCache[attr.dictionary_id]?.map((v: any) => ({
              label: v.value,
              value: v.value_id,
            })) || []
          }
        />
      );
    } else {
      // 没有字典值，根据类型渲染对应控件
      switch (attr.attribute_type) {
        case 'Boolean':
          inputControl = <Switch />;
          break;

        case 'Integer':
        case 'Decimal':
          inputControl = (
            <InputNumber
              min={attr.min_value ?? undefined}
              max={attr.max_value ?? undefined}
              placeholder={`请输入${fullLabel}`}
              controls={false}
              style={{ width: '100%' }}
            />
          );
          break;

        case 'String':
        case 'URL':
        default:
          inputControl = <Input placeholder={`请输入${fullLabel}`} />;
          break;
      }
    }

    return (
      <Form.Item
        key={attr.attribute_id}
        label={displayLabel}
        tooltip={tooltipContent}
        style={{ marginBottom: 12 }}
      >
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item
            name={fieldName}
            valuePropName={attr.attribute_type === 'Boolean' ? 'checked' : undefined}
            rules={[
              { required, message: `请${attr.attribute_type === 'Boolean' ? '选择' : '输入'}${fullLabel}` },
              attr.min_value !== undefined && attr.min_value !== null
                ? { type: 'number', min: attr.min_value, message: `最小值为${attr.min_value}` }
                : {},
              attr.max_value !== undefined && attr.max_value !== null
                ? { type: 'number', max: attr.max_value, message: `最大值为${attr.max_value}` }
                : {},
            ]}
            noStyle
          >
            {inputControl}
          </Form.Item>
          <Button
            icon={<PlusOutlined />}
            onClick={() => handleAddVariantDimension(attr)}
            disabled={isInVariant}
            title={isInVariant ? '已添加到变体' : '将当前属性添加变体属性'}
            style={{ flexShrink: 0 }}
          />
        </Space.Compact>
      </Form.Item>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <h2 className={styles.pageTitle}>
          <PlusOutlined />
          新建商品
        </h2>

        {/* 保存状态指示器 */}
        {autosaveEnabled && draftLoaded && (
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
          labelCol={{ span: 3 }}
          wrapperCol={{ span: 21 }}
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
              label="产品类目"
              name="category_id"
              rules={[{ required: true, message: '请选择产品类目' }]}
            >
              <div className={styles.categorySelector}>
                <Cascader
                  id="category_id"
                  className={styles.cascader}
                  options={categoryTree}
                  onChange={(value) => {
                    const catId =
                      value && value.length > 0 ? (value[value.length - 1] as number) : null;
                    setSelectedCategory(catId);
                    form.setFieldValue('category_id', catId);
                  }}
                  placeholder="请选择产品类目"
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

            {!hiddenFields.has('title') && (
              <Form.Item label="商品名称" required style={{ marginBottom: 12 }}>
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
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => handleAddFieldAsVariant('title', '商品名称', 'String')}
                    title="将当前属性添加变体属性"
                  />
                </Space.Compact>
              </Form.Item>
            )}

            {!hiddenFields.has('description') && (
              <Form.Item label="商品描述" style={{ marginBottom: 12 }}>
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
                    onClick={() => handleAddFieldAsVariant('description', '商品描述', 'String')}
                    title="将当前属性添加变体属性"
                  />
                </Space.Compact>
              </Form.Item>
            )}

            {!variantSectionExpanded && (
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
              {!hiddenFields.has('depth') && (
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
                        onClick={() => handleAddFieldAsVariant('depth', '包装长度', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
              {!hiddenFields.has('width') && (
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
                        onClick={() => handleAddFieldAsVariant('width', '包装宽度', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
              {!hiddenFields.has('height') && (
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
                        onClick={() => handleAddFieldAsVariant('height', '包装高度', 'Integer')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                </div>
              )}
              {!hiddenFields.has('weight') && (
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
                        onClick={() => handleAddFieldAsVariant('weight', '重量', 'Integer')}
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
                    .map((attr) => renderAttributeField(attr))}

                  {/* 选填属性（折叠）+ 条形码 */}
                  {(categoryAttributes.filter((attr) => !attr.is_required).length > 0 || !hiddenFields.has('barcode')) && (
                    <div style={{ marginTop: '16px' }}>
                      <Button
                        type="link"
                        onClick={() => setOptionalFieldsExpanded(!optionalFieldsExpanded)}
                        icon={optionalFieldsExpanded ? <UpOutlined /> : <DownOutlined />}
                        style={{ padding: 0 }}
                      >
                        {optionalFieldsExpanded ? '收起' : '展开'}选填属性 (
                        {categoryAttributes.filter((attr) => !attr.is_required).length + (!hiddenFields.has('barcode') ? 1 : 0)} 个)
                      </Button>

                      {optionalFieldsExpanded && (
                        <div style={{ marginTop: '12px' }}>
                          {/* 条形码（选填） */}
                          {!hiddenFields.has('barcode') && (
                            <Form.Item label="条形码 (Barcode)" style={{ marginBottom: 12 }}>
                              <Space.Compact style={{ width: 'auto' }}>
                                <Form.Item name="barcode" noStyle>
                                  <Input placeholder="商品条形码（FBP模式必填）" style={{ width: '250px' }} />
                                </Form.Item>
                                <Button
                                  icon={<PlusOutlined />}
                                  onClick={() => handleAddFieldAsVariant('barcode', '条形码', 'String')}
                                  title="将当前属性添加变体属性"
                                />
                              </Space.Compact>
                            </Form.Item>
                          )}

                          {/* 其他选填属性 */}
                          {categoryAttributes
                            .filter((attr) => !attr.is_required)
                            .map((attr) => renderAttributeField(attr))}
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

          {/* 价格信息 */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>价格信息</h3>

            {!hiddenFields.has('price') && (
              <Form.Item label="售价" required style={{ marginBottom: 12 }}>
                <Space.Compact style={{ width: 'auto' }}>
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
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => handleAddFieldAsVariant('price', '售价', 'Decimal')}
                    title="将当前属性添加变体属性"
                  />
                </Space.Compact>
              </Form.Item>
            )}

            {!hiddenFields.has('old_price') && (
              <Form.Item label="原价" style={{ marginBottom: 12 }}>
                <Space.Compact style={{ width: 'auto' }}>
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
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => handleAddFieldAsVariant('old_price', '原价', 'Decimal')}
                    title="将当前属性添加变体属性"
                  />
                </Space.Compact>
              </Form.Item>
            )}
          </div>

          {/* 商品图片（无变体时显示） */}
          {!variantSectionExpanded && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>商品图片</h3>

              <div className={styles.mainImageArea}>
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
                <div className={styles.uploadHint}>支持JPG/PNG格式，建议3:4比例，最多15张</div>
              </div>
            </div>
          )}

          {/* 变体设置（重新设计） */}
          <div className={styles.section}>
            {!variantSectionExpanded ? (
              // 默认折叠状态：只显示"添加变体"按钮
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setVariantSectionExpanded(true);
                    // 首次展开时，如果没有变体，自动创建2个变体行
                    if (variants.length === 0) {
                      const variant1: ProductVariant = {
                        id: Date.now().toString(),
                        dimension_values: {},
                        offer_id: '',
                        title: '',
                        price: undefined,
                        old_price: undefined,
                      };
                      const variant2: ProductVariant = {
                        id: (Date.now() + 1).toString(),
                        dimension_values: {},
                        offer_id: '',
                        title: '',
                        price: undefined,
                        old_price: undefined,
                      };
                      setVariants([variant1, variant2]);
                    }
                  }}
                >
                  添加变体
                </Button>
                {variantDimensions.length > 0 && (
                  <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                    已选择 {variantDimensions.length} 个变体维度：
                    {variantDimensions.map((d) => d.name).join('、')}
                  </div>
                )}
              </div>
            ) : (
              // 展开状态：显示变体表格
              <div className={styles.variantSection}>
                <div className={styles.variantHeader}>
                  <div className={styles.variantInfo}>
                    <span>变体管理 (共 {variants.length} 个变体)</span>
                    {variantDimensions.length > 0 && (
                      <span style={{ marginLeft: 16, color: '#8c8c8c', fontSize: 12 }}>
                        额外维度：{variantDimensions.map((d) => d.name).join('、')}
                      </span>
                    )}
                  </div>
                  <div className={styles.variantActions}>
                    <Button icon={<PlusOutlined />} onClick={handleAddVariantRow}>
                      添加变体行
                    </Button>
                    <Button
                      icon={variantTableCollapsed ? <DownOutlined /> : <UpOutlined />}
                      onClick={() => setVariantTableCollapsed(!variantTableCollapsed)}
                    >
                      {variantTableCollapsed ? '展开' : '折叠'}
                    </Button>
                    <Button
                      danger
                      onClick={() => {
                        setVariantSectionExpanded(false);
                        setVariants([]);
                        setVariantDimensions([]);
                        setHiddenFields(new Set());
                        setVariantTableCollapsed(false);
                      }}
                    >
                      重置
                    </Button>
                  </div>
                </div>

                {!variantTableCollapsed && (
                  <>
                    {variants.length > 0 ? (
                      <Table
                        columns={getVariantColumns()}
                        dataSource={variants}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        scroll={{ x: 'max-content' }}
                        rowSelection={{
                          selectedRowKeys: selectedVariantIds,
                          onChange: (selectedKeys: React.Key[]) => {
                            setSelectedVariantIds(selectedKeys as string[]);
                          },
                          columnWidth: 40,
                          fixed: true,
                        }}
                        className={styles.variantTable}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                        暂无变体数据，点击"添加变体行"开始创建
                        <br />
                        <span style={{ fontSize: 12 }}>
                          （默认包含 Offer ID、标题、售价、原价字段，可在类目属性中添加其他维度）
                        </span>
                      </div>
                    )}
                  </>
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
          <Button onClick={() => setTemplateModalVisible(true)}>引用模板</Button>
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
          variantId={editingVariant?.id || 'main-product'}
          offerId={editingVariant?.offer_id || '主商品图片'}
          images={editingVariant ? (editingVariant.images || []) : (mainProductImages || [])}
          shopId={selectedShop}
          onOk={handleSaveImages}
          onCancel={handleCancelImageModal}
        />
      )}

      {/* 保存模板弹窗 */}
      <Modal
        title="保存为模板"
        open={saveTemplateModalVisible}
        onOk={handleSaveTemplate}
        onCancel={() => setSaveTemplateModalVisible(false)}
        confirmLoading={saveTemplateMutation.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="请输入模板名称"
            value={templateNameInput}
            onChange={(e) => setTemplateNameInput(e.target.value)}
            maxLength={200}
            showCount
            onPressEnter={handleSaveTemplate}
          />
          <Select
            mode="tags"
            style={{ width: '100%' }}
            placeholder="添加标签（可选，最多10个）"
            value={templateTagsInput}
            onChange={(tags) => setTemplateTagsInput(tags.slice(0, 10))}
            maxCount={10}
            tokenSeparators={[',']}
          />
        </Space>
      </Modal>

      {/* 引用模板弹窗 */}
      <Modal
        title="选择模板"
        open={templateModalVisible}
        onCancel={() => {
          setTemplateModalVisible(false);
          setTemplateSearchQuery('');
          setSelectedTagFilter(undefined);
          setEditingTemplateId(null);
          setEditingTemplateName('');
        }}
        footer={null}
        width={700}
      >
        {/* 筛选区域 */}
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="搜索模板名称..."
            value={templateSearchQuery}
            onChange={(e) => setTemplateSearchQuery(e.target.value)}
            allowClear
          />
          <Select
            style={{ width: '100%' }}
            placeholder="按标签筛选（可选）"
            value={selectedTagFilter}
            onChange={setSelectedTagFilter}
            allowClear
            options={availableTags.map((tag) => ({ label: tag, value: tag }))}
          />
        </Space>

        {filteredTemplates.length > 0 ? (
          <List
            dataSource={filteredTemplates}
            renderItem={(template) => (
              <List.Item
                actions={[
                  editingTemplateId === template.id ? (
                    <Space key="edit">
                      <Input
                        value={editingTemplateName}
                        onChange={(e) => setEditingTemplateName(e.target.value)}
                        onPressEnter={handleSaveRename}
                        style={{ width: 150 }}
                        autoFocus
                      />
                      <Button
                        type="link"
                        size="small"
                        onClick={handleSaveRename}
                        loading={renameTemplateMutation.isPending}
                      >
                        保存
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setEditingTemplateId(null);
                          setEditingTemplateName('');
                        }}
                      >
                        取消
                      </Button>
                    </Space>
                  ) : (
                    <Space key="actions">
                      <Button
                        type="link"
                        onClick={() => applyTemplateMutation.mutate(template.id)}
                        loading={applyTemplateMutation.isPending}
                      >
                        应用
                      </Button>
                      <Button
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() =>
                          handleStartEditTemplate(template.id, template.template_name)
                        }
                      >
                        重命名
                      </Button>
                      <Button
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          handleDeleteTemplate(template.id, template.template_name)
                        }
                        loading={deleteTemplateMutation.isPending}
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                ]}
              >
                {editingTemplateId === template.id ? (
                  <List.Item.Meta description="编辑中..." />
                ) : (
                  <List.Item.Meta
                    title={template.template_name}
                    description={
                      <Space direction="vertical" size={4}>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {`更新: ${new Date(template.updated_at).toLocaleString()}`}
                          {template.used_count > 0 && (
                            <>
                              {' | '}
                              使用次数: {template.used_count}
                            </>
                          )}
                          {template.last_used_at && (
                            <>
                              {' | '}
                              最后使用: {new Date(template.last_used_at).toLocaleString()}
                            </>
                          )}
                        </div>
                        {template.tags && template.tags.length > 0 && (
                          <div>
                            {template.tags.map((tag) => (
                              <Tag key={tag} color="blue" style={{ marginRight: 4 }}>
                                {tag}
                              </Tag>
                            ))}
                          </div>
                        )}
                      </Space>
                    }
                  />
                )}
              </List.Item>
            )}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
            {templateSearchQuery ? '未找到匹配的模板' : '暂无模板'}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProductCreate;
