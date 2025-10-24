/**
 * 汇率管理页面
 * 功能：配置汇率API、显示当前汇率、货币转换、汇率趋势图
 */
import {
  DollarOutlined,
  ApiOutlined,
  SyncOutlined,
  LineChartOutlined,
  SwapOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Typography,
  Form,
  Input,
  Button,
  Space,
  Statistic,
  InputNumber,
  Segmented,
  Spin,
  Alert,
} from 'antd';
import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import * as exchangeRateApi from '../services/exchangeRateApi';

import styles from './ExchangeRateManagement.module.scss';

import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

const { Text, Paragraph } = Typography;

const ExchangeRateManagement: React.FC = () => {
  const [configForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();

  // 货币转换状态
  const [cnyAmount, setCnyAmount] = useState<string>('');
  const [rubAmount, setRubAmount] = useState<string>('');
  const [convertDirection, setConvertDirection] = useState<'cny_to_rub' | 'rub_to_cny'>(
    'cny_to_rub'
  );

  // 趋势图时间范围
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');

  // 获取配置
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['exchange-rate', 'config'],
    queryFn: exchangeRateApi.getExchangeRateConfig,
  });

  // 获取当前汇率
  const {
    data: currentRate,
    isLoading: rateLoading,
    refetch: refetchRate,
  } = useQuery({
    queryKey: ['exchange-rate', 'current'],
    queryFn: () => exchangeRateApi.getExchangeRate('CNY', 'RUB'),
    enabled: config?.configured === true,
    refetchInterval: 60000, // 每分钟刷新一次
  });

  // 获取汇率历史
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['exchange-rate', 'history', timeRange],
    queryFn: () => exchangeRateApi.getExchangeRateHistory('CNY', 'RUB', timeRange),
    enabled: config?.configured === true,
  });

  // 配置API
  const configMutation = useMutation({
    mutationFn: exchangeRateApi.configureExchangeRateApi,
    onSuccess: () => {
      notifySuccess('配置成功', 'API配置成功');
      queryClient.invalidateQueries({ queryKey: ['exchange-rate'] });
      configForm.resetFields();
    },
    onError: (error: any) => {
      notifyError('配置失败', `配置失败: ${error.response?.data?.error?.detail || error.message}`);
    },
  });

  // 测试连接
  const testMutation = useMutation({
    mutationFn: (apiKey: string) => exchangeRateApi.testExchangeRateConnection(apiKey),
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('连接成功', `连接成功！当前汇率: ${data.rate}`);
      } else {
        notifyError('连接失败', `连接失败: ${data.message}`);
      }
    },
    onError: (error: any) => {
      notifyError('测试失败', `测试失败: ${error.response?.data?.error?.detail || error.message}`);
    },
  });

  // 手动刷新汇率
  const refreshMutation = useMutation({
    mutationFn: exchangeRateApi.refreshExchangeRate,
    onSuccess: (data) => {
      if (data.status === 'success') {
        notifySuccess('刷新成功', data.message);
        queryClient.invalidateQueries({ queryKey: ['exchange-rate'] });
      } else {
        notifyWarning('刷新提示', data.message);
      }
    },
    onError: (error: any) => {
      notifyError('刷新失败', `刷新失败: ${error.response?.data?.error?.detail || error.message}`);
    },
  });

  // 货币转换
  const convertMutation = useMutation({
    mutationFn: exchangeRateApi.convertCurrency,
  });

  // 配置表单提交
  const handleConfigSubmit = (values: any) => {
    configMutation.mutate({
      api_key: values.api_key,
      api_provider: 'exchangerate-api',
      base_currency: 'CNY',
      is_enabled: true, // 始终启用，通过后台服务管理启停
    });
  };

  // 测试连接
  const handleTestConnection = () => {
    const apiKey = configForm.getFieldValue('api_key');
    if (!apiKey) {
      notifyWarning('操作失败', '请先输入API Key');
      return;
    }
    testMutation.mutate(apiKey);
  };

  // 手动刷新
  const handleManualRefresh = () => {
    refreshMutation.mutate();
  };

  // 货币转换处理
  const handleConvert = async (value: string, direction: 'cny_to_rub' | 'rub_to_cny') => {
    if (!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
      return;
    }

    try {
      const request =
        direction === 'cny_to_rub'
          ? { amount: value, from_currency: 'CNY', to_currency: 'RUB' }
          : { amount: value, from_currency: 'RUB', to_currency: 'CNY' };

      const result = await convertMutation.mutateAsync(request);

      if (direction === 'cny_to_rub') {
        setRubAmount(result.converted_amount);
      } else {
        setCnyAmount(result.converted_amount);
      }
    } catch (error: any) {
      notifyError('转换失败', `转换失败: ${error.response?.data?.error?.detail || error.message}`);
    }
  };

  // CNY输入变化
  const handleCnyChange = (value: string | null) => {
    const strValue = value?.toString() || '';
    setCnyAmount(strValue);
    if (strValue) {
      handleConvert(strValue, 'cny_to_rub');
    } else {
      setRubAmount('');
    }
  };

  // RUB输入变化
  const handleRubChange = (value: string | null) => {
    const strValue = value?.toString() || '';
    setRubAmount(strValue);
    if (strValue) {
      handleConvert(strValue, 'rub_to_cny');
    } else {
      setCnyAmount('');
    }
  };

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

  return (
    <div>
      <PageTitle icon={<DollarOutlined />} title="汇率管理" />

      <div className={styles.pageContainer}>
        <div className={styles.contentContainer}>
          {canOperate && (
            <Row className={styles.titleRow} align="middle" justify="end">
              <Col>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={handleManualRefresh}
                  loading={refreshMutation.isPending}
                  disabled={!config?.configured}
                >
                  手动刷新汇率
                </Button>
              </Col>
            </Row>
          )}

          <Row gutter={[16, 16]}>
            {/* API 配置卡片 */}
            <Col xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    <ApiOutlined />
                    <span>API 配置</span>
                  </Space>
                }
                className={styles.card}
              >
                {configLoading ? (
                  <div className={styles.spinContainer}>
                    <Spin />
                  </div>
                ) : (
                  <>
                    {config?.configured && (
                      <Alert
                        message="API已配置"
                        description={`服务商: ${config.api_provider} | 状态: ${config.is_enabled ? '启用' : '禁用'}`}
                        type="success"
                        icon={<CheckCircleOutlined />}
                        showIcon
                        className={styles.configAlert}
                      />
                    )}

                    <Form form={configForm} layout="vertical" onFinish={handleConfigSubmit}>
                      <Form.Item
                        label="API Key"
                        name="api_key"
                        rules={[{ required: true, message: '请输入API Key' }]}
                      >
                        <Input.Password
                          placeholder="请输入exchangerate-api.com的API Key"
                          prefix={<ApiOutlined />}
                        />
                      </Form.Item>

                      {canOperate && (
                        <Form.Item>
                          <Space>
                            <Button
                              type="primary"
                              htmlType="submit"
                              loading={configMutation.isPending}
                            >
                              保存配置
                            </Button>
                            <Button onClick={handleTestConnection} loading={testMutation.isPending}>
                              测试连接
                            </Button>
                          </Space>
                        </Form.Item>
                      )}
                    </Form>

                    <Paragraph type="secondary" className={styles.configHint}>
                      <Text strong>提示：</Text>
                      <br />
                      1. 前往{' '}
                      <a
                        href="https://www.exchangerate-api.com"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        exchangerate-api.com
                      </a>{' '}
                      注册获取免费API Key
                      <br />
                      2. 免费账户每月1500次请求
                      <br />
                      3. 系统每30分钟自动刷新一次汇率
                    </Paragraph>
                  </>
                )}
              </Card>
            </Col>

            {/* 当前汇率显示 */}
            <Col xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    <DollarOutlined />
                    <span>当前汇率</span>
                  </Space>
                }
                extra={
                  currentRate?.cached && (
                    <Text type="secondary" className={styles.cacheHint}>
                      (缓存)
                    </Text>
                  )
                }
                className={styles.card}
              >
                {!config?.configured ? (
                  <Alert
                    message="尚未配置"
                    description="请先配置API Key以获取汇率数据"
                    type="warning"
                    icon={<CloseCircleOutlined />}
                    showIcon
                  />
                ) : rateLoading ? (
                  <div className={styles.spinContainer}>
                    <Spin />
                  </div>
                ) : currentRate ? (
                  <div className={styles.rateDisplay}>
                    <Statistic
                      title="人民币 (CNY) → 卢布 (RUB)"
                      value={parseFloat(currentRate.rate)}
                      precision={6}
                      prefix={<SyncOutlined />}
                      valueStyle={{ color: '#3f8600' }}
                      className={styles.rateStat}
                    />
                    <div className={styles.rateExample}>
                      <Text type="secondary">
                        示例: 1 CNY = {parseFloat(currentRate.rate).toFixed(4)} RUB
                      </Text>
                    </div>
                  </div>
                ) : (
                  <Alert
                    message="无法获取汇率"
                    description="请检查API配置或网络连接"
                    type="error"
                    showIcon
                  />
                )}
              </Card>
            </Col>

            {/* 货币转换器 */}
            <Col xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    <SwapOutlined />
                    <span>货币转换</span>
                  </Space>
                }
                className={styles.card}
              >
                {!config?.configured ? (
                  <Alert message="请先配置API" type="warning" showIcon />
                ) : (
                  <div className={styles.converterContainer}>
                    <Form layout="vertical">
                      <Form.Item label="人民币 (CNY)">
                        <InputNumber
                          value={cnyAmount ? parseFloat(cnyAmount) : undefined}
                          onChange={(value) => handleCnyChange(value?.toString() || null)}
                          placeholder="请输入金额"
                          prefix="¥"
                          min={0}
                          precision={2}
                          className={styles.converterInput}
                          disabled={convertMutation.isPending}
                          controls={false}
                        />
                      </Form.Item>

                      <div className={styles.swapIcon}>
                        <SwapOutlined rotate={90} />
                      </div>

                      <Form.Item label="卢布 (RUB)">
                        <InputNumber
                          value={rubAmount ? parseFloat(rubAmount) : undefined}
                          onChange={(value) => handleRubChange(value?.toString() || null)}
                          placeholder="请输入金额"
                          prefix="₽"
                          min={0}
                          precision={2}
                          className={styles.converterInput}
                          disabled={convertMutation.isPending}
                          controls={false}
                        />
                      </Form.Item>
                    </Form>

                    {currentRate && (
                      <div className={styles.converterHint}>
                        <Text type="secondary">
                          当前汇率: 1 CNY = {parseFloat(currentRate.rate).toFixed(4)} RUB
                        </Text>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </Col>

            {/* 汇率趋势图 */}
            <Col xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    <LineChartOutlined />
                    <span>汇率趋势</span>
                  </Space>
                }
                extra={
                  <Segmented
                    options={[
                      { label: '今日', value: 'today' },
                      { label: '本周', value: 'week' },
                      { label: '本月', value: 'month' },
                    ]}
                    value={timeRange}
                    onChange={(value) => setTimeRange(value as 'today' | 'week' | 'month')}
                  />
                }
                className={styles.card}
              >
                {!config?.configured ? (
                  <Alert message="请先配置API" type="warning" showIcon />
                ) : historyLoading ? (
                  <div className={styles.spinContainer}>
                    <Spin />
                  </div>
                ) : history?.data && history.data.length > 0 ? (
                  <div className={styles.chartContainer}>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={history.data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tickFormatter={formatXAxis} />
                        <YAxis tickFormatter={(value) => value.toFixed(4)} />
                        <Tooltip formatter={(value: any) => [`${value.toFixed(6)}`, '汇率']} />
                        <Line
                          type="monotone"
                          dataKey="rate"
                          stroke="#1890ff"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Alert
                    message="暂无历史数据"
                    description="系统会在后台自动获取汇率数据，请稍后查看"
                    type="info"
                    showIcon
                  />
                )}
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    </div>
  );
};

export default ExchangeRateManagement;
