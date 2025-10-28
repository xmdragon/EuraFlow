/* eslint-disable no-unused-vars */
/**
 * API Key管理Tab
 * 从 pages/ozon/ApiKeys.tsx 迁移而来
 */
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SafetyOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Typography,
  Alert,
  Popconfirm,
  Tooltip,
  Empty,
} from 'antd';
import React, { useState, useEffect } from 'react';

import {
  listAPIKeys,
  createAPIKey,
  deleteAPIKey,
  regenerateAPIKey,
  APIKey,
  CreateAPIKeyRequest,
} from '@/services/apiKeyService';

import styles from './ApiKeysTab.module.scss';

import { useCopy } from '@/hooks/useCopy';
import { usePermission } from '@/hooks/usePermission';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;
const { Option } = Select;

const ApiKeysTab: React.FC = () => {
  const { canOperate } = usePermission();
  const { copyToClipboard } = useCopy();
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [keyModalVisible, setKeyModalVisible] = useState(false);
  const [newKeyData, setNewKeyData] = useState<{
    key: string;
    name: string;
  } | null>(null);
  const [form] = Form.useForm();

  // 加载API Keys
  const loadKeys = async () => {
    try {
      setLoading(true);
      const data = await listAPIKeys();
      setKeys(data);
    } catch (error) {
      notifyError('加载失败', '加载失败: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  // 创建API Key
  const handleCreate = async (values: CreateAPIKeyRequest) => {
    try {
      const result = await createAPIKey(values);
      setNewKeyData({ key: result.key, name: result.name });
      setKeyModalVisible(true);
      setCreateModalVisible(false);
      form.resetFields();
      loadKeys();
      notifySuccess('创建成功', 'API Key创建成功');
    } catch (error) {
      notifyError('创建失败', '创建失败: ' + (error.response?.data?.message || error.message));
    }
  };

  // 删除API Key
  const handleDelete = async (keyId: number, _name: string) => {
    try {
      await deleteAPIKey(keyId);
      loadKeys();
      notifySuccess('删除成功', 'API Key已删除');
    } catch (error) {
      notifyError('删除失败', '删除失败: ' + (error.response?.data?.message || error.message));
    }
  };

  // 重新生成API Key
  const handleRegenerate = async (keyId: number, _name: string) => {
    try {
      const result = await regenerateAPIKey(keyId);
      setNewKeyData({ key: result.key, name: result.name });
      setKeyModalVisible(true);
      loadKeys();
      notifySuccess('重新生成成功', 'API Key已重新生成');
    } catch (error) {
      notifyError(
        '重新生成失败',
        '重新生成失败: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  // 判断是否过期
  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  // 表格列定义
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions: string[]) => (
        <>
          {permissions.map((perm) => (
            <Tag key={perm}>{perm}</Tag>
          ))}
        </>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (_, record: APIKey) => {
        if (record.is_active && !isExpired(record.expires_at)) {
          return <Tag color="success">激活</Tag>;
        } else if (isExpired(record.expires_at)) {
          return <Tag color="error">已过期</Tag>;
        } else {
          return <Tag>已禁用</Tag>;
        }
      },
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      key: 'last_used_at',
      render: (date: string) => formatDate(date),
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (date: string | null, _record: APIKey) => {
        if (!date) return <Text type="secondary">永不过期</Text>;
        return <Text type={isExpired(date) ? 'danger' : undefined}>{formatDate(date)}</Text>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => formatDate(date),
    },
    ...(canOperate
      ? [
          {
            title: '操作',
            key: 'actions',
            render: (_, record: APIKey) => (
              <Space size="small">
                <Tooltip title="重新生成">
                  <Popconfirm
                    title="确定要重新生成吗？"
                    description="旧的Key将立即失效"
                    onConfirm={() => handleRegenerate(record.id, record.name)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button type="link" icon={<ReloadOutlined />} size="small">
                      重新生成
                    </Button>
                  </Popconfirm>
                </Tooltip>
                <Tooltip title="删除">
                  <Popconfirm
                    title="确定要删除吗？"
                    description="此操作不可恢复"
                    onConfirm={() => handleDelete(record.id, record.name)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button type="link" danger icon={<DeleteOutlined />} size="small">
                      删除
                    </Button>
                  </Popconfirm>
                </Tooltip>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className={styles.container}>
      {/* 顶部说明和操作 */}
      <div className={styles.header}>
        <Text type="secondary">用于Tampermonkey脚本等外部工具的身份认证</Text>
        {canOperate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            创建API Key
          </Button>
        )}
      </div>

      {/* API地址显示 */}
      <Card className={styles.apiInfoCard}>
        <div className={styles.apiRow}>
          <div>
            <Text strong className={styles.apiLabel}>
              📡 API 地址：
            </Text>
            <Text code className={styles.apiAddress}>
              {window.location.origin}
            </Text>
            <CopyOutlined
              style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
              onClick={() => copyToClipboard(window.location.origin, 'API地址')}
            />
          </div>
        </div>
        <Text type="secondary" className={styles.apiHint}>
          在 Tampermonkey 脚本中填写此地址和下方创建的 API Key
        </Text>
      </Card>

      {/* 使用提示 */}
      <Alert
        message="使用说明"
        description={
          <ol className={styles.usageList}>
            <li>点击"创建API Key"生成新密钥，立即复制保存（仅显示一次）</li>
            <li>在 Ozon 网站打开 Tampermonkey 脚本控制面板，展开"⚙️ API设置"</li>
            <li>
              填写上方的 <strong>API 地址</strong> 和刚才复制的 <strong>API Key</strong>
            </li>
            <li>点击"测试连接"验证配置，然后即可使用自动上传功能</li>
            <li>如果 Key 泄露，请立即删除或重新生成</li>
          </ol>
        }
        type="info"
        showIcon
        icon={<SafetyOutlined />}
        className={styles.usageAlert}
      />

      {/* API Keys列表 */}
      <Card className={styles.listCard}>
        <Table
          dataSource={keys}
          columns={columns}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: <Empty description='还没有API Key，点击上方"创建API Key"按钮开始创建' />,
          }}
        />
      </Card>

      {/* 创建对话框 */}
      <Modal
        title="创建API Key"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Alert
          message="重要提示"
          description="API Key仅在创建时显示一次，请务必复制保存！"
          type="warning"
          showIcon
          className={styles.modalAlert}
        />
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{
            permissions: ['product_selection:write'],
            expires_in_days: undefined,
          }}
        >
          <Form.Item
            label="Key名称"
            name="name"
            rules={[{ required: true, message: '请输入Key名称' }]}
          >
            <Input placeholder="例如：Tampermonkey脚本" />
          </Form.Item>

          <Form.Item label="过期时间" name="expires_in_days">
            <Select placeholder="选择过期时间" allowClear>
              <Option value={30}>30天</Option>
              <Option value={90}>90天</Option>
              <Option value={180}>180天</Option>
              <Option value={365}>365天</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                onClick={() => {
                  setCreateModalVisible(false);
                  form.resetFields();
                }}
              >
                取消
              </Button>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 显示新Key对话框 */}
      <Modal
        title={`API Key: ${newKeyData?.name || ''}`}
        open={keyModalVisible}
        onCancel={() => setKeyModalVisible(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setKeyModalVisible(false)}>
            我已保存
          </Button>,
        ]}
        width={700}
      >
        <Alert
          message="请立即复制并保存！"
          description="此Key将仅显示一次，关闭后无法再次查看。"
          type="warning"
          showIcon
          className={styles.modalAlert}
        />
        <div className={styles.keyDisplay}>
          <Text code>{newKeyData?.key}</Text>
          <CopyOutlined
            style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff', fontSize: 16 }}
            onClick={() => copyToClipboard(newKeyData?.key || '', 'API Key')}
          />
        </div>
      </Modal>
    </div>
  );
};

export default ApiKeysTab;
