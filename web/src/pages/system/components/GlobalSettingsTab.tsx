/**
 * 全局设置Tab组件
 * 包含：API限流、类目特征、类目佣金
 */
import React, { useState } from 'react';
import {
  Card,
  Tabs,
  Form,
  InputNumber,
  Button,
  Space,
  Typography,
  Alert,
  Table,
  Select,
  Input,
  Upload,
  Modal,
  Progress,
  App,
  message,
  Tree,
  Spin,
} from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  SyncOutlined,
  DatabaseOutlined,
  DollarOutlined,
  UploadOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UploadFile } from 'antd/es/upload/interface';

import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { notifySuccess, notifyError, notifyInfo, notifyWarning } from '@/utils/notification';
import { categoryTree } from '@/data/categoryTree';

const { Title, Paragraph, Text } = Typography;
const { Option } = Select;

const GlobalSettingsTab: React.FC = () => {
  const { isAdmin } = usePermission();
  const queryClient = useQueryClient();

  return (
    <Card>
      <Tabs
        defaultActiveKey="api-rate-limit"
        items={[
          {
            label: (
              <span>
                <SettingOutlined /> API限流
              </span>
            ),
            key: 'api-rate-limit',
            children: <ApiRateLimitSection isAdmin={isAdmin} />,
          },
          {
            label: (
              <span>
                <DatabaseOutlined /> 类目与特征
              </span>
            ),
            key: 'category-features',
            children: <CategoryFeaturesSection isAdmin={isAdmin} />,
          },
          {
            label: (
              <span>
                <DollarOutlined /> 类目佣金
              </span>
            ),
            key: 'category-commissions',
            children: <CategoryCommissionsSection isAdmin={isAdmin} />,
          },
        ]}
      />
    </Card>
  );
};

// ========== 子组件：API限流设置 ==========
interface ApiRateLimitSectionProps {
  isAdmin: boolean;
}

