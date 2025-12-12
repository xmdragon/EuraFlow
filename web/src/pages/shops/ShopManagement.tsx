/**
 * 店铺列表页面
 * - 管理员：可以查看所有店铺，包括子账号创建的店铺
 * - 管理员/子账号：可以管理自己创建的店铺
 * - 子账号：可以查看有权限的店铺，但不能编辑
 */
import {
  ShopOutlined,
  ApiOutlined,
  SaveOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  UserOutlined,
  LockOutlined,
  TruckOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Alert,
  Typography,
  Badge,
  Modal,
  App,
  Table,
  Tag,
  Tooltip,
  Spin,
  Checkbox,
} from 'antd';
import axios from 'axios';
import React, { useState } from 'react';

import styles from './ShopManagement.module.scss';

import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

// OZON店铺表单值接口
interface OzonShopFormValues {
  shop_name?: string;
  shop_name_cn?: string;
  client_id?: string;
  api_key?: string;
  webhook_url?: string;
  shipping_managed?: boolean;  // 发货托管
}

const { Text, Title } = Typography;

interface Shop {
  id: number;
  shop_name: string;
  shop_name_cn?: string;
  platform: string;
  status: 'active' | 'inactive' | 'suspended';
  shipping_managed?: boolean;  // 发货托管
  owner_user_id?: number;
  owner_username?: string;
  can_edit?: boolean;  // 是否可编辑（自己创建的店铺）
  api_credentials?: {
    client_id: string;
    api_key: string;
  };
  config: {
    webhook_url?: string;
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

const ShopManagement: React.FC = () => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermission();
  const [editForm] = Form.useForm();
  const [testingConnection, setTestingConnection] = useState(false);
  const [addShopModalVisible, setAddShopModalVisible] = useState(false);
  const [editShopModalVisible, setEditShopModalVisible] = useState(false);
  const [editingShop, setEditingShop] = useState<Shop | null>(null);

  // 获取店铺列表（包含完整信息，包括API凭证和所有者信息）
  const {
    data: shopsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['shops', 'management'],
    queryFn: () => ozonApi.getShopsForManagement(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // 添加店铺
  const addShopMutation = useMutation({
    mutationFn: async (values: OzonShopFormValues) => {
      return ozonApi.createShop({
        shop_name: values.shop_name,
        shop_name_cn: values.shop_name_cn,
        client_id: values.client_id,
        api_key: values.api_key,
        platform: 'ozon',
        config: {},
      });
    },
    onSuccess: () => {
      notifySuccess('添加成功', '店铺添加成功');
      setAddShopModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['shops'] });
      queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
    },
    onError: (error: unknown) => {
      let errorMsg = '添加失败';
      if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        errorMsg = data?.error?.detail?.message
          || data?.error?.title?.message
          || data?.detail?.message
          || data?.detail
          || data?.message
          || error.message
          || '添加失败';
      } else if (error instanceof Error) {
        errorMsg = error.message;
      }
      notifyError('添加失败', errorMsg);
    },
  });

