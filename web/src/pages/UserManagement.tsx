import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Table,
  Button,
  Card,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Tag,
  Typography,
  Tooltip,
  Popconfirm,
} from 'antd';
import React, { useState, useEffect } from 'react';

import styles from './UserManagement.module.scss';

import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Option } = Select;

interface User {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  parent_user_id?: number;
  shop_ids?: number[];
  created_at: string;
}

interface Shop {
  id: number;
  name: string;
  platform: string;
}

interface CreateUserData {
  username: string;
  password: string;
  role: string;
  is_active: boolean;
}

const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  // 检查是否为管理员
  if (currentUser?.role !== 'admin') {
    return (
      <div>
        <PageTitle icon={<UserOutlined />} title="用户管理" />
        <Card style={{ textAlign: 'center' }}>
          <p>只有管理员可以访问用户管理页面</p>
        </Card>
      </div>
    );
  }

  // 获取用户列表
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/auth/users');
      setUsers(response.data);
    } catch (error) {
      notifyError('获取失败', '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取店铺列表
  const fetchShops = async () => {
    try {
      const response = await axios.get('/api/ef/v1/ozon/shops');
      // API返回格式: { data: [...] }，显示格式：俄文 [中文]
      const shopsData = (response.data.data || []).map((shop: any) => ({
        id: shop.id,
        name: shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : ''),
        platform: shop.platform,
      }));
      setShops(shopsData);
    } catch (error) {
      notifyError('获取失败', '获取店铺列表失败');
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchShops();
  }, []);

  // 创建/更新用户
  const handleSubmit = async (values: any) => {
    try {
      // 处理shop_ids：如果是admin角色，传入所有店铺ID
      const shopIds =
        values.role === 'admin' ? shops.map((shop) => shop.id) : values.shop_ids || [];

      if (editingUser) {
        // 更新用户
        await axios.put(`/api/ef/v1/auth/users/${editingUser.id}`, {
          username: values.username,
          role: values.role,
          is_active: values.is_active,
          shop_ids: shopIds,
        });
        notifySuccess('更新成功', '用户更新成功');
      } else {
        // 创建用户
        await axios.post('/api/ef/v1/auth/users', {
          ...values,
          shop_ids: shopIds,
        });
        notifySuccess('创建成功', '用户创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      fetchUsers();
    } catch (error: any) {
      // 获取具体的错误信息
      let errorMsg = '操作失败';

      if (error.response?.data?.detail) {
        // 如果detail是对象，获取message字段
        if (typeof error.response.data.detail === 'object') {
          errorMsg =
            error.response.data.detail.message || error.response.data.detail.msg || '操作失败';
        } else {
          // 如果detail是字符串，直接使用
          errorMsg = error.response.data.detail;
        }
      } else if (error.response?.data?.message) {
        errorMsg = error.response.data.message;
      } else if (error.message) {
        errorMsg = error.message;
      }

      notifyError('操作失败', errorMsg);
    }
  };

  // 停用/启用用户
  const handleToggleStatus = async (user: User) => {
    try {
      await axios.put(`/api/ef/v1/auth/users/${user.id}`, {
        is_active: !user.is_active,
      });
      notifySuccess('操作成功', user.is_active ? '用户已停用' : '用户已启用');
      fetchUsers();
    } catch (error: any) {
      // 获取具体的错误信息
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

  // 删除用户
  const handleDelete = async (userId: number) => {
    try {
      await axios.delete(`/api/ef/v1/auth/users/${userId}`);
      notifySuccess('删除成功', '用户已删除');
      fetchUsers();
    } catch (error: any) {
      // 获取具体的错误信息
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
  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.setFieldsValue({
      username: user.username,
      role: user.role,
      is_active: user.is_active,
      shop_ids: user.shop_ids || [],
    });
    setModalVisible(true);
  };

  // 打开创建模态框
  const handleCreate = () => {
    setEditingUser(null);
    form.resetFields();
    setModalVisible(true);
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const colors: { [key: string]: string } = {
          admin: 'gold',
          operator: 'blue',
          viewer: 'green',
        };
        const labels: { [key: string]: string } = {
          admin: '管理员',
          operator: '操作员',
          viewer: '查看员',
        };
        return <Tag color={colors[role]}>{labels[role]}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive: boolean) => (
        <Tag
          icon={isActive ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          color={isActive ? 'success' : 'error'}
        >
          {isActive ? '激活' : '停用'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: User) => {
        // 管理员自己不能编辑或删除
        const isCurrentAdmin = record.id === currentUser?.id;

        if (isCurrentAdmin) {
          return <Typography.Text type="secondary">-</Typography.Text>;
        }

        return (
          <Space size="middle">
            <Tooltip title="编辑">
              <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
            </Tooltip>
            <Tooltip title={record.is_active ? '停用' : '启用'}>
              <Switch
                checked={record.is_active}
                onChange={() => handleToggleStatus(record)}
                size="small"
              />
            </Tooltip>
            <Popconfirm
              title="确定要删除此用户吗？"
              description="删除后无法恢复，请谨慎操作"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Tooltip title="删除">
                <Button type="link" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className={styles.pageHeader}>
        <PageTitle icon={<UserOutlined />} title="用户管理" />
        <Button type="primary" icon={<UserAddOutlined />} onClick={handleCreate}>
          添加用户
        </Button>
      </div>

      <Card bordered={false}>
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={{
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '创建用户'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            role: 'operator',
            is_active: true,
          }}
        >
          {!editingUser && (
            <>
              <Form.Item
                name="username"
                label="用户名"
                rules={[
                  { required: true, message: '请输入用户名' },
                  { min: 3, message: '用户名至少3个字符' },
                  { max: 50, message: '用户名最多50个字符' },
                ]}
              >
                <Input placeholder="3-50个字符，用于登录" />
              </Form.Item>

              <Form.Item
                name="password"
                label="密码"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 8, message: '密码至少8个字符' },
                ]}
              >
                <Input.Password placeholder="至少8个字符" />
              </Form.Item>
            </>
          )}

          {editingUser && (
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { min: 3, message: '用户名至少3个字符' },
                { max: 50, message: '用户名最多50个字符' },
              ]}
            >
              <Input placeholder="3-50个字符" />
            </Form.Item>
          )}

          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select>
              <Option value="operator">操作员</Option>
              <Option value="viewer">查看员</Option>
            </Select>
          </Form.Item>

          <Form.Item name="is_active" valuePropName="checked" label="账号状态">
            <Switch checkedChildren="激活" unCheckedChildren="停用" />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.role !== currentValues.role}
          >
            {({ getFieldValue }) => {
              const currentRole = getFieldValue('role');
              const isAdmin = currentRole === 'admin';

              return (
                <Form.Item
                  name="shop_ids"
                  label="关联店铺"
                  tooltip={isAdmin ? 'admin角色自动关联所有店铺' : '选择用户可访问的店铺'}
                  rules={[
                    {
                      required: !isAdmin,
                      message: '非管理员角色必须选择至少一个店铺',
                    },
                  ]}
                >
                  <Select
                    mode="multiple"
                    placeholder={isAdmin ? '自动关联所有店铺' : '请选择店铺'}
                    disabled={isAdmin}
                    value={isAdmin ? shops.map((shop) => shop.id) : undefined}
                  >
                    {shops.map((shop) => (
                      <Option key={shop.id} value={shop.id}>
                        {shop.name}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingUser ? '更新' : '创建'}
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

export default UserManagement;
