/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * Ozon 店铺设置页面
 */
import {
  ShopOutlined,
  KeyOutlined,
  ApiOutlined,
  SaveOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SettingOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Tabs,
  Switch,
  message,
  Alert,
  Divider,
  Select,
  InputNumber,
  Typography,
  Row,
  Col,
  Statistic,
  Badge,
  Modal,
  Table,
  Tag,
  Tooltip,
  Spin,
} from 'antd';
import React, { useState, useEffect } from 'react';

const { Title, Text, Paragraph } = Typography;
const { Option: _Option } = Select;
const { confirm } = Modal;

interface Shop {
  id: number;
  shop_name: string;
  platform: string;
  status: 'active' | 'inactive' | 'suspended';
  api_credentials?: {
    client_id: string;
    api_key: string;
  };
  config: {
    webhook_secret?: string;
    webhook_url?: string;
    sync_interval_minutes?: number;
    auto_sync_enabled?: boolean;
    rate_limits?: {
      products: number;
      orders: number;
      postings: number;
    };
    warehouse_mapping?: Array<{
      local_id: number;
      ozon_id: number;
      name: string;
    }>;
  };
  stats?: {
    total_products?: number;
    total_orders?: number;
    last_sync_at?: string;
    sync_status?: string;
  };
  created_at: string;
  updated_at: string;
}

const ShopSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [testingConnection, setTestingConnection] = useState(false);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [addShopModalVisible, setAddShopModalVisible] = useState(false);

  // 获取店铺列表
  const {
    data: shopsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['ozonShops'],
    queryFn: async () => {
      const response = await fetch('/api/ef/v1/ozon/shops', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch shops');
      }

      const data = await response.json();
      return data;
    },
  });

  // 添加店铺
  const addShopMutation = useMutation({
    mutationFn: async (values: any) => {
      const response = await fetch('/api/ef/v1/ozon/shops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_name: values.shop_name,
          platform: 'ozon',
          api_credentials: {
            client_id: values.client_id,
            api_key: values.api_key,
          },
          config: {},
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '添加店铺失败');
      }

      return response.json();
    },
    onSuccess: (data) => {
      message.success('店铺添加成功');
      setAddShopModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ozonShops'] });
      // 自动选择新添加的店铺
      setSelectedShop(data);
    },
    onError: (error: any) => {
      message.error(`添加失败: ${error.message}`);
    },
  });

  // 保存店铺配置
  const saveShopMutation = useMutation({
    mutationFn: async (values: any) => {
      if (!selectedShop) {
        throw new Error('请先选择要编辑的店铺');
      }

      const response = await fetch(`/api/ef/v1/ozon/shops/${selectedShop.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop_name: values.shop_name,
          status: 'active',
          api_credentials: {
            client_id: values.client_id,
            api_key: values.api_key,
          },
          config: {
            webhook_url: values.webhook_url || '',
            webhook_secret: values.webhook_secret || '',
            sync_interval_minutes: values.sync_interval_minutes || 30,
            auto_sync_enabled: values.auto_sync_enabled || false,
            rate_limits: {
              products: values.rate_limit_products || 10,
              orders: values.rate_limit_orders || 5,
              postings: values.rate_limit_postings || 20,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }

      return response.json();
    },
    onSuccess: (data) => {
      message.success('店铺配置已保存');
      queryClient.invalidateQueries({ queryKey: ['ozonShops'] });
      // 更新选中的店铺数据
      setSelectedShop(data);

      // 获取当前表单中的API KEY值（用户输入的）
      const currentApiKey = form.getFieldValue('api_key');

      // 更新表单值，但保留用户输入的API KEY（不用返回的掩码值）
      form.setFieldsValue({
        shop_name: data.shop_name,
        client_id: data.api_credentials?.client_id,
        // 如果用户输入了新的API KEY，保持显示；否则显示掩码
        api_key:
          currentApiKey && currentApiKey !== '******'
            ? currentApiKey
            : data.api_credentials?.api_key,
        webhook_secret: data.config?.webhook_secret,
        webhook_url: data.config?.webhook_url,
        sync_interval_minutes: data.config?.sync_interval_minutes,
        auto_sync_enabled: data.config?.auto_sync_enabled,
        rate_limit_products: data.config?.rate_limits?.products,
        rate_limit_orders: data.config?.rate_limits?.orders,
        rate_limit_postings: data.config?.rate_limits?.postings,
      });

      // 如果保存了新的API KEY，显示额外提示
      if (currentApiKey && currentApiKey !== '******') {
        message.info('API Key 已安全保存（出于安全考虑不显示真实值）');
      }
    },
    onError: (error: any) => {
      message.error(`保存失败: ${error.message}`);
    },
  });

  // 测试连接
  const testConnectionMutation = useMutation({
    mutationFn: async (shopId: number) => {
      setTestingConnection(true);

      const response = await fetch(`/api/ef/v1/ozon/shops/${shopId}/test-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || '连接测试失败');
      }

      if (!result.success) {
        throw new Error(result.message || '连接失败');
      }

      return result;
    },
    onSuccess: (data) => {
      if (data.success) {
        message.success(`连接测试成功！响应时间: ${data.details?.response_time_ms}ms`);
      } else {
        message.warning(data.message || '连接测试失败');
      }
      setTestingConnection(false);
    },
    onError: (error: any) => {
      message.error(`连接测试失败: ${error.message}`);
      setTestingConnection(false);
    },
  });

  // 选择店铺
  useEffect(() => {
    if (shopsData?.data?.[0] && !selectedShop) {
      const shop = shopsData.data[0];
      setSelectedShop(shop);
    }
  }, [shopsData, selectedShop]);

  // 当选择店铺后，设置表单值
  useEffect(() => {
    if (selectedShop) {
      form.setFieldsValue({
        shop_name: selectedShop.shop_name,
        client_id: selectedShop.api_credentials?.client_id,
        api_key: selectedShop.api_credentials?.api_key,
        webhook_secret: selectedShop.config?.webhook_secret,
        webhook_url: selectedShop.config?.webhook_url,
        sync_interval_minutes: selectedShop.config?.sync_interval_minutes,
        auto_sync_enabled: selectedShop.config?.auto_sync_enabled,
        rate_limit_products: selectedShop.config?.rate_limits?.products,
        rate_limit_orders: selectedShop.config?.rate_limits?.orders,
        rate_limit_postings: selectedShop.config?.rate_limits?.postings,
      });
    }
  }, [selectedShop, form]);

  const handleSave = (values: any) => {
    if (!selectedShop) return;

    // Pass the values directly to the mutation
    saveShopMutation.mutate(values);
  };

  const handleTestConnection = () => {
    if (!selectedShop) return;
    testConnectionMutation.mutate(selectedShop.id);
  };

  const handleAddShop = () => {
    setAddShopModalVisible(true);
  };

  const handleDeleteShop = (shop: Shop) => {
    confirm({
      title: '确认删除店铺？',
      content: `店铺名称: ${shop.shop_name}`,
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await fetch(`/api/ef/v1/ozon/shops/${shop.id}`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '删除失败');
          }

          message.success('店铺已删除');
          queryClient.invalidateQueries({ queryKey: ['ozonShops'] });

          // 如果删除的是当前选中的店铺，清空选择
          if (selectedShop?.id === shop.id) {
            setSelectedShop(null);
          }
        } catch (error: any) {
          message.error(`删除失败: ${error.message}`);
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 8 }}>加载店铺信息...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          message="加载失败"
          description={`无法加载店铺信息: ${error instanceof Error ? error.message : '未知错误'}`}
          type="error"
          showIcon
        />
      </div>
    );
  }

  const shops = shopsData?.data || [];

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <Title level={4}>
          <ShopOutlined /> Ozon 店铺管理
        </Title>

        {/* 店铺列表 */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddShop}>
              添加店铺
            </Button>
          </div>

          <Table
            dataSource={shops}
            rowKey="id"
            pagination={false}
            columns={[
              {
                title: '店铺名称',
                dataIndex: 'shop_name',
                key: 'shop_name',
                render: (text: string, record: Shop) => (
                  <Space>
                    <ShopOutlined />
                    <Text strong>{text}</Text>
                    {record.id === selectedShop?.id && <Tag color="blue">当前选中</Tag>}
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                render: (status) => {
                  const statusMap = {
                    active: { color: 'success', text: '活跃' },
                    inactive: { color: 'default', text: '未激活' },
                    suspended: { color: 'error', text: '已暂停' },
                  };
                  const config = statusMap[status as keyof typeof statusMap];
                  return <Badge status={config.color as any} text={config.text} />;
                },
              },
              {
                title: '商品数',
                key: 'products',
                render: (_: unknown, record: Shop) => record.stats?.total_products || 0,
              },
              {
                title: '订单数',
                key: 'orders',
                render: (_: unknown, record: Shop) => record.stats?.total_orders || 0,
              },
              {
                title: '最后同步',
                key: 'last_sync',
                render: (_: unknown, record: Shop) => {
                  if (!record.stats?.last_sync_at) return '-';
                  const date = new Date(record.stats.last_sync_at);
                  return (
                    <Tooltip title={date.toLocaleString()}>
                      <Space>
                        <ClockCircleOutlined />
                        {date.toLocaleTimeString()}
                      </Space>
                    </Tooltip>
                  );
                },
              },
              {
                title: '操作',
                key: 'action',
                render: (_: unknown, record: Shop) => (
                  <Space>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setSelectedShop(record);
                        form.setFieldsValue({
                          shop_name: record.shop_name,
                          client_id: record.api_credentials?.client_id,
                          api_key: record.api_credentials?.api_key,
                          webhook_secret: record.config?.webhook_secret,
                          webhook_url: record.config?.webhook_url,
                          sync_interval_minutes: record.config?.sync_interval_minutes,
                          auto_sync_enabled: record.config?.auto_sync_enabled,
                          rate_limit_products: record.config?.rate_limits?.products,
                          rate_limit_orders: record.config?.rate_limits?.orders,
                          rate_limit_postings: record.config?.rate_limits?.postings,
                        });
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      danger
                      onClick={() => handleDeleteShop(record)}
                    >
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>

        {selectedShop && (
          <>
            <Alert
              message={`当前编辑店铺: ${selectedShop.shop_name}`}
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            {/* 店铺统计 */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="商品总数"
                    value={selectedShop.stats?.total_products || 0}
                    prefix={<ShoppingOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="订单总数"
                    value={selectedShop.stats?.total_orders || 0}
                    prefix={<ShopOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="同步状态"
                    value={selectedShop.stats?.sync_status === 'success' ? '正常' : '异常'}
                    prefix={
                      selectedShop.stats?.sync_status === 'success' ? (
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      ) : (
                        <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                      )
                    }
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="API状态"
                    value={testingConnection ? '测试中...' : '已连接'}
                    prefix={<ApiOutlined />}
                  />
                </Card>
              </Col>
            </Row>

            <Form form={form} layout="vertical" onFinish={handleSave}>
              <Tabs
                defaultActiveKey="1"
                items={[
                  {
                    label: (
                      <span>
                        <KeyOutlined /> API配置
                      </span>
                    ),
                    key: '1',
                    children: (
                      <>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              name="shop_name"
                              label="店铺名称"
                              rules={[{ required: true, message: '请输入店铺名称' }]}
                            >
                              <Input placeholder="请输入店铺名称" />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              name="client_id"
                              label="Client ID"
                              rules={[{ required: true, message: '请输入Client ID' }]}
                            >
                              <Input placeholder="Ozon Client ID" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              name="api_key"
                              label="API Key"
                              rules={[{ required: true, message: '请输入API Key' }]}
                              extra="出于安全考虑，保存后将显示为掩码。如需更新，直接输入新值即可。"
                            >
                              <Input.Password placeholder="Ozon API Key" />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Form.Item>
                          <Button
                            type="primary"
                            icon={<ApiOutlined />}
                            onClick={handleTestConnection}
                            loading={testingConnection}
                          >
                            测试连接
                          </Button>
                        </Form.Item>

                        <Divider />

                        <Title level={5}>
                          Webhook配置
                          <Text type="secondary" style={{ fontSize: 14, marginLeft: 8 }}>
                            (可选 - 本地开发可跳过)
                          </Text>
                        </Title>

                        <Alert
                          message="本地开发提示"
                          description="Webhook 主要用于生产环境接收 Ozon 平台的实时推送通知。本地开发时可以不配置，系统会使用定时轮询方式同步数据。"
                          type="info"
                          showIcon
                          style={{ marginBottom: 16 }}
                        />

                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              name="webhook_url"
                              label="Webhook URL"
                              extra="用于接收Ozon推送的事件通知（可选）"
                            >
                              <Input placeholder="https://your-domain.com/webhooks/ozon（可留空）" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              name="webhook_secret"
                              label="Webhook Secret"
                              extra="用于验证Webhook请求签名（可选）"
                            >
                              <Input.Password placeholder="Webhook密钥（可留空）" />
                            </Form.Item>
                          </Col>
                        </Row>
                      </>
                    ),
                  },
                  {
                    label: (
                      <span>
                        <SyncOutlined /> 同步设置
                      </span>
                    ),
                    key: '2',
                    children: (
                      <>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              name="auto_sync_enabled"
                              label="自动同步"
                              valuePropName="checked"
                            >
                              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="sync_interval_minutes" label="同步间隔（分钟）">
                              <InputNumber min={5} max={1440} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider />

                        <Title level={5}>同步范围设置</Title>

                        <Row gutter={16}>
                          <Col span={8}>
                            <Form.Item label="商品同步">
                              <Switch
                                defaultChecked
                                checkedChildren="开启"
                                unCheckedChildren="关闭"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="订单同步">
                              <Switch
                                defaultChecked
                                checkedChildren="开启"
                                unCheckedChildren="关闭"
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="库存同步">
                              <Switch
                                defaultChecked
                                checkedChildren="开启"
                                unCheckedChildren="关闭"
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </>
                    ),
                  },
                  {
                    label: (
                      <span>
                        <SettingOutlined /> 高级设置
                      </span>
                    ),
                    key: '3',
                    children: (
                      <>
                        <Title level={5}>API限流设置</Title>
                        <Paragraph type="secondary">
                          设置每秒最大请求数，避免触发Ozon API限流
                        </Paragraph>

                        <Row gutter={16}>
                          <Col span={8}>
                            <Form.Item name="rate_limit_products" label="商品接口（req/s）">
                              <InputNumber min={1} max={100} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name="rate_limit_orders" label="订单接口（req/s）">
                              <InputNumber min={1} max={100} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name="rate_limit_postings" label="发货接口（req/s）">
                              <InputNumber min={1} max={100} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider />

                        <Title level={5}>仓库映射</Title>
                        <Paragraph type="secondary">配置本地仓库与Ozon仓库的对应关系</Paragraph>

                        <Table
                          dataSource={[]}
                          columns={[
                            { title: '本地仓库ID', dataIndex: 'local_id', key: 'local_id' },
                            { title: '本地仓库名称', dataIndex: 'local_name', key: 'local_name' },
                            { title: 'Ozon仓库ID', dataIndex: 'ozon_id', key: 'ozon_id' },
                            { title: 'Ozon仓库名称', dataIndex: 'ozon_name', key: 'ozon_name' },
                            {
                              title: '操作',
                              key: 'action',
                              render: () => (
                                <Space>
                                  <Button type="link" size="small" icon={<EditOutlined />}>
                                    编辑
                                  </Button>
                                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                                    删除
                                  </Button>
                                </Space>
                              ),
                            },
                          ]}
                          pagination={false}
                          size="small"
                        />

                        <Button
                          type="dashed"
                          style={{ marginTop: 16, width: '100%' }}
                          icon={<PlusOutlined />}
                        >
                          添加仓库映射
                        </Button>
                      </>
                    ),
                  },
                ]}
              />

              <Divider />

              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SaveOutlined />}
                    loading={saveShopMutation.isPending}
                  >
                    保存配置
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={() => form.resetFields()}>
                    重置
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </>
        )}
      </Card>

      {/* 添加店铺弹窗 */}
      <Modal
        title="添加Ozon店铺"
        open={addShopModalVisible}
        onCancel={() => setAddShopModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          layout="vertical"
          onFinish={(values) => {
            addShopMutation.mutate(values);
          }}
        >
          <Form.Item
            name="shop_name"
            label="店铺名称"
            rules={[{ required: true, message: '请输入店铺名称' }]}
          >
            <Input placeholder="请输入店铺名称" />
          </Form.Item>

          <Form.Item
            name="client_id"
            label="Client ID"
            rules={[{ required: true, message: '请输入Client ID' }]}
          >
            <Input placeholder="从Ozon后台获取的Client ID" />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入API Key' }]}
          >
            <Input.Password placeholder="从Ozon后台获取的API Key" />
          </Form.Item>

          <Alert
            message="获取API凭据"
            description={
              <div>
                <p>1. 登录Ozon Seller后台</p>
                <p>2. 进入"设置" → "API密钥"</p>
                <p>3. 创建新的API密钥并复制Client ID和API Key</p>
                <p>4. 请妥善保管API密钥，它将用于访问您的店铺数据</p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={addShopMutation.isPending}>
                确认添加
              </Button>
              <Button onClick={() => setAddShopModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ShopSettings;
