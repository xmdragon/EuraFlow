import React, { useState, useEffect } from 'react';
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
  message,
  Tag,
  Typography,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import axios from '@/services/axios';
import { useAuth } from '@/hooks/useAuth';

const { Title } = Typography;
const { Option } = Select;

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  is_active: boolean;
  parent_user_id?: number;
  created_at: string;
}

interface CreateUserData {
  email: string;
  username?: string;
  password: string;
  role: string;
  is_active: boolean;
  permissions: string[];
}

const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  // 检查是否为管理员
  if (currentUser?.role !== 'admin') {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Title level={4}>无权限访问</Title>
        <p>只有管理员可以访问用户管理页面</p>
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
      message.error('获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // 创建/更新用户
  const handleSubmit = async (values: any) => {
    try {
      if (editingUser) {
        // 更新用户
        await axios.put(`/api/ef/v1/auth/users/${editingUser.id}`, {
          username: values.username,
          role: values.role,
          is_active: values.is_active,
          permissions: values.permissions || [],
        });
        message.success('用户更新成功');
      } else {
        // 创建用户
        await axios.post('/api/ef/v1/auth/users', values);
        message.success('用户创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      fetchUsers();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail?.message || '操作失败';
      message.error(errorMsg);
    }
  };

  // 禁用/启用用户
  const handleToggleStatus = async (user: User) => {
    try {
      await axios.put(`/api/ef/v1/auth/users/${user.id}`, {
        is_active: !user.is_active,
      });
      message.success(user.is_active ? '用户已禁用' : '用户已启用');
      fetchUsers();
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 删除用户
  const handleDelete = async (userId: number) => {
    try {
      await axios.delete(`/api/ef/v1/auth/users/${userId}`);
      message.success('用户已禁用');
      fetchUsers();
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 打开编辑模态框
  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.setFieldsValue({
      email: user.email,
      username: user.username,
      role: user.role,
      is_active: user.is_active,
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
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => text || '-',
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
        <Tag icon={isActive ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
             color={isActive ? 'success' : 'error'}>
          {isActive ? '激活' : '禁用'}
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
              <Button
                type="link"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              />
            </Tooltip>
            <Tooltip title={record.is_active ? '禁用' : '启用'}>
              <Switch
                checked={record.is_active}
                onChange={() => handleToggleStatus(record)}
                size="small"
              />
            </Tooltip>
            <Popconfirm
              title="确定要禁用此用户吗？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Tooltip title="禁用">
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Title level={4} style={{ margin: 0 }}>用户管理</Title>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={handleCreate}
            >
              添加用户
            </Button>
          </div>
        }
        bordered={false}
      >
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
                name="email"
                label="邮箱"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入有效的邮箱地址' },
                ]}
              >
                <Input placeholder="user@example.com" disabled={!!editingUser} />
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

          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { min: 3, message: '用户名至少3个字符' },
              { max: 50, message: '用户名最多50个字符' },
            ]}
          >
            <Input placeholder="可选，3-50个字符" />
          </Form.Item>

          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select>
              <Option value="operator">操作员</Option>
              <Option value="viewer">查看员</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="is_active"
            valuePropName="checked"
            label="账号状态"
          >
            <Switch checkedChildren="激活" unCheckedChildren="禁用" />
          </Form.Item>

          <Form.Item
            name="permissions"
            label="权限"
          >
            <Select mode="multiple" placeholder="选择权限">
              <Option value="view_orders">查看订单</Option>
              <Option value="manage_orders">管理订单</Option>
              <Option value="view_products">查看商品</Option>
              <Option value="manage_products">管理商品</Option>
              <Option value="view_inventory">查看库存</Option>
              <Option value="manage_inventory">管理库存</Option>
              <Option value="view_finance">查看财务</Option>
              <Option value="manage_finance">管理财务</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingUser ? '更新' : '创建'}
              </Button>
              <Button onClick={() => {
                setModalVisible(false);
                form.resetFields();
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

export default UserManagement;