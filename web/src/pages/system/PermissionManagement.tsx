/**
 * 权限管理页面
 *
 * 功能：
 * 1. 角色管理（CRUD）
 * 2. 权限配置（点击标识符弹窗配置 API 权限）
 * 3. 权限扫描（自动发现 API）
 */
import {
  SafetyOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SyncOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Tree,
  Spin,
  Popconfirm,
  Empty,
  Alert,
  Tooltip,
  App,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import React, { useState, useEffect, useMemo } from 'react';

import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getPermissionTree,
  getRolePermissions,
  setRolePermissions,
  type Role,
  type PermissionTreeNode,
} from '@/services/system/permissionService';
import { notifySuccess, notifyError } from '@/utils/notification';

const { TextArea } = Input;

// ========== 角色编辑弹窗 ==========

interface RoleModalProps {
  visible: boolean;
  role: Role | null;
  loading: boolean;
  onOk: (values: { display_name: string; description?: string; priority: number }) => void;
  onCancel: () => void;
}

const RoleModal: React.FC<RoleModalProps> = ({ visible, role, loading, onOk, onCancel }) => {
  const [form] = Form.useForm();
  const isEdit = !!role;

  useEffect(() => {
    if (visible) {
      if (role) {
        form.setFieldsValue({
          name: role.name,
          display_name: role.display_name,
          description: role.description,
          priority: role.priority,
        });
      } else {
        form.resetFields();
      }
    }
  }, [visible, role, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onOk(values);
    } catch (error) {
      // 表单验证失败
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑角色' : '新建角色'}
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ priority: 0 }}>
        {!isEdit && (
          <Form.Item
            name="name"
            label="角色标识符"
            rules={[
              { required: true, message: '请输入角色标识符' },
              { pattern: /^[a-z_]+$/, message: '只能包含小写字母和下划线' },
            ]}
            extra="唯一标识，创建后不可修改"
          >
            <Input placeholder="例如：finance_staff" disabled={isEdit} />
          </Form.Item>
        )}
        <Form.Item
          name="display_name"
          label="显示名称"
          rules={[{ required: true, message: '请输入显示名称' }]}
        >
          <Input placeholder="例如：财务专员" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <TextArea rows={3} placeholder="角色描述（可选）" />
        </Form.Item>
        <Form.Item name="priority" label="优先级" extra="数字越大优先级越高，用于排序">
          <InputNumber min={0} max={100} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ========== 权限配置弹窗 ==========

interface PermissionModalProps {
  visible: boolean;
  role: Role | null;
  permissionTree: PermissionTreeNode[];
  treeLoading: boolean;
  onCancel: () => void;
  onSave: (roleId: number, roleName: string, permissionCodes: string[]) => Promise<void>;
}

const PermissionModal: React.FC<PermissionModalProps> = ({
  visible,
  role,
  permissionTree,
  treeLoading,
  onCancel,
  onSave,
}) => {
  const { modal } = App.useApp();
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [originalCheckedKeys, setOriginalCheckedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 加载角色权限
  useEffect(() => {
    if (visible && role) {
      setLoading(true);
      getRolePermissions(role.id)
        .then((permissions) => {
          setCheckedKeys(permissions);
          setOriginalCheckedKeys(permissions);
        })
        .catch((error) => {
          notifyError('加载角色权限失败', error);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setCheckedKeys([]);
      setOriginalCheckedKeys([]);
    }
  }, [visible, role]);

  // 转换为 Ant Design Tree 数据格式
  const treeData: DataNode[] = useMemo(() => {
    const convert = (nodes: PermissionTreeNode[]): DataNode[] => {
      return nodes.map((node) => ({
        key: node.key,
        title: node.is_leaf ? (
          <Space size="small">
            <span>{node.title}</span>
            {node.method && (
              <Tag
                color={
                  node.method === 'GET'
                    ? 'green'
                    : node.method === 'POST'
                      ? 'blue'
                      : node.method === 'PUT'
                        ? 'orange'
                        : 'red'
                }
                style={{ fontSize: 10 }}
              >
                {node.method}
              </Tag>
            )}
          </Space>
        ) : (
          node.title
        ),
        children: node.children ? convert(node.children) : undefined,
        isLeaf: node.is_leaf,
      }));
    };
    return convert(permissionTree);
  }, [permissionTree]);

  // 获取所有叶子节点 key
  const allLeafKeys = useMemo(() => {
    const keys: string[] = [];
    const traverse = (nodes: PermissionTreeNode[]) => {
      for (const node of nodes) {
        if (node.is_leaf) {
          keys.push(node.key);
        } else if (node.children) {
          traverse(node.children);
        }
      }
    };
    traverse(permissionTree);
    return keys;
  }, [permissionTree]);

  // 检查是否有更改
  const hasChanges = useMemo(() => {
    return JSON.stringify(checkedKeys.sort()) !== JSON.stringify(originalCheckedKeys.sort());
  }, [checkedKeys, originalCheckedKeys]);

  // 保存
  const handleSave = async () => {
    if (!role) return;
    setSaving(true);
    try {
      await onSave(role.id, role.display_name, checkedKeys);
      setOriginalCheckedKeys([...checkedKeys]);
    } finally {
      setSaving(false);
    }
  };

  // 关闭前检查
  const handleCancel = () => {
    if (hasChanges) {
      modal.confirm({
        title: '未保存的更改',
        content: '当前角色的权限配置尚未保存，是否放弃更改？',
        okText: '放弃',
        cancelText: '继续编辑',
        onOk: onCancel,
      });
    } else {
      onCancel();
    }
  };

  return (
    <Modal
      title={
        <Space>
          <SettingOutlined />
          权限配置 - {role?.display_name}
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      maskClosable={false}
      width="66vw"
      styles={{
        body: {
          height: '60vh',
          overflow: 'auto',
        },
      }}
      footer={
        <Space>
          <Button onClick={handleCancel}>取消</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={handleSave}
            disabled={!hasChanges}
          >
            保存
          </Button>
        </Space>
      }
      destroyOnClose
    >
      {loading || treeLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : permissionTree.length === 0 ? (
        <Empty description="暂无权限数据，请先扫描 API" />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Button size="small" onClick={() => setCheckedKeys(allLeafKeys)}>
                全选
              </Button>
              <Button size="small" onClick={() => setCheckedKeys([])}>
                清空
              </Button>
              <span style={{ color: '#999' }}>
                已选择 {checkedKeys.length} / {allLeafKeys.length} 个权限
              </span>
              {hasChanges && <Tag color="warning">有未保存的更改</Tag>}
            </Space>
          </div>
          <div style={{ height: 'calc(60vh - 120px)', overflow: 'auto', border: '1px solid #f0f0f0', padding: 8 }}>
            <Tree
              checkable
              selectable={false}
              defaultExpandAll
              checkedKeys={checkedKeys}
              onCheck={(checked) => {
                const keys = Array.isArray(checked) ? checked : checked.checked;
                setCheckedKeys(keys as string[]);
              }}
              treeData={treeData}
            />
          </div>
        </>
      )}
    </Modal>
  );
};

// ========== 主页面组件 ==========

const PermissionManagement: React.FC = () => {
  const { isAdmin } = usePermission();

  // 状态
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  const [permissionTree, setPermissionTree] = useState<PermissionTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleModalLoading, setRoleModalLoading] = useState(false);

  const [permModalVisible, setPermModalVisible] = useState(false);
  const [permModalRole, setPermModalRole] = useState<Role | null>(null);

  // 加载角色列表
  const loadRoles = async () => {
    setRolesLoading(true);
    try {
      const data = await listRoles(true);
      setRoles(data);
    } catch (error: unknown) {
      notifyError('加载角色列表失败', error);
    } finally {
      setRolesLoading(false);
    }
  };

  // 加载权限树
  const loadPermissionTree = async () => {
    setTreeLoading(true);
    try {
      const data = await getPermissionTree();
      setPermissionTree(data);
    } catch (error: unknown) {
      notifyError('加载权限树失败', error);
    } finally {
      setTreeLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    loadRoles();
    loadPermissionTree();
  }, []);

  // 创建角色
  const handleCreateRole = () => {
    setEditingRole(null);
    setRoleModalVisible(true);
  };

  // 编辑角色
  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setRoleModalVisible(true);
  };

  // 删除角色
  const handleDeleteRole = async (role: Role) => {
    try {
      await deleteRole(role.id);
      notifySuccess('删除成功');
      loadRoles();
    } catch (error: unknown) {
      notifyError('删除失败', error);
    }
  };

  // 保存角色
  const handleSaveRole = async (values: {
    name?: string;
    display_name: string;
    description?: string;
    priority: number;
  }) => {
    setRoleModalLoading(true);
    try {
      if (editingRole) {
        await updateRole(editingRole.id, values);
        notifySuccess('更新成功');
      } else {
        await createRole({
          name: values.name!,
          display_name: values.display_name,
          description: values.description,
          priority: values.priority,
        });
        notifySuccess('创建成功');
      }
      setRoleModalVisible(false);
      loadRoles();
    } catch (error: unknown) {
      notifyError(editingRole ? '更新失败' : '创建失败', error);
    } finally {
      setRoleModalLoading(false);
    }
  };

  // 打开权限配置弹窗
  const handleOpenPermModal = (role: Role) => {
    setPermModalRole(role);
    setPermModalVisible(true);
  };

  // 保存权限配置
  const handleSavePermissions = async (roleId: number, roleName: string, permissionCodes: string[]) => {
    const result = await setRolePermissions(roleId, permissionCodes);
    notifySuccess('权限已保存', `${roleName}：共 ${result.count} 个权限`);
  };

  // 表格列定义
  const columns: ColumnsType<Role> = [
    {
      title: '角色名称',
      dataIndex: 'display_name',
      key: 'display_name',
      render: (text, record) => (
        <Space>
          <span>{text}</span>
          {record.is_system && <Tag color="blue">系统</Tag>}
        </Space>
      ),
    },
    {
      title: '标识符',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Tooltip title="点击配置权限">
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontFamily: 'monospace' }}
            onClick={() => handleOpenPermModal(record)}
          >
            {text}
          </Button>
        </Tooltip>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text) => text || '-',
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      align: 'center',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (active) => (
        <Tag color={active ? 'success' : 'default'}>{active ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => handleOpenPermModal(record)}
          >
            权限
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditRole(record)}
          />
          {!record.is_system && (
            <Popconfirm
              title="确定删除此角色？"
              onConfirm={() => handleDeleteRole(record)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!isAdmin) {
    return (
      <div>
        <PageTitle title="权限管理" icon={<SafetyOutlined />} />
        <Alert message="仅超级管理员可访问此页面" type="warning" showIcon />
      </div>
    );
  }

  return (
    <div>
      <PageTitle title="权限管理" icon={<SafetyOutlined />} />

      <Card
        extra={
          <Space>
            <Button icon={<SyncOutlined />} onClick={loadRoles}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateRole}>
              新建角色
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={roles}
          loading={rolesLoading}
          rowKey="id"
          pagination={false}
        />
      </Card>

      {/* 角色编辑弹窗 */}
      <RoleModal
        visible={roleModalVisible}
        role={editingRole}
        loading={roleModalLoading}
        onOk={handleSaveRole}
        onCancel={() => setRoleModalVisible(false)}
      />

      {/* 权限配置弹窗 */}
      <PermissionModal
        visible={permModalVisible}
        role={permModalRole}
        permissionTree={permissionTree}
        treeLoading={treeLoading}
        onCancel={() => setPermModalVisible(false)}
        onSave={handleSavePermissions}
      />
    </div>
  );
};

export default PermissionManagement;
