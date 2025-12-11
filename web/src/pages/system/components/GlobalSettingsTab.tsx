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
  Tree,
  Spin,
  Dropdown,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  SyncOutlined,
  DatabaseOutlined,
  DollarOutlined,
  UploadOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  DownOutlined,
  BookOutlined,
  PictureOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UploadFile } from 'antd/es/upload/interface';

import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import { useCopy } from '@/hooks/useCopy';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import { isColorAttribute, getColorValue, getTextColor } from '@/utils/colorMapper';
import { setOzonImageCdn } from '@/utils/ozonImageOptimizer';

const { Title, Paragraph } = Typography;
const { Option } = Select;

// 定义类目树数据类型
interface CategoryOption {
  value: number;
  label: string;
  isLeaf: boolean;
  disabled: boolean;
  children?: CategoryOption[];
}

// 定义Tree组件使用的数据类型
interface TreeDataNode {
  title: React.ReactNode;
  key: number;
  isLeaf: boolean;
  children?: TreeDataNode[];
}

// 定义全局设置响应类型
interface GlobalSettingsResponse {
  settings: {
    default_timezone?: {
      setting_value?: { value?: string };
    };
    default_currency?: {
      setting_value?: { value?: string };
    };
    api_rate_limit?: {
      setting_value?: { value?: number };
    };
    system_name?: {
      setting_value?: { value?: string };
    };
    credit_name?: {
      setting_value?: { value?: string };
    };
    credit_cny_rate?: {
      setting_value?: { value?: string };
    };
  };
}

// 定义类目同步进度类型
interface CategorySyncProgress {
  processed_categories?: number;
  total_categories?: number;
  current_category?: string;
  percent?: number;
}

// 定义类目同步结果类型
interface CategorySyncResult {
  total_categories?: number;
  new_categories?: number;
  updated_categories?: number;
  deprecated_categories?: number;
}

// 定义特征同步进度类型
interface FeatureSyncProgress {
  synced_categories?: number;
  total_categories?: number;
  current_category?: string;
  percent?: number;
}

// 定义特征同步结果类型
interface FeatureSyncResult {
  synced_categories?: number;
  synced_attributes?: number;
}

// 定义属性记录类型
interface AttributeRecord {
  attribute_id?: number;
  name?: string;
  attribute_type?: string;
  is_required?: boolean;
  description?: string;
  guide_values?: Array<{ value: string; info?: string }>;
}

// 定义佣金数据响应类型
interface CommissionsDataResponse {
  items?: Array<{
    id: number;
    category_module: string;
    category_name: string;
    rfbs_tier1: number;
    fbp_tier1: number;
    rfbs_tier2: number;
    fbp_tier2: number;
    rfbs_tier3: number;
    fbp_tier3: number;
  }>;
  total?: number;
}

const GlobalSettingsTab: React.FC = () => {
  const { isAdmin } = usePermission();

  return (
    <Card>
      <Tabs
        defaultActiveKey="time-currency"
        destroyInactiveTabPane
        items={[
          {
            label: (
              <span>
                <GlobalOutlined /> 时间与货币
              </span>
            ),
            key: 'time-currency',
            children: <TimeCurrencySection isAdmin={isAdmin} />,
          },
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
          {
            label: (
              <span>
                <PictureOutlined /> 图片CDN
              </span>
            ),
            key: 'image-cdn',
            children: <ImageCdnSection isAdmin={isAdmin} />,
          },
        ]}
      />
    </Card>
  );
};

// ========== 子组件：时间与货币设置 ==========
interface TimeCurrencySectionProps {
  isAdmin: boolean;
}

