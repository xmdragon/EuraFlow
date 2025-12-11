/**
 * 管理员额度管理页面 - 充值和账户管理
 */
import {
  WalletOutlined,
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  SettingOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Input,
  Select,
  Modal,
  Form,
  InputNumber,
  Radio,
  Tabs,
  DatePicker,
  Typography,
  message,
  Popconfirm,
  Switch,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useState } from 'react';

import PageTitle from '@/components/PageTitle';
import * as creditApi from '@/services/credit';
import type {
  CreditAccount,
  RechargeRecord,
  ModuleConfig,
  RechargeRequest,
} from '@/types/credit';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const AdminCredits: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('accounts');

  // 账户列表状态
  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [accountsPage, setAccountsPage] = useState(1);
  const [accountsPageSize, setAccountsPageSize] = useState(20);

  // 充值记录状态
  const [rechargeUserFilter, setRechargeUserFilter] = useState<number | undefined>();
  const [rechargeDateRange, setRechargeDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [rechargePage, setRechargePage] = useState(1);
  const [rechargePageSize, setRechargePageSize] = useState(20);

  // 充值弹窗状态
  const [rechargeModalVisible, setRechargeModalVisible] = useState(false);
  const [rechargeTarget, setRechargeTarget] = useState<CreditAccount | null>(null);
  const [rechargeForm] = Form.useForm();

  // 模块配置弹窗状态
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ModuleConfig | null>(null);
  const [configForm] = Form.useForm();

  // 获取账户列表
  const { data: accounts, isLoading: accountsLoading, refetch: refetchAccounts } = useQuery({
    queryKey: ['admin-credit-accounts', searchText, roleFilter, accountsPage, accountsPageSize],
    queryFn: () =>
      creditApi.getAccounts({
        search: searchText || undefined,
        role: roleFilter,
        page: accountsPage,
        page_size: accountsPageSize,
      }),
  });

  // 获取充值记录
  const { data: rechargeRecords, isLoading: rechargeLoading, refetch: refetchRecharges } = useQuery({
    queryKey: ['admin-recharge-records', rechargeUserFilter, rechargeDateRange, rechargePage, rechargePageSize],
    queryFn: () =>
      creditApi.getRechargeRecords({
        user_id: rechargeUserFilter,
        start_date: rechargeDateRange[0]?.format('YYYY-MM-DD'),
        end_date: rechargeDateRange[1]?.format('YYYY-MM-DD'),
        page: rechargePage,
        page_size: rechargePageSize,
      }),
    enabled: activeTab === 'recharges',
  });

  // 获取模块配置
  const { data: moduleConfigs, isLoading: configsLoading, refetch: refetchConfigs } = useQuery({
    queryKey: ['admin-module-configs'],
    queryFn: creditApi.getAdminModuleConfigs,
    enabled: activeTab === 'configs',
  });

  // 充值 mutation
  const rechargeMutation = useMutation({
    mutationFn: creditApi.recharge,
    onSuccess: (data) => {
      message.success(`充值成功！余额: ${data.balance_before} → ${data.balance_after}`);
      setRechargeModalVisible(false);
      rechargeForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-credit-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['admin-recharge-records'] });
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      message.error(error.response?.data?.detail || '充值失败');
    },
  });

  // 更新模块配置 mutation
  const updateConfigMutation = useMutation({
    mutationFn: ({ moduleKey, data }: { moduleKey: string; data: { cost_per_unit?: string; is_enabled?: boolean } }) =>
      creditApi.updateModuleConfig(moduleKey, data),
    onSuccess: () => {
      message.success('配置更新成功');
      setConfigModalVisible(false);
      configForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['admin-module-configs'] });
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      message.error(error.response?.data?.detail || '更新失败');
    },
  });

  // 角色配置
  const roleConfig: Record<string, { color: string; label: string }> = {
    admin: { color: 'gold', label: '超级管理员' },
    manager: { color: 'blue', label: '主账号' },
  };

  // 支付方式配置
  const paymentMethodConfig: Record<string, { color: string; label: string }> = {
    manual: { color: 'default', label: '手动充值' },
    wechat: { color: 'green', label: '微信支付' },
    alipay: { color: 'blue', label: '支付宝' },
  };

  // 账户列表列定义
  const accountColumns: ColumnsType<CreditAccount> = [
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: string) => {
        const config = roleConfig[role] || { color: 'default', label: role };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '当前余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 120,
      align: 'right',
      render: (balance: string, record: CreditAccount) => (
        <Text style={{ color: record.is_low_balance ? '#ff4d4f' : undefined }}>
          {parseFloat(balance).toFixed(2)}
        </Text>
      ),
    },
    {
      title: '累计充值',
      dataIndex: 'total_recharged',
      key: 'total_recharged',
      width: 120,
      align: 'right',
      render: (val: string) => <Text type="success">{parseFloat(val).toFixed(2)}</Text>,
    },
    {
      title: '累计消费',
      dataIndex: 'total_consumed',
      key: 'total_consumed',
      width: 120,
      align: 'right',
      render: (val: string) => <Text type="danger">{parseFloat(val).toFixed(2)}</Text>,
    },
    {
      title: '子账号数',
      dataIndex: 'sub_accounts_count',
      key: 'sub_accounts_count',
      width: 80,
      align: 'center',
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: unknown, record: CreditAccount) =>
        record.is_low_balance ? <Tag color="error">余额不足</Tag> : <Tag color="success">正常</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: CreditAccount) => (
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            setRechargeTarget(record);
            setRechargeModalVisible(true);
          }}
        >
          充值
        </Button>
      ),
    },
  ];

  // 充值记录列定义
  const rechargeColumns: ColumnsType<RechargeRecord> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: '充值金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      align: 'right',
      render: (val: string) => <Text type="success">+{parseFloat(val).toFixed(2)}</Text>,
    },
    {
      title: '支付方式',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 100,
      render: (method: string) => {
        const config = paymentMethodConfig[method] || { color: 'default', label: method };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '实付金额(CNY)',
      dataIndex: 'payment_amount_cny',
      key: 'payment_amount_cny',
      width: 120,
      align: 'right',
      render: (val: string | null) => (val ? `¥${parseFloat(val).toFixed(2)}` : '-'),
    },
    {
      title: '充值前',
      dataIndex: 'balance_before',
      key: 'balance_before',
      width: 100,
      align: 'right',
      render: (val: string) => parseFloat(val).toFixed(2),
    },
    {
      title: '充值后',
      dataIndex: 'balance_after',
      key: 'balance_after',
      width: 100,
      align: 'right',
      render: (val: string) => parseFloat(val).toFixed(2),
    },
    {
      title: '操作员',
      dataIndex: 'approved_by_username',
      key: 'approved_by_username',
      width: 100,
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      ellipsis: true,
      render: (val: string | null) => val || '-',
    },
  ];

  // 模块配置列定义
  const configColumns: ColumnsType<ModuleConfig> = [
    {
      title: '模块标识',
      dataIndex: 'module_key',
      key: 'module_key',
      width: 150,
    },
    {
      title: '模块名称',
      dataIndex: 'module_name',
      key: 'module_name',
      width: 150,
    },
    {
      title: '单次消费',
      dataIndex: 'cost_per_unit',
      key: 'cost_per_unit',
      width: 100,
      align: 'right',
      render: (val: string) => parseFloat(val).toFixed(2),
    },
    {
      title: '单位',
      dataIndex: 'unit_description',
      key: 'unit_description',
      width: 100,
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      key: 'is_enabled',
      width: 80,
      render: (enabled: boolean) =>
        enabled ? <Tag color="success">启用</Tag> : <Tag color="default">禁用</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: ModuleConfig) => (
        <Button
          size="small"
          icon={<SettingOutlined />}
          onClick={() => {
            setEditingConfig(record);
            configForm.setFieldsValue({
              cost_per_unit: parseFloat(record.cost_per_unit),
              is_enabled: record.is_enabled,
            });
            setConfigModalVisible(true);
          }}
        >
          编辑
        </Button>
      ),
    },
  ];

  // 处理充值提交
  const handleRecharge = async (values: {
    amount: number;
    payment_method: string;
    payment_amount_cny?: number;
    notes?: string;
  }) => {
    if (!rechargeTarget) return;

    const request: RechargeRequest = {
      user_id: rechargeTarget.user_id,
      amount: values.amount.toString(),
      payment_method: values.payment_method as 'manual' | 'wechat' | 'alipay',
      payment_amount_cny: values.payment_amount_cny?.toString(),
      notes: values.notes,
    };

    rechargeMutation.mutate(request);
  };

  // 处理配置更新
  const handleUpdateConfig = async (values: { cost_per_unit: number; is_enabled: boolean }) => {
    if (!editingConfig) return;

    updateConfigMutation.mutate({
      moduleKey: editingConfig.module_key,
      data: {
        cost_per_unit: values.cost_per_unit.toString(),
        is_enabled: values.is_enabled,
      },
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <PageTitle title="额度管理" />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'accounts',
            label: (
              <span>
                <WalletOutlined />
                用户额度
              </span>
            ),
            children: (
              <Card>
                <Space style={{ marginBottom: 16 }}>
                  <Input
                    placeholder="搜索用户名"
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    onPressEnter={() => refetchAccounts()}
                    style={{ width: 200 }}
                    allowClear
                  />
                  <Select
                    placeholder="角色筛选"
                    value={roleFilter}
                    onChange={setRoleFilter}
                    style={{ width: 150 }}
                    allowClear
                  >
                    <Select.Option value="admin">超级管理员</Select.Option>
                    <Select.Option value="manager">主账号</Select.Option>
                  </Select>
                  <Button icon={<ReloadOutlined />} onClick={() => refetchAccounts()}>
                    刷新
                  </Button>
                </Space>

                <Table
                  columns={accountColumns}
                  dataSource={accounts?.items || []}
                  rowKey="user_id"
                  loading={accountsLoading}
                  pagination={{
                    current: accountsPage,
                    pageSize: accountsPageSize,
                    total: accounts?.total || 0,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total) => `共 ${total} 个账户`,
                    onChange: (p, ps) => {
                      setAccountsPage(p);
                      setAccountsPageSize(ps);
                    },
                  }}
                  scroll={{ x: 1000 }}
                />
              </Card>
            ),
          },
          {
            key: 'recharges',
            label: (
              <span>
                <HistoryOutlined />
                充值记录
              </span>
            ),
            children: (
              <Card>
                <Space style={{ marginBottom: 16 }}>
                  <RangePicker
                    value={rechargeDateRange}
                    onChange={(dates) => {
                      setRechargeDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null]);
                      setRechargePage(1);
                    }}
                    allowClear
                  />
                  <Button icon={<ReloadOutlined />} onClick={() => refetchRecharges()}>
                    刷新
                  </Button>
                </Space>

                <Table
                  columns={rechargeColumns}
                  dataSource={rechargeRecords?.items || []}
                  rowKey="id"
                  loading={rechargeLoading}
                  pagination={{
                    current: rechargePage,
                    pageSize: rechargePageSize,
                    total: rechargeRecords?.total || 0,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total) => `共 ${total} 条记录`,
                    onChange: (p, ps) => {
                      setRechargePage(p);
                      setRechargePageSize(ps);
                    },
                  }}
                  scroll={{ x: 1200 }}
                />
              </Card>
            ),
          },
          {
            key: 'configs',
            label: (
              <span>
                <SettingOutlined />
                模块配置
              </span>
            ),
            children: (
              <Card>
                <Space style={{ marginBottom: 16 }}>
                  <Button icon={<ReloadOutlined />} onClick={() => refetchConfigs()}>
                    刷新
                  </Button>
                </Space>

                <Table
                  columns={configColumns}
                  dataSource={moduleConfigs?.items || []}
                  rowKey="module_key"
                  loading={configsLoading}
                  pagination={false}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* 充值弹窗 */}
      <Modal
        title={`为 ${rechargeTarget?.username || ''} 充值`}
        open={rechargeModalVisible}
        onCancel={() => {
          setRechargeModalVisible(false);
          rechargeForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Form form={rechargeForm} layout="vertical" onFinish={handleRecharge}>
          <Form.Item
            name="amount"
            label="充值点数"
            rules={[
              { required: true, message: '请输入充值点数' },
              { type: 'number', min: 0.01, message: '充值点数必须大于0' },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="请输入充值点数"
              precision={2}
              min={0.01}
            />
          </Form.Item>

          <Form.Item
            name="payment_method"
            label="支付方式"
            rules={[{ required: true, message: '请选择支付方式' }]}
            initialValue="manual"
          >
            <Radio.Group>
              <Radio.Button value="manual">手动充值</Radio.Button>
              <Radio.Button value="wechat">微信支付</Radio.Button>
              <Radio.Button value="alipay">支付宝</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="payment_amount_cny" label="实付金额(CNY)">
            <InputNumber
              style={{ width: '100%' }}
              placeholder="可选，记录实际支付金额"
              precision={2}
              min={0}
              prefix="¥"
            />
          </Form.Item>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="可选，充值备注" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setRechargeModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={rechargeMutation.isPending}>
                确认充值
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 模块配置弹窗 */}
      <Modal
        title={`编辑模块配置: ${editingConfig?.module_name || ''}`}
        open={configModalVisible}
        onCancel={() => {
          setConfigModalVisible(false);
          configForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Form form={configForm} layout="vertical" onFinish={handleUpdateConfig}>
          <Form.Item
            name="cost_per_unit"
            label="单次消费点数"
            rules={[
              { required: true, message: '请输入单次消费点数' },
              { type: 'number', min: 0, message: '消费点数不能为负' },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="请输入单次消费点数"
              precision={4}
              min={0}
            />
          </Form.Item>

          <Form.Item name="is_enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setConfigModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={updateConfigMutation.isPending}>
                保存
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminCredits;