const ApiRateLimitSection: React.FC<ApiRateLimitSectionProps> = ({ isAdmin }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 获取全局设置
  const { data: settings, isLoading } = useQuery({
    queryKey: ['ozon', 'global-settings'],
    queryFn: async () => {
      const response = await ozonApi.getGlobalSettings();
      return response;
    },
  });

  // 更新设置
  const updateMutation = useMutation({
    mutationFn: async (values: { api_rate_limit: number }) => {
      await ozonApi.updateGlobalSetting('api_rate_limit', {
        value: values.api_rate_limit,
        unit: 'req/s',
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', 'API限流设置已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: any) => {
      notifyError('保存失败', error.message || '更新API限流设置失败');
    },
  });

  // 初始化表单值
  React.useEffect(() => {
    if (settings?.settings?.api_rate_limit) {
      form.setFieldsValue({
        api_rate_limit: settings.settings.api_rate_limit.setting_value.value,
      });
    }
  }, [settings, form]);

  const handleSave = (values: { api_rate_limit: number }) => {
    updateMutation.mutate(values);
  };

  if (isLoading) {
    return <div>加载中...</div>;
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <Alert
        message="API限流说明"
        description="设置每秒向OZON发送的API请求上限，避免触发限流。建议值：50 req/s"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Form.Item
          name="api_rate_limit"
          label="每秒请求数上限"
          rules={[
            { required: true, message: '请输入请求数上限' },
            { type: 'number', min: 1, max: 1000, message: '请输入1-1000之间的数字' },
          ]}
        >
          <InputNumber
            min={1}
            max={1000}
            style={{ width: '100px' }}
            addonAfter="req/s"
            controls={false}
            disabled={!isAdmin}
          />
        </Form.Item>

        {isAdmin && (
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={updateMutation.isPending}>
              保存设置
            </Button>
          </Form.Item>
        )}
      </Form>
    </div>
  );
};

// ========== 子组件：类目与特征 ==========
interface CategoryFeaturesSectionProps {
  isAdmin: boolean;
}

const CategoryFeaturesSection: React.FC<CategoryFeaturesSectionProps> = ({ isAdmin }) => {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncingFeatures, setSyncingFeatures] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [syncingCategoryId, setSyncingCategoryId] = useState<number | null>(null);
  const [autoExpandParent, setAutoExpandParent] = useState(false);

  // 获取店铺列表，取第一个店铺ID
  const { data: shopsData } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: async () => await ozonApi.getShops(),
  });

  const firstShopId = shopsData?.shops?.[0]?.id || 1; // 取第一个店铺，兜底值为1

  // 类目树同步轮询 Hook
  const { startPolling: startCategorySyncPolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const status = await ozonApi.getCategorySyncTaskStatus(taskId);

      if (status.state === 'SUCCESS') {
        return { state: 'SUCCESS', result: status.result };
      } else if (status.state === 'FAILURE') {
        return { state: 'FAILURE', error: status.error || '任务执行失败' };
      } else {
        return { state: 'PROGRESS', info: status.info };
      }
    },
    pollingInterval: 5000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'category-tree-sync',
    initialMessage: '类目同步进行中',
    formatProgressContent: (info) => {
      const { processed_categories = 0, total_categories = 0, current_category = '', percent = 0 } = info;
      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>
            {current_category.includes('准备中') || current_category.includes('等待')
              ? current_category
              : `正在处理 "${current_category}"...`}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
            已完成 {processed_categories}/{total_categories} 个类目
          </div>
        </div>
      );
    },
    formatSuccessMessage: (result) => ({
      title: '同步完成',
      description: `成功同步 ${result.total_categories || 0} 个类目（新增 ${result.new_categories || 0}，更新 ${result.updated_categories || 0}，废弃 ${result.deprecated_categories || 0}）`,
    }),
    onSuccess: () => {
      setSyncing(false);
      queryClient.invalidateQueries({ queryKey: ['category-tree'] });
    },
    onFailure: () => {
      setSyncing(false);
    },
    onTimeout: () => {
      setSyncing(false);
    },
    onCancel: () => {
      setSyncing(false);
    },
  });

  // 特征同步轮询 Hook
  const { startPolling: startFeatureSyncPolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const status = await ozonApi.getBatchSyncTaskStatus(taskId);

      if (status.state === 'SUCCESS') {
        return { state: 'SUCCESS', result: status.result };
      } else if (status.state === 'FAILURE') {
        return { state: 'FAILURE', error: status.error || '任务执行失败' };
      } else {
        return { state: 'PROGRESS', info: status.info };
      }
    },
    pollingInterval: 10000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'batch-sync-features',
    initialMessage: '批量同步进行中',
    formatProgressContent: (info) => {
      const { synced_categories = 0, total_categories = 0, current_category = '', percent = 0 } = info;
      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>
            {current_category.includes('准备中') || current_category.includes('等待')
              ? current_category
              : `正在同步 "${current_category}" 特征...`}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
            已完成 {synced_categories}/{total_categories} 个类目
          </div>
        </div>
      );
    },
    formatSuccessMessage: (result) => ({
      title: '同步完成',
      description: `成功同步 ${result.synced_categories || 0} 个类目，${result.synced_attributes || 0} 个特征`,
    }),
    onSuccess: () => {
      setSyncingFeatures(false);
    },
    onFailure: () => {
      setSyncingFeatures(false);
    },
    onTimeout: () => {
      setSyncingFeatures(false);
    },
    onCancel: () => {
      setSyncingFeatures(false);
    },
  });

  // 查询选中类目的属性
  const { data: attributesData, isLoading: attributesLoading } = useQuery({
    queryKey: ['category-attributes', selectedCategoryId, firstShopId],
    queryFn: async () => {
      if (!selectedCategoryId) return null;
      return await ozonApi.getCategoryAttributes(firstShopId, selectedCategoryId, false);
    },
    enabled: !!selectedCategoryId,
  });

  const handleSyncCategories = async () => {
    // 防止重复点击
    if (syncing) {
      return;
    }

    setSyncing(true);

    try {
      // 调用异步类目树同步API
      const response = await ozonApi.syncCategoryTreeAsync(firstShopId, true);

      if (!response.success || !response.task_id) {
        throw new Error(response.error || '启动同步任务失败');
      }

      // 使用新的轮询 Hook 启动后台轮询任务
      startCategorySyncPolling(response.task_id);

    } catch (error: any) {
      notifyError('同步失败', error.message || '类目同步失败');
      setSyncing(false);
    }
  };

  // 同步单个类目特征
  const handleSyncSingleCategory = async (categoryId: number, categoryName: string) => {
    if (syncingCategoryId) {
      notifyWarning('操作提示', '有类目正在同步中，请稍候');
      return;
    }

    setSyncingCategoryId(categoryId);
    try {
      const result = await ozonApi.syncSingleCategoryAttributes(categoryId, firstShopId, {
        language: 'ZH_HANS',
        forceRefresh: false,
        syncDictionaryValues: true,
      });

      if (result.success) {
        notifySuccess(
          '同步成功',
          `类目 "${result.category_name}" 特征同步完成\n` +
            `同步特征: ${result.synced_attributes || 0} 个\n` +
            `缓存特征: ${result.cached_attributes || 0} 个\n` +
            `同步特征值: ${result.synced_values || 0} 个`
        );
        // 刷新当前选中类目的属性列表
        if (selectedCategoryId === categoryId) {
          queryClient.invalidateQueries({ queryKey: ['category-attributes', categoryId] });
        }
      } else {
        notifyError('同步失败', result.error || '未知错误');
      }
    } catch (error: any) {
      notifyError('同步失败', error.message || '网络错误');
    } finally {
      setSyncingCategoryId(null);
    }
  };

  const handleSyncFeatures = async () => {
    // 防止重复点击
    if (syncingFeatures) {
      return;
    }

    setSyncingFeatures(true);

    try {
      // 调用批量同步API，同步所有叶子类目的特征
      const response = await ozonApi.batchSyncCategoryAttributes(firstShopId, {
        syncAllLeaf: true,
        syncDictionaryValues: true,
        language: 'ZH_HANS',
        maxConcurrent: 5,
      });

      if (!response.success || !response.task_id) {
        throw new Error(response.error || '启动同步任务失败');
      }

      // 使用新的轮询 Hook 启动后台轮询任务
      startFeatureSyncPolling(response.task_id);

    } catch (error: any) {
      notifyError('同步失败', error.message || '特征同步失败');
      setSyncingFeatures(false);
    }
  };

  // 转换类目树数据为Tree组件格式
  // 搜索过滤函数 - 返回匹配节点及其所有祖先节点的key
  const getMatchedKeys = (data: any[], searchValue: string): string[] => {
    const keys = new Set<string>();

    const search = (items: any[], ancestors: string[] = []): boolean => {
      let hasMatch = false;

      for (const item of items) {
        const matched = item.label.toLowerCase().includes(searchValue.toLowerCase());
        const currentPath = [...ancestors, String(item.value)];

        // 递归搜索子节点
        let childrenMatched = false;
        if (item.children && item.children.length > 0) {
          childrenMatched = search(item.children, currentPath);
        }

        // 如果当前节点匹配或子节点有匹配，则添加路径上的所有节点
        if (matched || childrenMatched) {
          currentPath.forEach(key => keys.add(key));
          hasMatch = true;
        }
      }

      return hasMatch;
    };

    search(data);
    return Array.from(keys);
  };

  // 搜索时自动展开匹配的节点
  React.useEffect(() => {
    if (searchValue && searchValue.trim()) {
      const matchedKeys = getMatchedKeys(categoryTree, searchValue);
      setExpandedKeys(matchedKeys);
      setAutoExpandParent(true);
    } else {
      setExpandedKeys([]);
      setAutoExpandParent(false);
    }
  }, [searchValue]);

  const convertToTreeData = (data: any[]): any[] => {
    return data.map((item) => {
      const title = item.label;
      const isMatched = searchValue && title.toLowerCase().includes(searchValue.toLowerCase());
      const highlightedTitle = isMatched ? (
        <span style={{ color: '#1890ff', fontWeight: 'bold' }}>{title}</span>
      ) : (
        title
      );

      return {
        title: (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>{highlightedTitle}</span>
            {item.isLeaf && isAdmin && (
              <Button
                type="link"
                size="small"
                icon={<SyncOutlined spin={syncingCategoryId === item.value} />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSyncSingleCategory(item.value, item.label);
                }}
                loading={syncingCategoryId === item.value}
                disabled={syncingCategoryId !== null && syncingCategoryId !== item.value}
                style={{ padding: '0 4px' }}
              >
                同步
              </Button>
            )}
          </div>
        ),
        key: item.value,
        children: item.children ? convertToTreeData(item.children) : undefined,
        isLeaf: item.isLeaf,
      };
    });
  };

  const treeData = convertToTreeData(categoryTree);

  // 处理类目选择
  const handleSelect = (selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      setSelectedCategoryId(Number(selectedKeys[0]));
    }
  };

  // 属性表格列定义
  const attributeColumns = [
    {
      title: '属性名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: '类型',
      dataIndex: 'attribute_type',
      key: 'attribute_type',
      width: 120,
    },
    {
      title: '是否必填',
      dataIndex: 'is_required',
      key: 'is_required',
      width: 100,
      sorter: (a: any, b: any) => (b.is_required ? 1 : 0) - (a.is_required ? 1 : 0),
      defaultSortOrder: 'ascend' as const,
      render: (is_required: boolean) => (
        is_required ? <span style={{ color: 'red' }}>是</span> : '否'
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
  ];

  return (
    <div>
      <Alert
        message="类目特征说明"
        description="查看OZON商品类目树和类目特征。点击类目可查看该类目的属性列表。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Space size="middle" style={{ marginBottom: 24 }}>
        <Button
          type="primary"
          icon={<SyncOutlined spin={syncing} />}
          onClick={handleSyncCategories}
          loading={syncing}
          disabled={!isAdmin}
        >
          同步类目
        </Button>

        <Button
          type="default"
          icon={<DatabaseOutlined />}
          onClick={handleSyncFeatures}
          loading={syncingFeatures}
          disabled={!isAdmin}
        >
          同步特征
        </Button>
      </Space>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* 左侧：类目树 */}
        <div style={{ flex: '0 0 350px', maxHeight: 600, overflow: 'auto', border: '1px solid #d9d9d9', borderRadius: 4, padding: 12 }}>
          <Title level={5} style={{ marginTop: 0 }}>类目树（共 {categoryTree.length} 个一级类目）</Title>
          <Input.Search
            placeholder="搜索类目名称..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onSearch={setSearchValue}
            allowClear
            style={{ marginBottom: 12 }}
          />
          <Tree
            treeData={treeData}
            onSelect={handleSelect}
            expandedKeys={expandedKeys}
            onExpand={(keys) => {
              setExpandedKeys(keys);
              setAutoExpandParent(false);
            }}
            autoExpandParent={autoExpandParent}
            showLine
            defaultExpandAll={false}
          />
        </div>

        {/* 右侧：属性列表 */}
        <div style={{ flex: 1 }}>
          {selectedCategoryId ? (
            <>
              <Title level={5} style={{ marginTop: 0 }}>
                类目属性 (类目ID: {selectedCategoryId})
              </Title>
              {attributesLoading ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <Spin tip="加载中..." />
                </div>
              ) : attributesData && attributesData.data && attributesData.data.length > 0 ? (
                <Table
                  dataSource={attributesData.data}
                  columns={attributeColumns}
                  rowKey="attribute_id"
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  size="small"
                  scroll={{ y: 500 }}
                />
              ) : (
                <Alert
                  message="暂无属性"
                  description="该类目暂无属性数据，可能需要先同步特征。"
                  type="warning"
                  showIcon
                />
              )}
            </>
          ) : (
            <Alert
              message="请选择类目"
              description="点击左侧类目树中的类目，查看该类目的属性列表。"
              type="info"
              showIcon
            />
          )}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Paragraph type="secondary">
          <strong>说明：</strong>
          <br />
          • 同步类目：拉取OZON平台的三级类目树（中文）
          <br />
          • 同步特征：拉取所有叶子类目的商品属性和字典值
          <br />• 首次同步或类目更新时使用，通常无需频繁同步
        </Paragraph>
      </div>
    </div>
  );
};