const TimeCurrencySection: React.FC<TimeCurrencySectionProps> = ({ isAdmin }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { copyToClipboard } = useCopy();

  // 动态获取当前域名的 webhook 地址
  const webhookUrl = `https://${window.location.hostname}/api/ef/v1/ozon/webhook`;

  // 获取全局设置
  const { data: settings, isLoading } = useQuery<GlobalSettingsResponse>({
    queryKey: ['ozon', 'global-settings'],
    queryFn: async () => {
      const response = await ozonApi.getGlobalSettings();
      return response as GlobalSettingsResponse;
    },
  });

  // 更新时区设置
  const updateTimezoneMutation = useMutation({
    mutationFn: async (timezone: string) => {
      await ozonApi.updateGlobalSetting('default_timezone', {
        value: timezone,
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '默认时区已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新时区设置失败');
    },
  });

  // 更新货币设置
  const updateCurrencyMutation = useMutation({
    mutationFn: async (currency: string) => {
      await ozonApi.updateGlobalSetting('default_currency', {
        value: currency,
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '默认货币已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新货币设置失败');
    },
  });

  // 更新系统名称
  const updateSystemNameMutation = useMutation({
    mutationFn: async (systemName: string) => {
      await ozonApi.updateGlobalSetting('system_name', {
        value: systemName,
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '系统名称已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新系统名称失败');
    },
  });

  // 更新积分名称
  const updateCreditNameMutation = useMutation({
    mutationFn: async (creditName: string) => {
      await ozonApi.updateGlobalSetting('credit_name', {
        value: creditName,
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '积分名称已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新积分名称失败');
    },
  });

  // 更新CNY兑换比例
  const updateCreditCnyRateMutation = useMutation({
    mutationFn: async (rate: string) => {
      await ozonApi.updateGlobalSetting('credit_cny_rate', {
        value: rate,
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', 'CNY兑换比例已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新CNY兑换比例失败');
    },
  });

  // 初始化表单值
  React.useEffect(() => {
    if (settings?.settings) {
      form.setFieldsValue({
        default_timezone: settings.settings.default_timezone?.setting_value?.value || 'Asia/Shanghai',
        default_currency: settings.settings.default_currency?.setting_value?.value || 'CNY',
        system_name: settings.settings.system_name?.setting_value?.value || 'EuraFlow',
        credit_name: settings.settings.credit_name?.setting_value?.value || '积分',
        credit_cny_rate: settings.settings.credit_cny_rate?.setting_value?.value || '1.0',
      });
    }
  }, [settings, form]);

  const handleSave = (values: {
    default_timezone: string;
    default_currency: string;
    system_name: string;
    credit_name: string;
    credit_cny_rate: string;
  }) => {
    updateTimezoneMutation.mutate(values.default_timezone);
    updateCurrencyMutation.mutate(values.default_currency);
    updateSystemNameMutation.mutate(values.system_name);
    updateCreditNameMutation.mutate(values.credit_name);
    updateCreditCnyRateMutation.mutate(values.credit_cny_rate);
  };

  if (isLoading) {
    return <div>加载中...</div>;
  }

  return (
    <div>
      <Alert
        message="时间与货币配置"
        description="配置系统全局的时区和默认货币单位。时区影响所有时间的显示和日期区间，货币单位影响所有未指定货币的金额显示。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Form.Item
          label="默认时区"
          name="default_timezone"
          rules={[{ required: true, message: '请选择默认时区' }]}
          extra="系统内所有时间显示和日期区间将使用此时区"
        >
          <Select style={{ width: 300 }} disabled={!isAdmin}>
            <Option value="Asia/Shanghai">
              <ClockCircleOutlined /> 北京时间 (UTC+8)
            </Option>
            <Option value="Europe/Moscow">
              <ClockCircleOutlined /> 莫斯科时间 (UTC+3)
            </Option>
          </Select>
        </Form.Item>

        <Form.Item
          label="默认货币"
          name="default_currency"
          rules={[{ required: true, message: '请选择默认货币' }]}
          extra="未指定货币单位的金额将使用此货币显示"
        >
          <Select style={{ width: 300 }} disabled={!isAdmin}>
            <Option value="CNY">
              <DollarOutlined /> 人民币 (CNY)
            </Option>
            <Option value="RUB">
              <DollarOutlined /> 卢布 (RUB)
            </Option>
          </Select>
        </Form.Item>

        <Form.Item
          label="系统名称"
          name="system_name"
          rules={[{ required: true, message: '请输入系统名称' }]}
          extra="系统显示名称，用于页面标题、通知等"
        >
          <Input style={{ width: 300 }} placeholder="EuraFlow" disabled={!isAdmin} />
        </Form.Item>

        <Form.Item
          label="积分名称"
          name="credit_name"
          rules={[{ required: true, message: '请输入积分名称' }]}
          extra="额度系统中的点数显示名称"
        >
          <Input style={{ width: 300 }} placeholder="积分" disabled={!isAdmin} />
        </Form.Item>

        <Form.Item
          label="CNY兑换比例"
          name="credit_cny_rate"
          rules={[
            { required: true, message: '请输入CNY兑换比例' },
            {
              pattern: /^\d+(\.\d{1,4})?$/,
              message: '请输入有效数字（最多4位小数）',
            },
          ]}
          extra="1 CNY 兑换多少积分（如 1.0 表示 1元=1积分）"
        >
          <Input style={{ width: 300 }} placeholder="1.0" addonAfter="积分/CNY" disabled={!isAdmin} />
        </Form.Item>

        <Form.Item
          label="系统 Webhook 地址"
          extra="OZON 后台配置 Webhook 时使用此地址（订单状态变更通知）"
        >
          <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
            <Input
              value={webhookUrl}
              readOnly
              style={{ flex: 1 }}
            />
            <Button
              icon={<GlobalOutlined />}
              onClick={() => copyToClipboard(webhookUrl, 'Webhook 地址')}
            >
              复制
            </Button>
          </Space.Compact>
        </Form.Item>

        {isAdmin && (
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={
                updateTimezoneMutation.isPending ||
                updateCurrencyMutation.isPending ||
                updateSystemNameMutation.isPending ||
                updateCreditNameMutation.isPending ||
                updateCreditCnyRateMutation.isPending
              }
            >
              保存设置
            </Button>
          </Form.Item>
        )}
      </Form>
    </div>
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
  const { data: settings, isLoading } = useQuery<GlobalSettingsResponse>({
    queryKey: ['ozon', 'global-settings'],
    queryFn: async () => {
      const response = await ozonApi.getGlobalSettings();
      return response as GlobalSettingsResponse;
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
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新API限流设置失败');
    },
  });

  // 初始化表单值
  React.useEffect(() => {
    if (settings?.settings?.api_rate_limit) {
      form.setFieldsValue({
        api_rate_limit: settings.settings.api_rate_limit.setting_value?.value,
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

  // 动态加载类目树（使用文件的generatedAt作为缓存key）
  const { data: categoryTreeData, isLoading: categoryTreeLoading, refetch: _refetchCategoryTree } = useQuery({
    queryKey: ['category-tree'],
    queryFn: async () => {
      // 首次加载时添加时间戳破坏缓存，获取最新的generatedAt
      const timestamp = Date.now();
      const response = await fetch(`/data/categoryTree.json?t=${timestamp}`);
      if (!response.ok) {
        throw new Error('加载类目树失败');
      }
      const json = await response.json();

      // 使用文件的 generatedAt 更新 queryKey
      // 这样当类目同步后，generatedAt变化会自动触发重新加载
      return {
        data: json.data as CategoryOption[],
        generatedAt: json.generatedAt,
        totalRecords: json.totalRecords,
      };
    },
    staleTime: 30 * 60 * 1000, // 30分钟内不重新请求（类目数据更新频率低）
    select: (response) => response.data, // 只返回 data 部分给组件使用
  });

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
      const typedInfo = info as CategorySyncProgress;
      const { processed_categories = 0, total_categories = 0, current_category = '', percent = 0 } = typedInfo;
      // 准备中判断：包含关键词 或 进度数据都是0
      const isPreparing = current_category.includes('准备中') || current_category.includes('等待')
        || (processed_categories === 0 && total_categories === 0);
      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>
            {isPreparing ? (current_category || '准备中...') : `正在处理 "${current_category}"...`}
          </div>
          {!isPreparing && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
              已完成 {processed_categories}/{total_categories} 个类目
            </div>
          )}
        </div>
      );
    },
    formatSuccessMessage: (result) => {
      const typedResult = result as CategorySyncResult;
      return {
        title: '同步完成',
        description: `成功同步 ${typedResult.total_categories || 0} 个类目（新增 ${typedResult.new_categories || 0}，更新 ${typedResult.updated_categories || 0}，废弃 ${typedResult.deprecated_categories || 0}）`,
      };
    },
    onSuccess: () => {
      setSyncing(false);
      // 刷新类目树数据
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
      const typedInfo = info as FeatureSyncProgress;
      const { synced_categories = 0, total_categories = 0, current_category = '', percent = 0 } = typedInfo;
      // 准备中判断：包含关键词 或 进度数据都是0
      const isPreparing = current_category.includes('准备中') || current_category.includes('等待')
        || (synced_categories === 0 && total_categories === 0);
      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>
            {isPreparing ? (current_category || '准备中...') : `正在同步 "${current_category}" 特征...`}
          </div>
          {!isPreparing && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
              已完成 {synced_categories}/{total_categories} 个类目
            </div>
          )}
        </div>
      );
    },
    formatSuccessMessage: (result) => {
      const typedResult = result as FeatureSyncResult;
      return {
        title: '同步完成',
        description: `成功同步 ${typedResult.synced_categories || 0} 个类目，${typedResult.synced_attributes || 0} 个特征`,
      };
    },
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

    } catch (error: unknown) {
      notifyError('同步失败', (error as Error).message || '类目同步失败');
      setSyncing(false);
    }
  };

  // 同步单个类目特征
  const handleSyncSingleCategory = async (categoryId: number, _categoryName: string) => {
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
    } catch (error: unknown) {
      notifyError('同步失败', (error as Error).message || '网络错误');
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

    } catch (error: unknown) {
      notifyError('同步失败', (error as Error).message || '特征同步失败');
      setSyncingFeatures(false);
    }
  };

  // 转换类目树数据为Tree组件格式
  // 搜索过滤函数 - 返回匹配节点及其所有祖先节点的key
  const getMatchedKeys = (data: CategoryOption[], searchValue: string): string[] => {
    const keys = new Set<string>();

    const search = (items: CategoryOption[], ancestors: string[] = []): boolean => {
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
    if (searchValue && searchValue.trim() && categoryTreeData) {
      const matchedKeys = getMatchedKeys(categoryTreeData, searchValue);
      setExpandedKeys(matchedKeys);
      setAutoExpandParent(true);
    } else {
      setExpandedKeys([]);
      setAutoExpandParent(false);
    }
  }, [searchValue, categoryTreeData]);

  const convertToTreeData = (data: CategoryOption[]): TreeDataNode[] => {
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

  const treeData: TreeDataNode[] = categoryTreeData ? convertToTreeData(categoryTreeData) : [];

  // 处理类目选择
  const handleSelect = (selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      setSelectedCategoryId(Number(selectedKeys[0]));
    }
  };

  // 属性表格列定义
  const attributeColumns: Array<{
    title: string;
    dataIndex: string;
    key: string;
    width?: number;
    ellipsis?: boolean;
    sorter?: (a: AttributeRecord, b: AttributeRecord) => number;
    defaultSortOrder?: 'ascend' | 'descend';
    render?: (value: unknown, record: AttributeRecord) => React.ReactNode;
  }> = [
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
      sorter: (a: AttributeRecord, b: AttributeRecord) => (b.is_required ? 1 : 0) - (a.is_required ? 1 : 0),
      defaultSortOrder: 'ascend' as const,
      render: (is_required: unknown) => (
        is_required ? <span style={{ color: 'red' }}>是</span> : '否'
      ),
    },
    {
      title: '指南',
      dataIndex: 'guide_values',
      key: 'guide_values',
      width: 120,
      render: (_: unknown, record: AttributeRecord) => {
        if (!record.guide_values || record.guide_values.length === 0) {
          return <span style={{ color: '#999' }}>无</span>;
        }

        // 检测是否为颜色属性
        const isColor = isColorAttribute(record.name);

        const items: MenuProps['items'] = record.guide_values.map((gv, index: number) => {
          // 如果是颜色属性，尝试获取颜色值
          const colorValue = isColor ? getColorValue(gv.value) : null;

          return {
            key: index,
            label: colorValue ? (
              <div
                style={{
                  maxWidth: 300,
                  padding: '8px 12px',
                  backgroundColor: colorValue,
                  color: getTextColor(colorValue),
                  borderRadius: '4px',
                  margin: '-5px -12px',
                }}
              >
                <div style={{ fontWeight: 500 }}>{gv.value}</div>
                {gv.info && (
                  <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
                    {gv.info}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ maxWidth: 300 }}>
                <div style={{ fontWeight: 500 }}>{gv.value}</div>
                {gv.info && (
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    {gv.info}
                  </div>
                )}
              </div>
            ),
          };
        });

        return (
          <Dropdown menu={{ items }} placement="bottomLeft">
            <Button size="small" icon={<BookOutlined />}>
              查看 ({record.guide_values.length})
              <DownOutlined />
            </Button>
          </Dropdown>
        );
      },
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
          <Title level={5} style={{ marginTop: 0 }}>
            类目树（共 {categoryTreeData?.length || 0} 个一级类目）
          </Title>
          <Input.Search
            placeholder="搜索类目名称..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onSearch={setSearchValue}
            allowClear
            style={{ marginBottom: 12 }}
          />
          {categoryTreeLoading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin tip="加载类目树..." />
            </div>
          ) : categoryTreeData ? (
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
          ) : (
            <Alert
              message="加载失败"
              description="无法加载类目树数据，请刷新页面重试"
              type="error"
              showIcon
            />
          )}
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

const CategoryCommissionsSection: React.FC<CategoryCommissionsSectionProps> = ({ isAdmin }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [moduleFilter, setModuleFilter] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState<string | undefined>(undefined);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const queryClient = useQueryClient();

  // 查询类目佣金列表
  const { data: commissionsData, isLoading } = useQuery<CommissionsDataResponse>({
    queryKey: ['ozon', 'category-commissions', page, pageSize, moduleFilter, searchText],
    queryFn: async () => {
      const response = await ozonApi.getCategoryCommissions({
        page,
        page_size: pageSize,
        module: moduleFilter,
        search: searchText,
      });
      return response as CommissionsDataResponse;
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
    onSuccess: (data: { imported_count: number; skipped_count: number }) => {
      notifySuccess(
        '导入完成',
        `成功导入 ${data.imported_count} 条，跳过 ${data.skipped_count} 条`
      );
      setUploadModalVisible(false);
      setFileList([]);
      queryClient.invalidateQueries({ queryKey: ['ozon', 'category-commissions'] });
    },
    onError: (error: unknown) => {
      notifyError('导入失败', (error as Error).message || 'CSV导入失败');
    },
  });

  const handleUpload = () => {
    if (fileList.length === 0) {
      notifyWarning('上传失败', '请先选择CSV文件');
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

// ========== 子组件：图片CDN设置 ==========
interface ImageCdnSectionProps {
  isAdmin: boolean;
}

// CDN测试结果类型
interface CdnTestResult {
  cdn: string;
  time: number;
  success: boolean;
  testing: boolean;
}

const ImageCdnSection: React.FC<ImageCdnSectionProps> = ({ isAdmin }) => {
  const queryClient = useQueryClient();
  const [cdnList, setCdnList] = useState<string>('cdn1.ozone.ru\ncdn2.ozone.ru\ncdn3.ozone.ru');
  const [selectedCdn, setSelectedCdn] = useState<string>('');
  const [testResults, setTestResults] = useState<CdnTestResult[]>([]);
  const [testing, setTesting] = useState(false);
  const [testImageUrl, setTestImageUrl] = useState<string>('');

  // 获取全局设置
  const { data: settings, isLoading } = useQuery<GlobalSettingsResponse>({
    queryKey: ['ozon', 'global-settings'],
    queryFn: async () => {
      const response = await ozonApi.getGlobalSettings();
      return response as GlobalSettingsResponse;
    },
  });

  // 初始化CDN设置
  React.useEffect(() => {
    if (settings?.settings) {
      const cdnSettings = settings.settings as Record<string, { setting_value?: { cdn_list?: string[]; selected_cdn?: string } }>;
      if (cdnSettings.ozon_image_cdn?.setting_value) {
        const { cdn_list, selected_cdn } = cdnSettings.ozon_image_cdn.setting_value;
        if (cdn_list && cdn_list.length > 0) {
          setCdnList(cdn_list.join('\n'));
        }
        if (selected_cdn) {
          setSelectedCdn(selected_cdn);
        }
      }
    }
  }, [settings]);

  // 更新CDN设置
  const updateCdnMutation = useMutation({
    mutationFn: async (data: { cdn_list: string[]; selected_cdn: string }) => {
      await ozonApi.updateGlobalSetting('ozon_image_cdn', data);
      return data;
    },
    onSuccess: (data) => {
      // 同步更新图片优化器的 CDN 设置
      setOzonImageCdn(data.selected_cdn || null);
      notifySuccess('保存成功', '图片CDN设置已更新');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'global-settings'] });
    },
    onError: (error: unknown) => {
      notifyError('保存失败', (error as Error).message || '更新图片CDN设置失败');
    },
  });

  // 加载图片的辅助函数
  const loadImage = (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      // 添加时间戳避免缓存
      img.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    });
  };

  // 测试单个CDN速度
  const testSingleCdn = async (cdn: string, imageUrl: string): Promise<CdnTestResult> => {
    // 替换CDN域名
    const testUrl = imageUrl.replace(/https?:\/\/[^/]+/, `https://${cdn}`);
    // 添加wc800缩放参数
    const wc800Url = testUrl.includes('/wc') ? testUrl : testUrl.replace(/(\/s3\/multimedia-[^/]+\/)/, '$1wc800/');

    const start = performance.now();
    try {
      await loadImage(wc800Url);
      return { cdn, time: Math.round(performance.now() - start), success: true, testing: false };
    } catch {
      return { cdn, time: -1, success: false, testing: false };
    }
  };

  // 测试所有CDN速度
  const handleTestSpeed = async () => {
    // 先获取测试图片
    try {
      setTesting(true);
      const testImageResponse = await ozonApi.getTestImage();

      if (testImageResponse.error) {
        notifyError('获取测试图片失败', testImageResponse.error);
        setTesting(false);
        return;
      }

      if (!testImageResponse.image_url) {
        notifyError('获取测试图片失败', '没有可用的测试图片');
        setTesting(false);
        return;
      }

      setTestImageUrl(testImageResponse.image_url);

      // 解析CDN列表
      const cdns = cdnList
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (cdns.length === 0) {
        notifyWarning('测试失败', '请先输入CDN地址');
        setTesting(false);
        return;
      }

      // 初始化测试结果
      setTestResults(cdns.map(cdn => ({ cdn, time: 0, success: false, testing: true })));

      // 并行测试所有CDN
      const results = await Promise.all(
        cdns.map(cdn => testSingleCdn(cdn, testImageResponse.image_url!))
      );

      setTestResults(results);
      setTesting(false);
    } catch (error) {
      notifyError('测试失败', (error as Error).message || '网络错误');
      setTesting(false);
    }
  };

  // 选择CDN
  const handleSelectCdn = (cdn: string) => {
    setSelectedCdn(cdn);
    // 选择后自动保存
    const cdns = cdnList
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    updateCdnMutation.mutate({
      cdn_list: cdns,
      selected_cdn: cdn,
    });
  };

  // 保存设置
  const handleSave = () => {
    const cdns = cdnList
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    updateCdnMutation.mutate({
      cdn_list: cdns,
      selected_cdn: selectedCdn,
    });
  };

  if (isLoading) {
    return <div>加载中...</div>;
  }

  // 找到最快的CDN
  const fastestCdn = testResults
    .filter(r => r.success)
    .sort((a, b) => a.time - b.time)[0];

  return (
    <div style={{ maxWidth: 800 }}>
      <Alert
        message="图片CDN配置"
        description="配置 OZON 图片的 CDN 地址，可以测试不同 CDN 的加载速度，选择最快的 CDN 提升图片加载体验。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong>CDN 地址列表（每行一个域名）：</Typography.Text>
        <Input.TextArea
          value={cdnList}
          onChange={(e) => setCdnList(e.target.value)}
          onBlur={() => {
            // 失去焦点时自动保存 CDN 列表
            if (isAdmin) {
              const cdns = cdnList
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
              updateCdnMutation.mutate({
                cdn_list: cdns,
                selected_cdn: selectedCdn,
              });
            }
          }}
          placeholder="cdn1.ozone.ru&#10;cdn2.ozone.ru&#10;cdn3.ozone.ru"
          rows={4}
          style={{ marginTop: 8, fontFamily: 'monospace' }}
          disabled={!isAdmin}
        />
      </div>

      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        onClick={handleTestSpeed}
        loading={testing}
        style={{ marginBottom: 24 }}
      >
        测试速度
      </Button>

      {testResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            测试结果：
          </Typography.Text>
          <Table
            dataSource={testResults}
            rowKey="cdn"
            pagination={false}
            size="small"
            columns={[
              {
                title: 'CDN 地址',
                dataIndex: 'cdn',
                key: 'cdn',
                render: (cdn: string) => (
                  <span style={{ fontFamily: 'monospace' }}>{cdn}</span>
                ),
              },
              {
                title: '加载时间',
                dataIndex: 'time',
                key: 'time',
                width: 120,
                render: (time: number, record: CdnTestResult) => {
                  if (record.testing) {
                    return <Spin size="small" />;
                  }
                  if (!record.success) {
                    return <span style={{ color: '#999' }}>-</span>;
                  }
                  const isFastest = fastestCdn && fastestCdn.cdn === record.cdn;
                  return (
                    <span style={{ color: isFastest ? '#52c41a' : undefined, fontWeight: isFastest ? 'bold' : undefined }}>
                      {time}ms {isFastest && '(最快)'}
                    </span>
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'success',
                key: 'success',
                width: 100,
                render: (success: boolean, record: CdnTestResult) => {
                  if (record.testing) {
                    return <span style={{ color: '#1890ff' }}>测试中...</span>;
                  }
                  return success ? (
                    <span style={{ color: '#52c41a' }}><CheckCircleOutlined /> 成功</span>
                  ) : (
                    <span style={{ color: '#ff4d4f' }}><CloseCircleOutlined /> 失败</span>
                  );
                },
              },
              {
                title: '操作',
                key: 'action',
                width: 100,
                render: (_: unknown, record: CdnTestResult) => {
                  if (!record.success || record.testing || !isAdmin) {
                    return null;
                  }
                  const isSelected = selectedCdn === record.cdn;
                  return (
                    <Button
                      type={isSelected ? 'primary' : 'default'}
                      size="small"
                      onClick={() => handleSelectCdn(record.cdn)}
                    >
                      {isSelected ? '已选择' : '选择'}
                    </Button>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {selectedCdn && (
        <Alert
          message={`当前使用: ${selectedCdn}`}
          type="success"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      {testImageUrl && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            测试图片: {testImageUrl.substring(0, 80)}...
          </Typography.Text>
        </div>
      )}
    </div>
  );
};

export default GlobalSettingsTab;