  // 保存店铺配置
  const saveShopMutation = useMutation({
    mutationFn: async (values: OzonShopFormValues) => {
      if (!editingShop) {
        throw new Error('请先选择要编辑的店铺');
      }

      return ozonApi.updateShop(editingShop.id, {
        shop_name: values.shop_name,
        shop_name_cn: values.shop_name_cn,
        status: 'active',
        shipping_managed: values.shipping_managed,
        api_credentials: {
          client_id: values.client_id,
          api_key: values.api_key,
        },
        config: {
          webhook_url: values.webhook_url || '',
        },
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '店铺配置已保存');
      queryClient.invalidateQueries({ queryKey: ['shops'] });
      queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
      setEditShopModalVisible(false);
      setEditingShop(null);
      editForm.resetFields();
    },
    onError: (error: Error) => {
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
    onError: (error: Error) => {
      notifyError('测试失败', `连接测试失败: ${error.message}`);
      setTestingConnection(false);
    },
  });

  const handleSave = (values: OzonShopFormValues) => {
    if (!editingShop) return;
    saveShopMutation.mutate(values);
  };

  const handleTestConnection = () => {
    if (!editingShop) return;
    testConnectionMutation.mutate(editingShop.id);
  };

  const handleEditShop = (shop: Shop) => {
    setEditingShop(shop);
    editForm.setFieldsValue({
      shop_name: shop.shop_name,
      shop_name_cn: shop.shop_name_cn,
      client_id: shop.api_credentials?.client_id || '',
      api_key: shop.api_credentials?.api_key || '',
      shipping_managed: shop.shipping_managed || false,
    });
    setEditShopModalVisible(true);
  };

  const handleAddShop = () => {
    setAddShopModalVisible(true);
  };

  const handleDeleteShop = (shop: Shop) => {
    modal.confirm({
      title: '确认删除店铺？',
      content: `店铺名称: ${shop.shop_name_cn || shop.shop_name}`,
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await ozonApi.deleteShop(shop.id);

          notifySuccess('删除成功', '店铺已删除');
          queryClient.invalidateQueries({ queryKey: ['shops'] });
          queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
        } catch (error: unknown) {
          const err = error as Error;
          notifyError('删除失败', `删除失败: ${err.message}`);
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div className={styles.pageWrapper}>
        <PageTitle icon={<ShopOutlined />} title="店铺列表" />
        <div className={styles.loadingContainer}>
          <Spin size="large" />
          <div className={styles.loadingText}>加载店铺信息...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pageWrapper}>
        <PageTitle icon={<ShopOutlined />} title="店铺列表" />
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
    <div className={styles.pageWrapper}>
      <PageTitle icon={<ShopOutlined />} title="店铺列表" />

      {/* 店铺列表 */}
      <Card className={styles.shopListCard}>
        <div className={styles.addButtonRow}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddShop}>
            添加店铺
          </Button>
        </div>

        {shops.length === 0 ? (
          <div className={styles.emptyState}>
            <ShopOutlined className={styles.emptyIcon} />
            <Title level={5} type="secondary">
              暂无店铺
            </Title>
            <Text type="secondary" className={styles.emptyText}>
              您还没有添加任何Ozon店铺，点击上方"添加店铺"按钮开始配置
            </Text>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddShop}>
              立即添加店铺
            </Button>
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
                      {record.shop_name_cn && <Text type="secondary"> [{record.shop_name_cn}]</Text>}
                    </Text>
                    {!record.can_edit && (
                      <Tooltip title="此店铺由其他用户创建，您只有查看权限">
                        <Tag icon={<LockOutlined />} color="default">只读</Tag>
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
              // 管理员可见创建者列
              ...(isAdmin
                ? [
                    {
                      title: '创建者',
                      dataIndex: 'owner_username',
                      key: 'owner_username',
                      width: 120,
                      render: (username: string) => (
                        <Space>
                          <UserOutlined />
                          <Text>{username || '-'}</Text>
                        </Space>
                      ),
                    },
                  ]
                : []),
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 100,
                render: (status: string) => {
                  const statusMap: Record<string, { color: string; text: string }> = {
                    active: { color: 'success', text: '活跃' },
                    inactive: { color: 'default', text: '未激活' },
                    suspended: { color: 'error', text: '已暂停' },
                  };
                  const config = statusMap[status] || { color: 'default', text: status };
                  return <Badge status={config.color as 'success' | 'default' | 'error'} text={config.text} />;
                },
              },
              {
                title: '发货托管',
                dataIndex: 'shipping_managed',
                key: 'shipping_managed',
                width: 100,
                render: (managed: boolean) => (
                  managed ? (
                    <Tag icon={<TruckOutlined />} color="blue">已启用</Tag>
                  ) : (
                    <Tag color="default">未启用</Tag>
                  )
                ),
              },
              {
                title: '最后同步',
                key: 'last_sync',
                width: 140,
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
                width: 150,
                render: (_: unknown, record: Shop) => (
                  <Space>
                    {record.can_edit ? (
                      <>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => handleEditShop(record)}
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
                      </>
                    ) : (
                      <Text type="secondary">-</Text>
                    )}
                  </Space>
                ),
              },
            ]}
          />
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
            label="店铺名称（俄文）"
            rules={[{ required: true, message: '请输入店铺名称' }]}
          >
            <Input placeholder="请输入店铺名称（俄文）" />
          </Form.Item>

          <Form.Item name="shop_name_cn" label="店铺中文名称">
            <Input placeholder="请输入店铺中文名称（选填）" />
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

      {/* 编辑店铺弹窗 */}
      <Modal
        title={`编辑店铺: ${editingShop?.shop_name_cn || editingShop?.shop_name || ''}`}
        open={editShopModalVisible}
        onCancel={() => {
          setEditShopModalVisible(false);
          setEditingShop(null);
          editForm.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleSave}
        >
          <Form.Item
            name="shop_name"
            label="店铺名称（俄文）"
            rules={[{ required: true, message: '请输入店铺名称' }]}
          >
            <Input placeholder="请输入店铺名称（俄文）" />
          </Form.Item>

          <Form.Item name="shop_name_cn" label="店铺中文名称">
            <Input placeholder="请输入店铺中文名称（选填）" />
          </Form.Item>

          <Form.Item
            name="client_id"
            label="Client ID"
            rules={[{ required: true, message: '请输入Client ID' }]}
          >
            <Input placeholder="Ozon Client ID" />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[
              {
                validator: (_, value) => {
                  if (editingShop && (!value || value === '******')) {
                    return Promise.resolve();
                  }
                  if (!value) {
                    return Promise.reject(new Error('请输入API Key'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            extra="出于安全考虑，保存后将显示为掩码。如需更新，直接输入新值即可；不修改则留空。"
          >
            <Input.Password placeholder="不修改则留空" />
          </Form.Item>

          <Form.Item
            name="shipping_managed"
            valuePropName="checked"
          >
            <Checkbox>
              <Space>
                <TruckOutlined />
                <span>启用发货托管</span>
              </Space>
            </Checkbox>
          </Form.Item>
          <Alert
            message="发货托管说明"
            description="启用后，发货员角色可以在「扫描单号」页面看到并操作该店铺的订单。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item>
            <Space>
              <Button icon={<ApiOutlined />} onClick={handleTestConnection} loading={testingConnection}>
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
              <Button onClick={() => {
                setEditShopModalVisible(false);
                setEditingShop(null);
                editForm.resetFields();
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ShopManagement;