// ========== 子组件：类目佣金 ==========
interface CategoryCommissionsSectionProps {
  isAdmin: boolean;
}

interface Commission {
  id: number;
  category_module: string;
  category_name: string;
  rfbs_tier1: number;
  rfbs_tier2: number;
  rfbs_tier3: number;
  fbp_tier1: number;
  fbp_tier2: number;
  fbp_tier3: number;
}

const CategoryCommissionsSection: React.FC<CategoryCommissionsSectionProps> = ({ isAdmin }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [moduleFilter, setModuleFilter] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState<string | undefined>(undefined);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const queryClient = useQueryClient();

  // 查询类目佣金列表
  const { data: commissionsData, isLoading } = useQuery({
    queryKey: ['ozon', 'category-commissions', page, pageSize, moduleFilter, searchText],
    queryFn: async () => {
      const response = await ozonApi.getCategoryCommissions({
        page,
        page_size: pageSize,
        module: moduleFilter,
        search: searchText,
      });
      return response;
    },
  });

  // 查询类目模块列表（用于筛选）
  const { data: modules } = useQuery({
    queryKey: ['ozon', 'category-modules'],
    queryFn: async () => {
      const response = await ozonApi.getCategoryModules();
      return response;
    },
  });

  // CSV导入
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return await ozonApi.importCommissionsCsv(formData);
    },
    onSuccess: (data: any) => {
      notifySuccess(
        '导入完成',
        `成功导入 ${data.imported_count} 条，跳过 ${data.skipped_count} 条`
      );
      setUploadModalVisible(false);
      setFileList([]);
      queryClient.invalidateQueries({ queryKey: ['ozon', 'category-commissions'] });
    },
    onError: (error: any) => {
      notifyError('导入失败', error.message || 'CSV导入失败');
    },
  });

  const handleUpload = () => {
    if (fileList.length === 0) {
      message.warning('请先选择CSV文件');
      return;
    }

    const file = fileList[0].originFileObj;
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const columns = [
    {
      title: '类目模块',
      dataIndex: 'category_module',
      key: 'category_module',
      width: 120,
      filters: modules?.map((m: string) => ({ text: m, value: m })),
      filteredValue: moduleFilter ? [moduleFilter] : null,
    },
    {
      title: '商品类目',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 180,
    },
    {
      title: 'rFBS ≤1500₽',
      dataIndex: 'rfbs_tier1',
      key: 'rfbs_tier1',
      width: 110,
      render: (val: number) => `${val}%`,
    },
    {
      title: 'FBP ≤1500₽',
      dataIndex: 'fbp_tier1',
      key: 'fbp_tier1',
      width: 110,
      render: (val: number) => `${val}%`,
    },
    {
      title: 'rFBS ≤5000₽',
      dataIndex: 'rfbs_tier2',
      key: 'rfbs_tier2',
      width: 110,
      render: (val: number) => `${val}%`,
    },
    {
      title: 'FBP ≤5000₽',
      dataIndex: 'fbp_tier2',
      key: 'fbp_tier2',
      width: 110,
      render: (val: number) => `${val}%`,
    },
    {
      title: 'rFBS >5000₽',
      dataIndex: 'rfbs_tier3',
      key: 'rfbs_tier3',
      width: 110,
      render: (val: number) => `${val}%`,
    },
    {
      title: 'FBP >5000₽',
      dataIndex: 'fbp_tier3',
      key: 'fbp_tier3',
      width: 110,
      render: (val: number) => `${val}%`,
    },
  ];

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Alert
          message="类目佣金说明"
          description="查看OZON平台各类目在不同价格区间的佣金比例。rFBS和FBP是两种不同的发货方案。"
          type="info"
          showIcon
        />

        {/* 筛选和操作栏 */}
        <Space>
          <Select
            placeholder="筛选类目模块"
            style={{ width: 150 }}
            allowClear
            value={moduleFilter}
            onChange={(value) => {
              setModuleFilter(value);
              setPage(1);
            }}
          >
            {modules?.map((m: string) => (
              <Option key={m} value={m}>
                {m}
              </Option>
            ))}
          </Select>

          <Input.Search
            placeholder="搜索类目名称"
            style={{ width: 200 }}
            onSearch={(value) => {
              setSearchText(value || undefined);
              setPage(1);
            }}
            allowClear
          />

          {isAdmin && (
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setUploadModalVisible(true)}
            >
              导入CSV
            </Button>
          )}

          <Button icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['ozon', 'category-commissions'] })}>
            刷新
          </Button>
        </Space>

        {/* 佣金数据表格 */}
        <Table
          dataSource={commissionsData?.items || []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: commissionsData?.total || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (newPage, newPageSize) => {
              setPage(newPage);
              setPageSize(newPageSize);
            },
          }}
          scroll={{ x: 1000 }}
          size="small"
        />
      </Space>

      {/* CSV上传弹窗 */}
      <Modal
        title="导入CSV文件"
        open={uploadModalVisible}
        onCancel={() => {
          setUploadModalVisible(false);
          setFileList([]);
        }}
        onOk={handleUpload}
        confirmLoading={uploadMutation.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            message="CSV格式要求"
            description={
              <div>
                <p>第一行为表头（会被跳过）</p>
                <p>列顺序：类目模块,商品类目,rFBS≤1500,FBP≤1500,rFBS≤5000,FBP≤5000,rFBS&gt;5000,FBP&gt;5000</p>
                <p>佣金比例格式：12.00% 或 12.00（自动去除%符号）</p>
              </div>
            }
            type="info"
            showIcon
          />

          <Upload
            fileList={fileList}
            beforeUpload={(file) => {
              setFileList([file]);
              return false;
            }}
            onRemove={() => {
              setFileList([]);
            }}
            accept=".csv"
            maxCount={1}
          >
            <Button icon={<UploadOutlined />}>选择CSV文件</Button>
          </Upload>
        </Space>
      </Modal>
    </div>
  );
};

export default GlobalSettingsTab;
