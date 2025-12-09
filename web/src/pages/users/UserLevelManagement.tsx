import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import {
  Table,
  Button,
  Card,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  Tag,
  Typography,
  Tooltip,
  App,
} from 'antd';

const { Option } = Select;
import React, { useState, useEffect } from 'react';

import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

import type { ManagerLevel } from '@/types/auth';

interface FormValues {
  name: string;
  alias?: string;
  max_sub_accounts: number;
  max_shops: number;
  default_expiration_days: number;
  is_default: boolean;
  sort_order: number;
}

// 过期周期选项
const expirationOptions = [
  { label: '7天', value: 7 },
  { label: '1个月', value: 30 },
  { label: '3个月', value: 90 },
  { label: '1年', value: 365 },
  { label: '永不过期', value: 0 },
];

// 根据天数获取显示文本
const getExpirationLabel = (days: number): string => {
  const option = expirationOptions.find(opt => opt.value === days);
  return option?.label || `${days}天`;
};

const UserLevelManagement: React.FC = () => {
  const { modal } = App.useApp();
  const { user: currentUser } = useAuth();
  const [levels, setLevels] = useState<ManagerLevel[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingLevel, setEditingLevel] = useState<ManagerLevel | null>(null);
  const [form] = Form.useForm();

  // 获取级别列表
  const fetchLevels = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/manager-levels');
      setLevels(response.data);
    } catch (_error) {
      notifyError('获取失败', '获取用户级别列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      fetchLevels();
    }
  }, [currentUser?.role]);

  // 仅 admin 可访问
  if (currentUser?.role !== 'admin') {
    return (
      <div>
        <PageTitle icon={<CrownOutlined />} title="用户级别" />
        <Card style={{ textAlign: 'center' }}>
          <p>只有超级管理员可以管理级别配置</p>
        </Card>
      </div>
    );
  }

  // 创建/更新级别
  const handleSubmit = async (values: FormValues) => {
    try {
      if (editingLevel) {
        await axios.put(`/api/ef/v1/manager-levels/${editingLevel.id}`, values);
        notifySuccess('更新成功', '用户级别更新成功');
      } else {
        await axios.post('/api/ef/v1/manager-levels', values);
        notifySuccess('创建成功', '用户级别创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      fetchLevels();
    } catch (error) {
      let errorMsg = '操作失败';
      if (error.response?.data?.detail) {
        if (typeof error.response.data.detail === 'object') {
          errorMsg = error.response.data.detail.message || '操作失败';
        } else {
          errorMsg = error.response.data.detail;
        }
      }
      notifyError('操作失败', errorMsg);
    }
  };

  // 删除级别
  const handleDelete = async (levelId: number) => {
    try {
      await axios.delete(`/api/ef/v1/manager-levels/${levelId}`);
      notifySuccess('删除成功', '用户级别已删除');
      fetchLevels();
    } catch (error) {
      let errorMsg = '删除失败';
      if (error.response?.data?.detail) {
        if (typeof error.response.data.detail === 'object') {
          errorMsg = error.response.data.detail.message || '删除失败';
        } else {
          errorMsg = error.response.data.detail;
        }
      }
      notifyError('删除失败', errorMsg);
    }
  };

  // 打开编辑模态框
  const handleEdit = (level: ManagerLevel) => {
    setEditingLevel(level);
    form.setFieldsValue({
      name: level.name,
      alias: level.alias,
      max_sub_accounts: level.max_sub_accounts,
      max_shops: level.max_shops,
      default_expiration_days: level.default_expiration_days,
      is_default: level.is_default,
      sort_order: level.sort_order,
    });
    setModalVisible(true);
  };

  // 打开创建模态框
  const handleCreate = () => {
    setEditingLevel(null);
    form.resetFields();
    setModalVisible(true);
  };

  const columns = [
    {
      title: '级别名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ManagerLevel) => (
        <Space>
          {name}
          {record.is_default && <Tag color="gold">默认</Tag>}
        </Space>
      ),
    },
    {
      title: '显示别名',
      dataIndex: 'alias',
      key: 'alias',
      render: (alias: string | undefined) => alias || '-',
    },
    {
      title: '子账号限额',
      dataIndex: 'max_sub_accounts',
      key: 'max_sub_accounts',
      render: (max: number) => <Tag color="blue">{max}</Tag>,
    },
    {
      title: '店铺限额',
      dataIndex: 'max_shops',
      key: 'max_shops',
      render: (max: number) => <Tag color="green">{max}</Tag>,
    },
    {
      title: '默认有效期',
      dataIndex: 'default_expiration_days',
      key: 'default_expiration_days',
      render: (days: number) => (
        <Tag color={days === 0 ? 'default' : 'orange'}>
          {getExpirationLabel(days)}
        </Tag>
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ManagerLevel) => (
        <Space size="middle">
          <Tooltip title="编辑">
            <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                modal.confirm({
                  title: '确定要删除此级别吗？',
                  content: '如果有用户正在使用此级别，将无法删除',
                  okText: '确定',
                  cancelText: '取消',
                  onOk: () => handleDelete(record.id),
                });
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <PageTitle icon={<CrownOutlined />} title="用户级别" />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          添加级别
        </Button>
      </div>

      <Card bordered={false}>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          用户级别决定了管理员可以创建的子账号和店铺数量上限。创建新管理员时需要选择一个级别。
        </Typography.Text>
        <Table
          columns={columns}
          dataSource={levels}
          rowKey="id"
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingLevel ? '编辑级别' : '创建级别'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            max_sub_accounts: 5,
            max_shops: 10,
            default_expiration_days: 30,
            is_default: false,
            sort_order: 0,
          }}
        >
          <Form.Item
            name="name"
            label="级别名称"
            rules={[
              { required: true, message: '请输入级别名称' },
              { max: 50, message: '名称最多50个字符' },
            ]}
            tooltip="级别的唯一标识"
          >
            <Input placeholder="如: standard, premium" />
          </Form.Item>

          <Form.Item
            name="alias"
            label="显示别名"
            rules={[{ max: 50, message: '别名最多50个字符' }]}
            tooltip="用于界面显示的友好名称"
          >
            <Input placeholder="如: 标准管理员, 高级管理员" />
          </Form.Item>

          <Form.Item
            name="max_sub_accounts"
            label="子账号限额"
            rules={[{ required: true, message: '请输入子账号限额' }]}
            tooltip="此级别的管理员最多可创建的子账号数量"
          >
            <InputNumber min={0} max={1000} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="max_shops"
            label="店铺限额"
            rules={[{ required: true, message: '请输入店铺限额' }]}
            tooltip="此级别的管理员（含其子账号）最多可拥有的店铺数量"
          >
            <InputNumber min={0} max={1000} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="default_expiration_days"
            label="默认有效期"
            rules={[{ required: true, message: '请选择默认有效期' }]}
            tooltip="创建此级别的管理员时，默认设置的账号有效期"
          >
            <Select>
              {expirationOptions.map(opt => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="is_default"
            valuePropName="checked"
            label="设为默认级别"
            tooltip="新创建的管理员将默认使用此级别"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="sort_order"
            label="排序"
            tooltip="数字越小排序越靠前"
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingLevel ? '更新' : '创建'}
              </Button>
              <Button
                onClick={() => {
                  setModalVisible(false);
                  form.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UserLevelManagement;
