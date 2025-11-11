/**
 * 草稿模板管理 Hook
 *
 * 功能：
 * - 草稿自动加载和确认
 * - 模板UI状态管理
 * - 模板CRUD操作（创建/更新/删除/应用）
 * - 模板列表查询和过滤
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import * as draftTemplateApi from '@/services/draftTemplateApi';
import { notifySuccess, notifyWarning, notifyError } from '@/utils/notification';
import { loggers } from '@/utils/logger';

export interface UseDraftTemplateProps {
  /**
   * 序列化表单数据函数（由父组件提供）
   */
  serializeFormData: () => draftTemplateApi.FormData;

  /**
   * 反序列化表单数据函数（由父组件提供）
   */
  deserializeFormData: (data: draftTemplateApi.FormData) => void;

  /**
   * 可选：当前选中的店铺ID（用于模板过滤）
   */
  selectedShop?: number;

  /**
   * 可选：当前选中的类目ID（用于模板过滤）
   */
  selectedCategory?: number;
}

export interface UseDraftTemplateReturn {
  // 草稿加载状态
  draftLoaded: boolean;
  draftQuery: ReturnType<typeof useQuery>;

  // 模板UI状态
  templateModalVisible: boolean;
  setTemplateModalVisible: (visible: boolean) => void;
  saveTemplateModalVisible: boolean;
  setSaveTemplateModalVisible: (visible: boolean) => void;
  templateNameInput: string;
  setTemplateNameInput: (name: string) => void;
  templateTagsInput: string[];
  setTemplateTagsInput: (tags: string[]) => void;
  templateSearchQuery: string;
  setTemplateSearchQuery: (query: string) => void;
  selectedTagFilter: string | undefined;
  setSelectedTagFilter: (tag: string | undefined) => void;
  editingTemplateId: number | null;
  editingTemplateName: string;
  setEditingTemplateName: (name: string) => void;
  editingTemplateTags: string[];
  setEditingTemplateTags: (tags: string[]) => void;

  // 模板数据
  templates: draftTemplateApi.Template[];
  filteredTemplates: draftTemplateApi.Template[];
  availableTags: string[];

  // 模板操作
  saveTemplateMutation: ReturnType<typeof useMutation>;
  applyTemplateMutation: ReturnType<typeof useMutation>;
  deleteTemplateMutation: ReturnType<typeof useMutation>;
  updateTemplateMutation: ReturnType<typeof useMutation>;

  // 处理函数
  handleSaveTemplate: () => void;
  handleDeleteTemplate: (templateId: number, templateName: string) => void;
  handleStartEditTemplate: (templateId: number, currentName: string, currentTags?: string[]) => void;
  handleSaveEdit: () => void;
}

/**
 * 草稿模板管理 Hook
 */
