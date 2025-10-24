/**
 * 第三方服务配置Tab
 * 整合：Cloudinary图床、跨境巴士、汇率API
 */
import {
  DollarOutlined,
  PictureOutlined,
  TruckOutlined,
  ReloadOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Alert,
  Row,
  Col,
  Statistic,
  Switch,
  Spin,
  Segmented,
} from 'antd';
import React, { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import styles from './ThirdPartyServicesTab.module.scss';

import { usePermission } from '@/hooks/usePermission';
import * as exchangeRateApi from '@/services/exchangeRateApi';
import * as ozonApi from '@/services/ozonApi';
import * as watermarkApi from '@/services/watermarkApi';
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notification';

import type { FormValues } from '@/types/common';

const ThirdPartyServicesTab: React.FC = () => {
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const [cloudinaryForm] = Form.useForm();
  const [kuajing84Form] = Form.useForm();
  const [exchangeRateForm] = Form.useForm();
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');
  const [cloudinaryEnabled, setCloudinaryEnabled] = useState(false);

  // ========== Cloudinary 配置（异步加载）==========
  const { data: cloudinaryConfig, isLoading: cloudinaryLoading } = useQuery({
    queryKey: ['ozon', 'cloudinary-config'],
    queryFn: () => watermarkApi.getCloudinaryConfig(),
    enabled: cloudinaryEnabled, // 仅在需要时加载
  });

  const saveCloudinaryMutation = useMutation({
    mutationFn: (values: FormValues) => watermarkApi.createCloudinaryConfig(values),
    onSuccess: () => {
      notifySuccess('保存成功', 'Cloudinary配置已保存');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'cloudinary-config'] });
    },
    onError: (error: Error) => {
      notifyError('保存失败', `保存失败: ${error.message}`);
    },
  });

  const testCloudinaryMutation = useMutation({
    mutationFn: () => watermarkApi.testCloudinaryConnection(),
    onSuccess: () => {
      notifySuccess('测试成功', 'Cloudinary连接测试成功');
    },
    onError: (error: Error) => {
      notifyError('测试失败', `测试失败: ${error.message}`);
    },
  });

  // 组件挂载后异步加载Cloudinary配置（避免阻塞页面初始渲染）
  useEffect(() => {
    const timer = setTimeout(() => {
      setCloudinaryEnabled(true);
    }, 100); // 延迟100ms，让页面先完成初始渲染
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (cloudinaryConfig) {
      cloudinaryForm.setFieldsValue({
        cloud_name: cloudinaryConfig.cloud_name || '',
        api_key: cloudinaryConfig.api_key || '',
        folder_prefix: cloudinaryConfig.folder_prefix || 'euraflow',
        auto_cleanup_days: cloudinaryConfig.auto_cleanup_days || 30,
      });
    }
  }, [cloudinaryConfig, cloudinaryForm]);

  // ========== 跨境巴士配置 ==========
  const { data: kuajing84Config, isLoading: kuajing84Loading } = useQuery({
    queryKey: ['ozon', 'kuajing84-global-config'],
    queryFn: () => ozonApi.getKuajing84Config(),
  });

  const saveKuajing84Mutation = useMutation({
    mutationFn: (values: FormValues) =>
      ozonApi.saveKuajing84Config({
        username: values.username,
        password: values.password,
        enabled: values.enabled || false,
      }),
    onSuccess: () => {
      notifySuccess('保存成功', '跨境巴士配置已保存');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'kuajing84-global-config'] });
      kuajing84Form.setFieldsValue({ password: '' });
    },
    onError: (error: Error) => {
      notifyError('保存失败', `保存失败: ${error.message}`);
    },
  });

  const testKuajing84Mutation = useMutation({
    mutationFn: () => ozonApi.testKuajing84Connection(),
    onSuccess: () => {
      notifySuccess('测试成功', '跨境巴士连接测试成功');
    },
    onError: (error: Error) => {
      notifyError('测试失败', `测试失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (kuajing84Config?.data) {
      kuajing84Form.setFieldsValue({
        enabled: kuajing84Config.data.enabled || false,
        username: kuajing84Config.data.username || '',
        password: '',
      });
    }
  }, [kuajing84Config, kuajing84Form]);

  // ========== 汇率配置 ==========
  const { data: exchangeRateConfig } = useQuery({
    queryKey: ['exchange-rate', 'config'],
    queryFn: exchangeRateApi.getExchangeRateConfig,
  });

  const { data: currentRate, isLoading: rateLoading } = useQuery({
    queryKey: ['exchange-rate', 'current'],
    queryFn: () => exchangeRateApi.getExchangeRate('CNY', 'RUB'),
    enabled: exchangeRateConfig?.configured === true,
    refetchInterval: 60000,
  });

  // 获取汇率历史
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['exchange-rate', 'history', timeRange],
    queryFn: () => exchangeRateApi.getExchangeRateHistory('CNY', 'RUB', timeRange),
    enabled: exchangeRateConfig?.configured === true,
  });

  // X轴格式化函数
  const formatXAxis = (text: string) => {
    const date = new Date(text);
    if (timeRange === 'today') {
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else {
      return date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
      });
    }
  };

  const configExchangeRateMutation = useMutation({
    mutationFn: exchangeRateApi.configureExchangeRateApi,
    onSuccess: () => {
      notifySuccess('配置成功', '汇率API配置成功');
      queryClient.invalidateQueries({ queryKey: ['exchange-rate'] });
      exchangeRateForm.resetFields();
    },
    onError: (error: Error) => {
      notifyError('配置失败', `配置失败: ${error.response?.data?.error?.detail || error.message}`);
    },
  });

  const refreshRateMutation = useMutation({
    mutationFn: exchangeRateApi.refreshExchangeRate,
    onSuccess: (data) => {
      if (data.status === 'success') {
        notifySuccess('刷新成功', data.message);
        queryClient.invalidateQueries({ queryKey: ['exchange-rate'] });
      } else {
        notifyInfo('刷新提示', data.message);
      }
    },
    onError: (error: Error) => {
      notifyError('刷新失败', `刷新失败: ${error.response?.data?.error?.detail || error.message}`);
    },
  });

  return (
    <div className={styles.container}>
      {/* Cloudinary配置 */}
      <Card title={<><PictureOutlined /> Cloudinary图床配置</>} className={styles.card}>
        <Alert
          message="Cloudinary用于存储和处理水印图片"
          description="免费额度：25 GB存储，25 GB带宽"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Spin spinning={cloudinaryLoading}>
          <Form form={cloudinaryForm} layout="vertical" onFinish={(values) => saveCloudinaryMutation.mutate(values)}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="cloud_name"
                  label="Cloud Name"
                  rules={[{ required: true, message: '请输入Cloud Name' }]}
                >
                  <Input placeholder="your-cloud-name" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="api_key" label="API Key" rules={[{ required: true, message: '请输入API Key' }]}                >
                  <Input placeholder="123456789012345" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="api_secret"
                  label="API Secret"
                  rules={[{ required: !cloudinaryConfig, message: '请输入API Secret' }]}
                >
                  <Input.Password placeholder="保存后不显示" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="folder_prefix" label="文件夹前缀" initialValue="euraflow">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="auto_cleanup_days" label="自动清理天数" initialValue={30}>
                  <InputNumber min={1} max={365} controls={false} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            {cloudinaryConfig && (
              <Row gutter={16} style={{ marginTop: 16 }}>
                <Col span={8}>
                  <Statistic
                    title="存储使用"
                    value={(cloudinaryConfig.storage_used_bytes || 0) / 1024 / 1024}
                    precision={2}
                    suffix="MB"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="带宽使用"
                    value={(cloudinaryConfig.bandwidth_used_bytes || 0) / 1024 / 1024}
                    precision={2}
                    suffix="MB"
                  />
                </Col>
              </Row>
            )}

            {canOperate && (
              <Form.Item style={{ marginTop: 16 }}>
                <Space>
                  <Button type="primary" htmlType="submit" loading={saveCloudinaryMutation.isPending}>
                    保存配置
                  </Button>
                  <Button onClick={() => testCloudinaryMutation.mutate()} loading={testCloudinaryMutation.isPending}>
                    测试连接
                  </Button>
                </Space>
              </Form.Item>
            )}
          </Form>
        </Spin>
      </Card>

      {/* 跨境巴士配置 */}
      <Card title={<><TruckOutlined /> 跨境巴士配置</>} className={styles.card}>
        <Alert
          message="跨境巴士用于订单物流同步"
          description="启用后，打包发货页面可以将已填写国内物流单号的订单同步到跨境巴士平台"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Spin spinning={kuajing84Loading}>
          <Form form={kuajing84Form} layout="vertical" onFinish={(values) => saveKuajing84Mutation.mutate(values)}>
            <Form.Item name="enabled" label="启用跨境巴士同步" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                  <Input placeholder="请输入跨境巴士用户名" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password placeholder="请输入跨境巴士密码" />
                </Form.Item>
              </Col>
            </Row>

            {canOperate && (
              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={saveKuajing84Mutation.isPending}>
                    保存配置
                  </Button>
                  <Button onClick={() => testKuajing84Mutation.mutate()} loading={testKuajing84Mutation.isPending}>
                    测试连接
                  </Button>
                </Space>
              </Form.Item>
            )}
          </Form>
        </Spin>
      </Card>

      {/* 汇率API配置 */}
      <Card title={<><DollarOutlined /> 汇率API配置</>} className={styles.card}>
        <Alert
          message="汇率API用于实时获取人民币→卢布汇率"
          description="免费账户每月1500次请求，系统每30分钟自动刷新一次"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {exchangeRateConfig?.configured && (
          <Alert
            message={`API已配置 | 服务商: ${exchangeRateConfig.api_provider} | 状态: ${exchangeRateConfig.is_enabled ? '启用' : '禁用'}`}
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          form={exchangeRateForm}
          layout="vertical"
          onFinish={(values) => {
            configExchangeRateMutation.mutate({
              api_key: values.api_key,
              api_provider: 'exchangerate-api',
              base_currency: 'CNY',
              is_enabled: true,
            });
          }}
        >
          <Form.Item name="api_key" label="API Key" rules={[{ required: true, message: '请输入API Key' }]}>
            <Input.Password placeholder="请输入exchangerate-api.com的API Key" />
          </Form.Item>

          {canOperate && (
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={configExchangeRateMutation.isPending}>
                  保存配置
                </Button>
                <Button
                  onClick={() => refreshRateMutation.mutate()}
                  loading={refreshRateMutation.isPending}
                  disabled={!exchangeRateConfig?.configured}
                  icon={<ReloadOutlined />}
                >
                  手动刷新汇率
                </Button>
              </Space>
            </Form.Item>
          )}
        </Form>

        {exchangeRateConfig?.configured && (
          <>
            <Row gutter={16} style={{ marginTop: 24 }}>
              <Col span={12}>
                {rateLoading ? (
                  <Spin />
                ) : currentRate ? (
                  <Statistic
                    title="当前汇率：人民币 (CNY) → 卢布 (RUB)"
                    value={parseFloat(currentRate.rate)}
                    precision={6}
                    valueStyle={{ color: '#3f8600' }}
                    suffix={<span style={{ fontSize: 14 }}>{currentRate.cached && '(缓存)'}</span>}
                  />
                ) : (
                  <Alert message="无法获取汇率数据" type="warning" showIcon />
                )}
              </Col>
            </Row>

            {/* 汇率趋势图 */}
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Space>
                  <LineChartOutlined />
                  <span style={{ fontWeight: 500 }}>汇率趋势</span>
                </Space>
                <Segmented
                  options={[
                    { label: '今日', value: 'today' },
                    { label: '本周', value: 'week' },
                    { label: '本月', value: 'month' },
                  ]}
                  value={timeRange}
                  onChange={(value) => setTimeRange(value as 'today' | 'week' | 'month')}
                />
              </div>

              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <Spin />
                </div>
              ) : history?.data && history.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history.data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tickFormatter={formatXAxis} />
                    <YAxis tickFormatter={(value) => value.toFixed(4)} />
                    <Tooltip formatter={(value) => [`${value.toFixed(6)}`, '汇率']} />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="#1890ff"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Alert
                  message="暂无历史数据"
                  description="系统会在后台自动获取汇率数据，请稍后查看"
                  type="info"
                  showIcon
                />
              )}
            </div>
          </>
        )}

        <Alert
          message="提示"
          description={
            <div>
              <p>
                1. 前往{' '}
                <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">
                  exchangerate-api.com
                </a>{' '}
                注册获取免费API Key
              </p>
              <p>2. 配置后系统会自动同步汇率数据</p>
            </div>
          }
          type="info"
          style={{ marginTop: 16 }}
        />
      </Card>
    </div>
  );
};

export default ThirdPartyServicesTab;
