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
  SettingOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  TruckOutlined,
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
  Alert,
  Divider,
  Select,
  InputNumber,
  Typography,
  Row,
  Col,
  Badge,
  Modal,
  Table,
  Tag,
  Tooltip,
  Spin,
} from 'antd';
import React, { useState, useEffect } from 'react';

import styles from './ShopSettings.module.scss';

import Kuajing84Configuration from '@/components/ozon/shop/Kuajing84Configuration';
import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';

const { Text, Paragraph, Title } = Typography;
const { confirm } = Modal;

interface Shop {
  id: number;
  shop_name: string;
  shop_name_cn?: string;
  platform: string;
  status: 'active' | 'inactive' | 'suspended';
  api_credentials?: {
    client_id: string;
    api_key: string;
  };
  config: {
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
  const { canOperate, canSync } = usePermission();
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
    queryKey: ['ozon', 'shops'],
    queryFn: ozonApi.getShops,
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
  });

  // 添加店铺
  const addShopMutation = useMutation({
    mutationFn: async (values: any) => {
      return ozonApi.createShop({
        name: values.shop_name,
        shop_name_cn: values.shop_name_cn,
        client_id: values.client_id,
        api_key: values.api_key,
        platform: 'ozon',
        config: {},
      });
    },
    onSuccess: (data) => {
      notifySuccess('添加成功', '店铺添加成功');
      setAddShopModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
      // 自动选择新添加的店铺
      setSelectedShop(data);
    },
    onError: (error: any) => {
      notifyError('添加失败', `添加失败: ${error.message}`);
    },
  });

  // 保存店铺配置
  const saveShopMutation = useMutation({
    mutationFn: async (values: any) => {
      if (!selectedShop) {
        throw new Error('请先选择要编辑的店铺');
      }

      return ozonApi.updateShop(selectedShop.id, {
        shop_name: values.shop_name,
        shop_name_cn: values.shop_name_cn,
        status: 'active',
        api_credentials: {
          client_id: values.client_id,
          api_key: values.api_key,
        },
        config: {
          webhook_url: values.webhook_url || '',
          sync_interval_minutes: values.sync_interval_minutes || 30,
          auto_sync_enabled: values.auto_sync_enabled || false,
          rate_limits: {
            products: values.rate_limit_products || 10,
            orders: values.rate_limit_orders || 5,
            postings: values.rate_limit_postings || 20,
          },
        },
      });
    },
    onSuccess: (data) => {
      notifySuccess('保存成功', '店铺配置已保存');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
      // 更新选中的店铺数据
      setSelectedShop(data);

      // 获取当前表单中的API KEY值（用户输入的）
      const currentApiKey = form.getFieldValue('api_key');

      // 更新表单值，但保留用户输入的API KEY（不用返回的掩码值）
      form.setFieldsValue({
        shop_name: data.shop_name,
        shop_name_cn: data.shop_name_cn,
        client_id: data.api_credentials?.client_id,
        // 如果用户输入了新的API KEY，保持显示；否则显示掩码
        api_key:
          currentApiKey && currentApiKey !== '******'
            ? currentApiKey
            : data.api_credentials?.api_key,
        webhook_url: data.config?.webhook_url,
        sync_interval_minutes: data.config?.sync_interval_minutes,
        auto_sync_enabled: data.config?.auto_sync_enabled,
        rate_limit_products: data.config?.rate_limits?.products,
        rate_limit_orders: data.config?.rate_limits?.orders,
        rate_limit_postings: data.config?.rate_limits?.postings,
      });

      // 如果保存了新的API KEY，显示额外提示
      if (currentApiKey && currentApiKey !== '******') {
        notifyInfo('提示', 'API Key 已安全保存（出于安全考虑不显示真实值）');
      }
    },
    onError: (error: any) => {
      notifyError('保存失败', `保存失败: ${error.message}`);
    },
  });

  // 测试连接
  const testConnectionMutation = useMutation({
    mutationFn: async (shopId: number) => {
      setTestingConnection(true);
      const result = await ozonApi.testShopConnection(shopId);

      if (!result.success) {
        throw new Error(result.message || '连接失败');
      }

      return result;
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('测试成功', `连接测试成功！响应时间: ${data.details?.response_time_ms}ms`);
      } else {
        notifyWarning('测试失败', data.message || '连接测试失败');
      }
      setTestingConnection(false);
    },
    onError: (error: any) => {
      notifyError('测试失败', `连接测试失败: ${error.message}`);
      setTestingConnection(false);
    },
  });

  // 批量同步所有店铺仓库
  const syncAllWarehousesMutation = useMutation({
    mutationFn: async () => {
      return ozonApi.syncAllWarehouses();
    },
    onSuccess: (data) => {
      if (data.success) {
        const { total_shops, success_count, failed_count, total_warehouses } = data.data;
        notifySuccess(
          '同步成功',
          `批量同步完成！共${total_shops}个店铺，成功${success_count}个，失败${failed_count}个，同步了${total_warehouses}个仓库`
        );
      } else {
        notifyWarning('同步失败', data.message || '同步失败');
      }
    },
    onError: (error: any) => {
      notifyError('同步失败', `同步失败: ${error.response?.data?.detail || error.message}`);
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
        shop_name_cn: selectedShop.shop_name_cn,
        client_id: selectedShop.api_credentials?.client_id,
        api_key: selectedShop.api_credentials?.api_key,
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
      content: `店铺名称: ${shop.shop_name_cn || shop.shop_name}`,
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await ozonApi.deleteShop(shop.id);

          notifySuccess('删除成功', '店铺已删除');
          queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });

          // 如果删除的是当前选中的店铺，清空选择
          if (selectedShop?.id === shop.id) {
            setSelectedShop(null);
          }
        } catch (error: any) {
          notifyError('删除失败', `删除失败: ${error.message}`);
        }
      },
    });
  };

  if (isLoading) {
    return (
      <Card className={styles.loadingCard}>
        <Spin size="large" />
        <div className={styles.loadingText}>加载店铺信息...</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={styles.errorCard}>
        <Alert
          message="加载失败"
          description={`无法加载店铺信息: ${error instanceof Error ? error.message : '未知错误'}`}
          type="error"
          showIcon
        />
      </Card>
    );
  }

  const shops = shopsData?.data || [];

  return (
    <div>
      {/* 页面标题 */}
      <PageTitle icon={<ShopOutlined />} title="Ozon 店铺管理" />

      <Card className={styles.mainCard}>
        {/* 店铺列表 */}
        <Card className={styles.shopListCard}>
          {canOperate && (
            <div className={styles.addButtonRow}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddShop}>
                添加店铺
              </Button>
              {canSync && (
                <Button
                  icon={<TruckOutlined />}
                  loading={syncAllWarehousesMutation.isPending}
                  onClick={() => syncAllWarehousesMutation.mutate()}
                >
                  同步所有店铺仓库
                </Button>
              )}
            </div>
          )}

          {shops.length === 0 ? (
            <div className={styles.emptyState}>
              <ShopOutlined className={styles.emptyIcon} />
              <Title level={5} type="secondary">
                暂无店铺
              </Title>
              <Text type="secondary" className={styles.emptyText}>
                您还没有添加任何Ozon店铺
                {canOperate && '，点击上方"添加店铺"按钮开始配置'}
              </Text>
              {canOperate && (
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAddShop}>
                  立即添加店铺
                </Button>
              )}
            </div>
          ) : (
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
                      <Text strong>
                        {text}
                        {record.shop_name_cn && (
                          <Text type="secondary"> [{record.shop_name_cn}]</Text>
                        )}
                      </Text>
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
                ...(canOperate
                  ? [
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
                                  shop_name_cn: record.shop_name_cn,
                                  client_id: record.api_credentials?.client_id,
                                  api_key: record.api_credentials?.api_key,
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
                    ]
                  : []),
              ]}
            />
          )}
        </Card>

        {selectedShop && (
          <>
            <Alert
              message={`当前编辑店铺: ${selectedShop.shop_name}`}
              type="info"
              showIcon
              className={styles.currentShopAlert}
            />

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
                      <div className={styles.contentContainer}>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              name="shop_name"
                              label="店铺名称（俄文）"
                              rules={[{ required: true, message: '请输入店铺名称' }]}
                            >
                              <Input
                                placeholder="请输入店铺名称（俄文）"
                                className={styles.nameInput}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="shop_name_cn" label="店铺中文名称">
                              <Input
                                placeholder="请输入店铺中文名称（选填）"
                                className={styles.nameInput}
                              />
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
                              <Input placeholder="Ozon Client ID" className={styles.apiInput} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              name="api_key"
                              label="API Key"
                              rules={[{ required: true, message: '请输入API Key' }]}
                              extra="出于安全考虑，保存后将显示为掩码。如需更新，直接输入新值即可。"
                            >
                              <Input.Password
                                placeholder="Ozon API Key"
                                className={styles.apiInput}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
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
                      <div className={styles.contentContainer}>
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
                              <InputNumber
                                min={5}
                                max={1440}
                                className={styles.apiInput}
                                controls={false}
                              />
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
                      </div>
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
                      <div className={styles.contentContainer}>
                        <Title level={5}>API限流设置</Title>
                        <Paragraph type="secondary">
                          设置每秒最大请求数，避免触发Ozon API限流
                        </Paragraph>

                        <Row gutter={16}>
                          <Col span={8}>
                            <Form.Item name="rate_limit_products" label="商品接口（req/s）">
                              <InputNumber
                                min={1}
                                max={100}
                                className={styles.apiInput}
                                controls={false}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name="rate_limit_orders" label="订单接口（req/s）">
                              <InputNumber
                                min={1}
                                max={100}
                                className={styles.apiInput}
                                controls={false}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name="rate_limit_postings" label="发货接口（req/s）">
                              <InputNumber
                                min={1}
                                max={100}
                                className={styles.apiInput}
                                controls={false}
                              />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider />

                        <Title level={5}>仓库映射</Title>
                        <Paragraph type="secondary">配置本地仓库与Ozon仓库的对应关系</Paragraph>

                        <Table
                          dataSource={[]}
                          columns={[
                            {
                              title: '本地仓库ID',
                              dataIndex: 'local_id',
                              key: 'local_id',
                            },
                            {
                              title: '本地仓库名称',
                              dataIndex: 'local_name',
                              key: 'local_name',
                            },
                            {
                              title: 'Ozon仓库ID',
                              dataIndex: 'ozon_id',
                              key: 'ozon_id',
                            },
                            {
                              title: 'Ozon仓库名称',
                              dataIndex: 'ozon_name',
                              key: 'ozon_name',
                            },
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
                          className={styles.warehouseButton}
                          icon={<PlusOutlined />}
                        >
                          添加仓库映射
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />

              <Divider />

              {canOperate && (
                <Form.Item>
                  <Space>
                    <Button
                      icon={<ApiOutlined />}
                      onClick={handleTestConnection}
                      loading={testingConnection}
                    >
                      测试连接
                    </Button>
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
              )}
            </Form>
          </>
        )}

        {/* 跨境巴士全局配置 */}
        <Divider />
        <Card className={styles.globalConfigCard}>
          <Title level={4}>
            <TruckOutlined /> 跨境巴士全局配置
          </Title>
          <Alert
            message="全局配置说明"
            description="跨境巴士配置为全局设置，配置一次后所有店铺的订单都可以使用该账号进行物流同步。配置与具体店铺无关。"
            type="warning"
            showIcon
            className={styles.globalConfigAlert}
          />
          <Kuajing84Configuration />
        </Card>
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
            label="店铺名称（俄文）"
            rules={[{ required: true, message: '请输入店铺名称' }]}
          >
            <Input placeholder="请输入店铺名称（俄文）" className={styles.nameInput} />
          </Form.Item>

          <Form.Item name="shop_name_cn" label="店铺中文名称">
            <Input placeholder="请输入店铺中文名称（选填）" className={styles.nameInput} />
          </Form.Item>

          <Form.Item
            name="client_id"
            label="Client ID"
            rules={[{ required: true, message: '请输入Client ID' }]}
          >
            <Input placeholder="从Ozon后台获取的Client ID" className={styles.apiInput} />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入API Key' }]}
          >
            <Input.Password placeholder="从Ozon后台获取的API Key" className={styles.apiInput} />
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
            className={styles.modalAlert}
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