export const useDraftTemplate = ({
  serializeFormData,
  deserializeFormData,
  selectedShop,
  selectedCategory,
}: UseDraftTemplateProps): UseDraftTemplateReturn => {
  const queryClient = useQueryClient();
  const { modal } = App.useApp();

  // ==================== 状态管理 ====================

  // 草稿加载状态
  const [draftLoaded, setDraftLoaded] = useState(false);

  // 模板UI状态
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [saveTemplateModalVisible, setSaveTemplateModalVisible] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [templateTagsInput, setTemplateTagsInput] = useState<string[]>([]);
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | undefined>(undefined);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateTags, setEditingTemplateTags] = useState<string[]>([]);

  // ==================== 草稿加载 ====================

  /**
   * 加载最新草稿（页面初始化时）
   */
  const draftQuery = useQuery({
    queryKey: ['latest-draft'],
    queryFn: draftTemplateApi.getLatestDraft,
    enabled: !draftLoaded,
  });

  // 处理草稿加载结果
  useEffect(() => {
    if (draftQuery.isSuccess && !draftLoaded) {
      const draft = draftQuery.data;
      if (draft) {
        modal.confirm({
          title: '发现未保存的草稿',
          content: `上次编辑时间：${new Date(draft.updated_at).toLocaleString()}。是否恢复？`,
          onOk: () => {
            deserializeFormData(draft.form_data);
            notifySuccess('已恢复草稿', '草稿已成功恢复');
          },
        });
      }
      setDraftLoaded(true);
    }
    if (draftQuery.isError && !draftLoaded) {
      loggers.product.error('加载草稿失败', draftQuery.error);
      setDraftLoaded(true);
    }
  }, [draftQuery.isSuccess, draftQuery.isError, draftQuery.data, draftQuery.error, draftLoaded, modal, deserializeFormData]);

  // ==================== 模板查询 ====================

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

  // ==================== 模板变更操作 ====================

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

  /**
   * 应用模板
   */
  const applyTemplateMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return await draftTemplateApi.getTemplate(templateId);
    },
    onSuccess: (template) => {
      modal.confirm({
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
   * 更新模板（名称和标签）
   */
  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, name, tags }: { id: number; name: string; tags?: string[] }) => {
      return await draftTemplateApi.updateTemplate(id, {
        template_name: name,
        tags: tags,
      });
    },
    onSuccess: () => {
      notifySuccess('已更新', '模板已成功更新');
      setEditingTemplateId(null);
      setEditingTemplateName('');
      setEditingTemplateTags([]);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error: Error) => {
      notifyError('更新失败', `更新模板失败: ${error.message}`);
    },
  });

  // ==================== 处理函数 ====================

  /**
   * 保存模板
   */
  const handleSaveTemplate = useCallback(() => {
    if (!templateNameInput.trim()) {
      notifyWarning('请输入模板名称', '模板名称不能为空');
      return;
    }
    saveTemplateMutation.mutate({ name: templateNameInput.trim(), tags: templateTagsInput });
  }, [templateNameInput, templateTagsInput, saveTemplateMutation]);

  /**
   * 处理模板删除
   */
  const handleDeleteTemplate = useCallback((templateId: number, templateName: string) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除模板"${templateName}"吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteTemplateMutation.mutate(templateId);
      },
    });
  }, [modal, deleteTemplateMutation]);

  /**
   * 开始编辑模板
   */
  const handleStartEditTemplate = useCallback((templateId: number, currentName: string, currentTags?: string[]) => {
    setEditingTemplateId(templateId);
    setEditingTemplateName(currentName);
    setEditingTemplateTags(currentTags || []);
  }, []);

  /**
   * 保存模板编辑
   */
  const handleSaveEdit = useCallback(() => {
    if (!editingTemplateId || !editingTemplateName.trim()) {
      notifyWarning('请输入模板名称', '模板名称不能为空');
      return;
    }
    updateTemplateMutation.mutate({
      id: editingTemplateId,
      name: editingTemplateName.trim(),
      tags: editingTemplateTags,
    });
  }, [editingTemplateId, editingTemplateName, editingTemplateTags, updateTemplateMutation]);

  // ==================== 返回接口 ====================

  return {
    // 草稿加载状态
    draftLoaded,
    draftQuery,

    // 模板UI状态
    templateModalVisible,
    setTemplateModalVisible,
    saveTemplateModalVisible,
    setSaveTemplateModalVisible,
    templateNameInput,
    setTemplateNameInput,
    templateTagsInput,
    setTemplateTagsInput,
    templateSearchQuery,
    setTemplateSearchQuery,
    selectedTagFilter,
    setSelectedTagFilter,
    editingTemplateId,
    editingTemplateName,
    setEditingTemplateName,
    editingTemplateTags,
    setEditingTemplateTags,

    // 模板数据
    templates,
    filteredTemplates,
    availableTags,

    // 模板操作
    saveTemplateMutation,
    applyTemplateMutation,
    deleteTemplateMutation,
    updateTemplateMutation,

    // 处理函数
    handleSaveTemplate,
    handleDeleteTemplate,
    handleStartEditTemplate,
    handleSaveEdit,
  };
};
