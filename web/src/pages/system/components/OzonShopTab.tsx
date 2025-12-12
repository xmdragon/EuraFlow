/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OZON店铺配置Tab
 * 从 pages/ozon/ShopSettings.tsx 迁移而来
 */
import {
  ShopOutlined,
  ApiOutlined,
  SaveOutlined,
  PlusOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Alert,
  Divider,
  Typography,
  Row,
  Col,
  Badge,
  Modal,
  App,
  Table,
  Tag,
  Tooltip,
  Spin,
} from 'antd';
import axios from 'axios';
import React, { useState, useEffect } from 'react';

import styles from './OzonShopTab.module.scss';

import { useAuth } from '@/hooks/useAuth';
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
}

const { Text, Title } = Typography;

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

const OzonShopTab: React.FC = () => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { canOperate, isAdmin } = usePermission();
  const [form] = Form.useForm();
  const [addForm] = Form.useForm();
  const [testingConnection, setTestingConnection] = useState(false);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [addShopModalVisible, setAddShopModalVisible] = useState(false);
  const [editShopModalVisible, setEditShopModalVisible] = useState(false);

  // 判断用户是否为操作员
  const isManager = user?.role === 'manager';
  const userShopIds = user?.shop_ids || [];

  // 获取店铺列表（包含完整信息，包括API凭证）
  const {
    data: shopsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['ozon', 'shops', 'full'],
    queryFn: () => ozonApi.getShops(true),  // include_stats=true 以获取完整信息
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
      addForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
    },
    onError: (error: unknown) => {
      // 解析错误信息
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
        },
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '店铺配置已保存');
      queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });
      setEditShopModalVisible(false);
      setSelectedShop(null);
      form.resetFields();
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

  // 当编辑弹窗打开且选择了店铺，设置表单值
  useEffect(() => {
    if (editShopModalVisible && selectedShop) {
      const formValues = {
        shop_name: selectedShop.shop_name,
        shop_name_cn: selectedShop.shop_name_cn,
        client_id: selectedShop.api_credentials?.client_id || '',
        api_key: selectedShop.api_credentials?.api_key || '',
        webhook_url: selectedShop.config?.webhook_url || '',
      };
      form.setFieldsValue(formValues);
    }
  }, [editShopModalVisible, selectedShop, form]);

  const handleSave = (values: OzonShopFormValues) => {
    if (!selectedShop) return;
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
    modal.confirm({
      title: '确认删除店铺？',
      content: `店铺名称: ${shop.shop_name_cn || shop.shop_name}`,
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await ozonApi.deleteShop(shop.id);

          notifySuccess('删除成功', '店铺已删除');
          queryClient.invalidateQueries({ queryKey: ['ozon', 'shops'] });

          if (selectedShop?.id === shop.id) {
            setSelectedShop(null);
          }
        } catch (error) {
          notifyError('删除失败', `删除失败: ${error.message}`);
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
        <div className={styles.loadingText}>加载店铺信息...</div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        message="加载失败"
        description={`无法加载店铺信息: ${error instanceof Error ? error.message : '未知错误'}`}
        type="error"
        showIcon
      />
    );
  }

  // 根据用户角色过滤店铺列表
  const allShops = shopsData?.data || [];
  const shops = isManager
    ? allShops.filter(shop => userShopIds.includes(shop.id))
    : allShops;

  return (
    <div className={styles.container}>
      {/* 店铺列表 */}
      <Card className={styles.shopListCard}>
        {isAdmin && (
          <div className={styles.addButtonRow}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddShop}>
              添加店铺
            </Button>
          </div>
        )}

        {shops.length === 0 ? (
          <div className={styles.emptyState}>
            <ShopOutlined className={styles.emptyIcon} />
            <Title level={5} type="secondary">
              暂无店铺
            </Title>
            <Text type="secondary" className={styles.emptyText}>
              {isManager
                ? '您还没有绑定任何Ozon店铺，请联系管理员进行绑定'
                : '您还没有添加任何Ozon店铺'}
              {isAdmin && '，点击上方"添加店铺"按钮开始配置'}
            </Text>
            {isAdmin && (
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
                      {record.shop_name_cn && <Text type="secondary"> [{record.shop_name_cn}]</Text>}
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
                              setEditShopModalVisible(true);
                            }}
                          >
                            编辑
                          </Button>
                          {isAdmin && (
                            <Button
                              type="link"
                              size="small"
                              danger
                              onClick={() => handleDeleteShop(record)}
                            >
                              删除
                            </Button>
                          )}
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Card>

      {/* 编辑店铺弹窗 */}
      <Modal
        title={`编辑店铺: ${selectedShop?.shop_name_cn || selectedShop?.shop_name || ''}`}
        open={editShopModalVisible}
        onCancel={() => {
          setEditShopModalVisible(false);
          setSelectedShop(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="shop_name"
                label="店铺名称（俄文）"
                rules={[{ required: true, message: '请输入店铺名称' }]}
              >
                <Input placeholder="请输入店铺名称（俄文）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shop_name_cn" label="店铺中文名称">
                <Input placeholder="请输入店铺中文名称（选填）" />
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
                rules={[
                  {
                    validator: (_, value) => {
                      // 编辑模式下，如果当前值是掩码或空值，不要求必填
                      if (!value || value === '******') {
                        return Promise.resolve();
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
                extra="出于安全考虑，保存后将显示为掩码。如需更新，直接输入新值即可；不修改则留空。"
              >
                <Input.Password placeholder="不修改则留空" />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Form.Item style={{ marginBottom: 0 }}>
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
              <Button
                onClick={() => {
                  setEditShopModalVisible(false);
                  setSelectedShop(null);
                  form.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 添加店铺弹窗 */}
      <Modal
        title="添加Ozon店铺"
        open={addShopModalVisible}
        onCancel={() => {
          setAddShopModalVisible(false);
          addForm.resetFields();
        }}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Form
          form={addForm}
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

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={addShopMutation.isPending}>
                确认添加
              </Button>
              <Button onClick={() => {
                setAddShopModalVisible(false);
                addForm.resetFields();
              }}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default OzonShopTab;
