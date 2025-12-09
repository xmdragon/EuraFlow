/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  EditOutlined,
  DeleteOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserOutlined,
  KeyOutlined,
  CrownOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
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
  App,
  Descriptions,
  DatePicker,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState, useEffect } from 'react';

import styles from './UserList.module.scss';

import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

import type { FormValues } from '@/types/common';
import type { AccountStatus, ManagerLevel, UserRole } from '@/types/auth';

const { Option } = Select;

interface User {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  account_status: AccountStatus;
  expires_at?: string;
  parent_user_id?: number;
  primary_shop_id?: number;
  shop_ids?: number[];
  manager_level_id?: number;
  manager_level?: ManagerLevel;
  created_at: string;
}

interface Shop {
  id: number;
  name: string;
  platform: string;
}

interface UserQuota {
  sub_accounts_count: number;
  max_sub_accounts: number;
  shops_count: number;
  max_shops: number;
}

const UserManagement: React.FC = () => {
  const { modal } = App.useApp(); // 使用 App.useApp() hook 获取 modal 实例
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [managerLevels, setManagerLevels] = useState<ManagerLevel[]>([]);
  const [currentQuota, setCurrentQuota] = useState<UserQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

  // 角色显示配置
  const roleConfig: Record<UserRole, { color: string; label: string }> = {
    admin: { color: 'gold', label: '超级管理员' },
    manager: { color: 'blue', label: '管理员' },
    sub_account: { color: 'green', label: '子账号' },
  };

  // 账号状态配置
  const accountStatusConfig: Record<AccountStatus, { color: string; label: string; icon: React.ReactNode }> = {
    active: { color: 'success', label: '正常', icon: <CheckCircleOutlined /> },
    suspended: { color: 'warning', label: '停用', icon: <ExclamationCircleOutlined /> },
    disabled: { color: 'error', label: '禁用', icon: <StopOutlined /> },
  };

  // 过期时间选项（创建时）- 基础选项
  const baseExpirationOptions = [
    { label: '7天', value: 7 },
    { label: '1个月', value: 30 },
    { label: '3个月', value: 90 },
    { label: '1年', value: 365 },
  ];

  // manager 创建/编辑 sub_account 时的过期时间选项（增加"跟随主账号"）
  const subAccountExpirationOptions = [
    { label: '跟随主账号', value: -1 },
    ...baseExpirationOptions,
  ];

  // 续期选项（编辑时）- 基础选项
  const baseRenewalOptions = [
    { label: '续期1个月', value: 30 },
    { label: '续期3个月', value: 90 },
    { label: '续期1年', value: 365 },
  ];

  // manager 编辑 sub_account 时的续期选项（增加"跟随主账号"）
  const subAccountRenewalOptions = [
    { label: '跟随主账号', value: -1 },
    ...baseRenewalOptions,
  ];

  // 检查账号是否已过期
  const isExpired = (expiresAt?: string) => {
    if (!expiresAt) return false;
    return dayjs(expiresAt).isBefore(dayjs());
  };

  // 判断当前用户是否可以访问用户管理
  const canAccessUserManagement = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  // 获取用户列表
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/auth/users');
      setUsers(response.data);
    } catch (_error) {
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
      const shopsData = (response.data.data || []).map((shop) => ({
        id: shop.id,
        name: shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : ''),
        platform: shop.platform,
      }));
      setShops(shopsData);
    } catch (_error) {
      notifyError('获取失败', '获取店铺列表失败');
    }
  };

  // 获取用户级别列表（仅 admin）
  const fetchManagerLevels = async () => {
    if (currentUser?.role !== 'admin') return;
    try {
      const response = await axios.get('/api/ef/v1/manager-levels');
      setManagerLevels(response.data);
    } catch (_error) {
      // 静默失败，不影响页面显示
    }
  };

  // 获取当前用户配额（manager）
  const fetchCurrentQuota = async () => {
    if (currentUser?.role !== 'manager' || !currentUser?.id) return;
    try {
      const response = await axios.get(`/api/ef/v1/auth/users/${currentUser.id}/quota`);
      setCurrentQuota(response.data);
    } catch (_error) {
      // 静默失败
    }
  };

  useEffect(() => {
    if (canAccessUserManagement) {
      fetchUsers();
      fetchShops();
      fetchManagerLevels();
      fetchCurrentQuota();
    }
  }, [currentUser?.role, currentUser?.id]);

  // 检查是否有权限访问
  if (!canAccessUserManagement) {
    return (
      <div>
        <PageTitle icon={<UserOutlined />} title="用户管理" />
        <Card style={{ textAlign: 'center' }}>
          <p>只有管理员可以访问用户管理页面</p>
        </Card>
      </div>
    );
  }

  // 创建/更新用户
  const handleSubmit = async (values: FormValues) => {
    try {
      // 处理shop_ids：admin和manager角色不传入shop_ids（可访问所有店铺）
      const shopIds = (values.role === 'admin' || values.role === 'manager') ? undefined : values.shop_ids || [];

      if (editingUser) {
        // 更新用户
        const updateData: Record<string, unknown> = {
          username: values.username,
          role: values.role,
          is_active: values.is_active,
        };
        if (shopIds) updateData.shop_ids = shopIds;
        // admin 创建 manager 时可设置级别
        if (currentUser?.role === 'admin' && values.role === 'manager' && values.manager_level_id) {
          updateData.manager_level_id = values.manager_level_id;
        }
        // 处理账号状态
        if (values.account_status) {
          updateData.account_status = values.account_status;
        }
        // 处理续期（相对于当前过期时间或当前时间）
        if (values.renewal_days !== undefined && values.renewal_days !== null) {
          if (values.renewal_days === -1) {
            // 跟随主账号：设置和当前管理员相同的过期时间
            updateData.expires_at = currentUser?.expires_at || null;
          } else if (values.renewal_days > 0) {
            const baseDate = editingUser.expires_at
              ? dayjs(editingUser.expires_at).isAfter(dayjs()) ? dayjs(editingUser.expires_at) : dayjs()
              : dayjs();
            updateData.expires_at = baseDate.add(values.renewal_days, 'day').toISOString();
          }
        }
        await axios.put(`/api/ef/v1/auth/users/${editingUser.id}`, updateData);
        notifySuccess('更新成功', '用户更新成功');
      } else {
        // 创建用户
        const createData: Record<string, unknown> = {
          ...values,
        };
        if (shopIds) createData.shop_ids = shopIds;
        // 处理过期时间（创建时）
        if (values.expiration_days === -1) {
          // 跟随主账号：设置和当前管理员相同的过期时间
          createData.expires_at = currentUser?.expires_at || null;
        } else if (values.expiration_days !== undefined && values.expiration_days > 0) {
          createData.expires_at = dayjs().add(values.expiration_days, 'day').toISOString();
        } else {
          createData.expires_at = null; // 永不过期
        }
        // 删除不需要传递给后端的字段
        delete createData.expiration_days;
        await axios.post('/api/ef/v1/auth/users', createData);
        notifySuccess('创建成功', '用户创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      fetchUsers();
      fetchCurrentQuota(); // 刷新配额
    } catch (error) {
      // 获取具体的错误信息
      let errorMsg = '操作失败';
      const data = error.response?.data;

      // 优先检查 { ok: false, error: { detail: { message } } } 结构
      if (data?.error?.detail?.message) {
        errorMsg = data.error.detail.message;
      } else if (data?.error?.title?.message) {
        errorMsg = data.error.title.message;
      } else if (data?.detail) {
        // 兼容旧结构 { detail: { message } } 或 { detail: "string" }
        if (typeof data.detail === 'object') {
          errorMsg = data.detail.message || data.detail.msg || '操作失败';
        } else {
          errorMsg = data.detail;
        }
      } else if (data?.message) {
        errorMsg = data.message;
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
    } catch (error) {
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
    } catch (error) {
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
      account_status: user.account_status || 'active',
      shop_ids: user.shop_ids || [],
      manager_level_id: user.manager_level_id,
    });
    setModalVisible(true);
  };

  // 打开创建模态框
  const handleCreate = () => {
    setEditingUser(null);
    form.resetFields();
    setModalVisible(true);
  };

  // 打开修改密码模态框
  const handleChangePassword = (user: User) => {
    setEditingUser(user);
    passwordForm.resetFields();
    setPasswordModalVisible(true);
  };

  // 修改密码
  const handlePasswordSubmit = async (values: FormValues) => {
    if (!editingUser) return;

    try {
      await axios.patch(`/api/ef/v1/auth/users/${editingUser.id}/password`, {
        new_password: values.new_password,
      });
      notifySuccess('修改成功', '密码已重置');
      setPasswordModalVisible(false);
      passwordForm.resetFields();
    } catch (error) {
      let errorMsg = '修改密码失败';
      if (error.response?.data?.detail) {
        if (typeof error.response.data.detail === 'object') {
          errorMsg = error.response.data.detail.message || error.response.data.detail.msg || '修改密码失败';
        } else {
          errorMsg = error.response.data.detail;
        }
      } else if (error.response?.data?.message) {
        errorMsg = error.response.data.message;
      } else if (error.message) {
        errorMsg = error.message;
      }
      notifyError('修改失败', errorMsg);
    }
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
      render: (role: UserRole) => {
        const config = roleConfig[role] || { color: 'default', label: role };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '级别',
      dataIndex: 'manager_level',
      key: 'manager_level',
      render: (_: unknown, record: User) => {
        if (record.role === 'admin') {
          return <Tag icon={<CrownOutlined />} color="gold">超级管理员</Tag>;
        }
        if (record.role === 'manager' && record.manager_level) {
          return (
            <Tooltip title={`子账号限额: ${record.manager_level.max_sub_accounts}, 店铺限额: ${record.manager_level.max_shops}`}>
              <Tag color="blue">{record.manager_level.alias || record.manager_level.name}</Tag>
            </Tooltip>
          );
        }
        if (record.role === 'sub_account' && record.parent_user_id) {
          const parentUser = users.find(u => u.id === record.parent_user_id);
          return <Tag color="green">属于: {parentUser?.username || `用户#${record.parent_user_id}`}</Tag>;
        }
        return '-';
      },
    },
    {
      title: '账号状态',
      dataIndex: 'account_status',
      key: 'account_status',
      render: (status: AccountStatus, record: User) => {
        // admin 不显示账号状态
        if (record.role === 'admin') {
          return <Tag color="gold">不受限制</Tag>;
        }
        // 子账号显示继承自父账号
        if (record.role === 'sub_account') {
          return <Tag color="cyan">继承管理员</Tag>;
        }
        const config = accountStatusConfig[status] || accountStatusConfig.active;
        return (
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (expiresAt: string, record: User) => {
        // admin 不显示过期时间
        if (record.role === 'admin') {
          return <Tag color="gold">永不过期</Tag>;
        }
        // 子账号继承自父账号
        if (record.role === 'sub_account') {
          return <Tag color="cyan">继承管理员</Tag>;
        }
        if (!expiresAt) {
          return <Tag color="blue">永不过期</Tag>;
        }
        const expired = isExpired(expiresAt);
        const expiresDate = dayjs(expiresAt);
        return (
          <Tooltip title={expiresDate.format('YYYY-MM-DD HH:mm:ss')}>
            <Tag
              icon={expired ? <ClockCircleOutlined /> : undefined}
              color={expired ? 'error' : 'processing'}
            >
              {expired ? '已过期' : expiresDate.format('YYYY-MM-DD')}
            </Tag>
          </Tooltip>
        );
      },
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
      render: (_: unknown, record: User) => {
        // 当前用户不能操作自己
        const isSelf = record.id === currentUser?.id;
        // 判断当前用户是否是超级管理员
        const isAdmin = currentUser?.role === 'admin';
        // 目标是否是 admin
        const isTargetAdmin = record.role === 'admin';
        // manager 只能操作自己创建的子账号
        const isManager = currentUser?.role === 'manager';
        const isOwnSubAccount = isManager && record.parent_user_id === currentUser?.id;

        // 不能操作的情况：
        // 1. 自己
        // 2. manager 试图操作非自己创建的用户
        // 3. 非 admin 试图操作 admin
        if (isSelf || (isManager && !isOwnSubAccount) || (!isAdmin && isTargetAdmin)) {
          return <Typography.Text type="secondary">-</Typography.Text>;
        }

        return (
          <Space size="middle">
            <Tooltip title="编辑">
              <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
            </Tooltip>
            <Tooltip title="修改密码">
              <Button type="link" icon={<KeyOutlined />} onClick={() => handleChangePassword(record)} />
            </Tooltip>
            <Tooltip title={record.is_active ? '停用' : '启用'}>
              <Switch
                checked={record.is_active}
                onChange={() => handleToggleStatus(record)}
                size="small"
              />
            </Tooltip>
            <Tooltip title="删除">
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  modal.confirm({
                    title: '确定要删除此用户吗？',
                    content: '删除后无法恢复，请谨慎操作',
                    okText: '确定',
                    cancelText: '取消',
                    onOk: () => handleDelete(record.id)
                  });
                }}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className={styles.pageHeader}>
        <PageTitle icon={<UserOutlined />} title="用户管理" />
        <Space>
          {currentUser?.role === 'admin' && (
            <Button icon={<CrownOutlined />} onClick={() => window.location.href = '/dashboard/users/levels'}>
              用户级别
            </Button>
          )}
          <Button type="primary" icon={<UserAddOutlined />} onClick={handleCreate}>
            {currentUser?.role === 'admin' ? '添加管理员' : '添加子账号'}
          </Button>
        </Space>
      </div>

      {/* manager 显示配额信息 */}
      {currentUser?.role === 'manager' && currentQuota && (
        <Card bordered={false} style={{ marginBottom: 16 }}>
          <Descriptions title="我的配额" size="small" column={2}>
            <Descriptions.Item label="子账号">
              {currentQuota.sub_accounts_count} / {currentQuota.max_sub_accounts}
            </Descriptions.Item>
            <Descriptions.Item label="店铺">
              {currentQuota.shops_count} / {currentQuota.max_shops}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

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
        title={editingUser ? '编辑用户' : (currentUser?.role === 'admin' ? '创建管理员' : '创建子账号')}
        open={modalVisible}
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
            role: currentUser?.role === 'admin' ? 'manager' : 'sub_account',
            is_active: true,
            account_status: 'active',
            expiration_days: 30, // 默认1个月
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

          {/* 角色选择：admin 只能创建 manager，manager 只能创建 sub_account */}
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select disabled>
              {currentUser?.role === 'admin' && (
                <Option value="manager">管理员</Option>
              )}
              {currentUser?.role === 'manager' && (
                <Option value="sub_account">子账号</Option>
              )}
            </Select>
          </Form.Item>

          {/* admin 创建 manager 时选择级别 */}
          {currentUser?.role === 'admin' && (
            managerLevels.length > 0 ? (
              <Form.Item
                name="manager_level_id"
                label="用户级别"
                rules={[{ required: true, message: '请选择用户级别' }]}
              >
                <Select
                  placeholder="选择级别（决定配额限制）"
                  onChange={(levelId) => {
                    // 创建管理员时，选择级别后自动应用该级别的默认过期时间
                    if (!editingUser) {
                      const selectedLevel = managerLevels.find(l => l.id === levelId);
                      if (selectedLevel) {
                        form.setFieldsValue({
                          expiration_days: selectedLevel.default_expiration_days
                        });
                      }
                    }
                  }}
                >
                  {managerLevels.map((level) => (
                    <Option key={level.id} value={level.id}>
                      {level.alias || level.name} (子账号: {level.max_sub_accounts}, 店铺: {level.max_shops}, 有效期: {level.default_expiration_days === 0 ? '永久' : level.default_expiration_days + '天'})
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            ) : (
              <Form.Item label="用户级别">
                <Typography.Text type="warning">
                  暂无可用级别，请先到 <Typography.Link href="/dashboard/users/levels">用户管理 → 用户级别</Typography.Link> 创建级别
                </Typography.Text>
              </Form.Item>
            )
          )}

          <Form.Item name="is_active" valuePropName="checked" label="激活状态">
            <Switch checkedChildren="激活" unCheckedChildren="停用" />
          </Form.Item>

          {/* 账号状态和过期时间：manager 和 sub_account 都需要设置 */}
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.role !== currentValues.role}
          >
            {({ getFieldValue }) => {
              const selectedRole = getFieldValue('role');
              // admin 角色不需要设置账号状态和过期时间
              if (selectedRole === 'admin') return null;

              // 判断是否为 manager 创建/编辑 sub_account（需要显示"跟随主账号"选项）
              const isManagerEditingSubAccount = currentUser?.role === 'manager' && selectedRole === 'sub_account';

              // 根据场景选择选项列表
              const expirationOptions = isManagerEditingSubAccount ? subAccountExpirationOptions : baseExpirationOptions;
              const renewalOptions = isManagerEditingSubAccount ? subAccountRenewalOptions : baseRenewalOptions;

              return (
                <>
                  {/* 账号状态：仅编辑时显示 */}
                  {editingUser && (
                    <Form.Item
                      name="account_status"
                      label="账号状态"
                      tooltip="停用：可登录但不能执行写操作；禁用：无法登录"
                    >
                      <Select>
                        <Option value="active">正常</Option>
                        <Option value="suspended">停用（可查看，不可操作）</Option>
                        <Option value="disabled">禁用（无法登录）</Option>
                      </Select>
                    </Form.Item>
                  )}

                  {/* 创建时：选择过期时间 */}
                  {!editingUser && (
                    <Form.Item
                      name="expiration_days"
                      label="有效期"
                      tooltip={isManagerEditingSubAccount
                        ? `账号过期后将无法登录。选择"跟随主账号"将与您的账号同时过期${currentUser?.expires_at ? `（${dayjs(currentUser.expires_at).format('YYYY-MM-DD')}）` : '（永不过期）'}`
                        : '账号过期后将无法登录'
                      }
                    >
                      <Select>
                        {expirationOptions.map(opt => (
                          <Option key={opt.value} value={opt.value}>
                            {opt.label}
                            {opt.value === -1 && currentUser?.expires_at && (
                              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                                ({dayjs(currentUser.expires_at).format('YYYY-MM-DD')})
                              </Typography.Text>
                            )}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  )}

                  {/* 编辑时：显示当前过期时间和续期选项 */}
                  {editingUser && (
                    <>
                      <Form.Item label="当前过期时间">
                        {editingUser.expires_at ? (
                          <Space>
                            <Typography.Text>
                              {dayjs(editingUser.expires_at).format('YYYY-MM-DD HH:mm')}
                            </Typography.Text>
                            {isExpired(editingUser.expires_at) && (
                              <Tag color="error">已过期</Tag>
                            )}
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">永不过期</Typography.Text>
                        )}
                      </Form.Item>
                      <Form.Item
                        name="renewal_days"
                        label="续期"
                        tooltip={isManagerEditingSubAccount
                          ? `在当前过期时间基础上延长有效期。选择"跟随主账号"将与您的账号同时过期${currentUser?.expires_at ? `（${dayjs(currentUser.expires_at).format('YYYY-MM-DD')}）` : '（永不过期）'}`
                          : '在当前过期时间基础上延长有效期'
                        }
                      >
                        <Select placeholder="选择续期时长（可选）" allowClear>
                          {renewalOptions.map(opt => (
                            <Option key={opt.value} value={opt.value}>
                              {opt.label}
                              {opt.value === -1 && currentUser?.expires_at && (
                                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                                  ({dayjs(currentUser.expires_at).format('YYYY-MM-DD')})
                                </Typography.Text>
                              )}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </>
                  )}
                </>
              );
            }}
          </Form.Item>

          {/* 店铺关联：admin/manager 无需关联（可访问所有店铺），sub_account 需要选择 */}
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.role !== currentValues.role}
          >
            {({ getFieldValue }) => {
              const selectedRole = getFieldValue('role');

              // admin 和 manager 不显示关联店铺选项（可访问所有店铺）
              if (selectedRole === 'admin' || selectedRole === 'manager') {
                return null;
              }

              return (
                <Form.Item
                  name="shop_ids"
                  label="关联店铺"
                  tooltip="选择用户可访问的店铺"
                  rules={[
                    {
                      required: true,
                      message: '请选择至少一个店铺',
                    },
                  ]}
                >
                  <Select
                    mode="multiple"
                    placeholder="请选择店铺"
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

      {/* 修改密码模态框 */}
      <Modal
        title={`修改密码 - ${editingUser?.username || ''}`}
        open={passwordModalVisible}
        onCancel={() => {
          setPasswordModalVisible(false);
          passwordForm.resetFields();
        }}
        footer={null}
        width={500}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handlePasswordSubmit}
        >
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少8个字符' },
            ]}
          >
            <Input.Password placeholder="至少8个字符" />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="确认密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                确认修改
              </Button>
              <Button
                onClick={() => {
                  setPasswordModalVisible(false);
                  passwordForm.resetFields();
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
