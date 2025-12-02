/**
 * 自动采集地址管理标签页
 */

import React, { useState } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Switch,
  Modal,
  Form,
  Input,
  InputNumber,
  Tooltip,
  Popconfirm,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  LinkOutlined,
  ShopOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

import { useCollectionSources, type CollectionSource, type CreateSourceRequest } from '@/hooks/ozon/useCollectionSources';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Paragraph } = Typography;

/**
 * 状态标签渲染
 */
const StatusTag: React.FC<{ status: string; errorCount?: number }> = ({ status, errorCount }) => {
  const config: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
    pending: { color: 'default', icon: <ClockCircleOutlined />, text: '待采集' },
    collecting: { color: 'processing', icon: <SyncOutlined spin />, text: '采集中' },
    completed: { color: 'success', icon: <CheckCircleOutlined />, text: '已完成' },
    failed: { color: 'error', icon: <ExclamationCircleOutlined />, text: '失败' },
  };

  const { color, icon, text } = config[status] || config.pending;

  return (
    <Tag color={color} icon={icon}>
      {text}
      {status === 'failed' && errorCount && errorCount > 1 && ` (${errorCount}次)`}
    </Tag>
  );
};

/**
 * 类型标签渲染
 */
const TypeTag: React.FC<{ type: string }> = ({ type }) => {
  if (type === 'category') {
    return <Tag icon={<AppstoreOutlined />} color="blue">类目</Tag>;
  }
  return <Tag icon={<ShopOutlined />} color="purple">店铺</Tag>;
};

/**
 * 添加/编辑地址弹窗
 */
const SourceFormModal: React.FC<{
  visible: boolean;
  onCancel: () => void;
  onSubmit: (values: CreateSourceRequest) => Promise<void>;
  initialValues?: Partial<CollectionSource>;
  isEdit?: boolean;
  loading?: boolean;
}> = ({ visible, onCancel, onSubmit, initialValues, isEdit, loading }) => {
  const [form] = Form.useForm();

  const handleSubmit = async () => {
    const values = await form.validateFields();
    await onSubmit(values);
    form.resetFields();
  };

  return (
    <Modal
      title={isEdit ? '编辑采集地址' : '添加采集地址'}
      open={visible}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          priority: 0,
          target_count: 100,
          is_enabled: true,
          ...initialValues,
        }}
      >
        <Form.Item
          name="source_url"
          label="OZON 地址"
          rules={[
            { required: true, message: '请输入 OZON 地址' },
            {
              pattern: /ozon\.ru\/(category|seller)\//,
              message: '请输入有效的 OZON 类目或店铺地址',
            },
          ]}
          extra="支持类目页面（/category/xxx）和店铺页面（/seller/xxx）"
        >
          <Input
            placeholder="https://www.ozon.ru/category/xxx 或 https://www.ozon.ru/seller/xxx"
            prefix={<LinkOutlined />}
          />
        </Form.Item>

        <Form.Item
          name="display_name"
          label="显示名称"
          extra="可选，用于在列表中识别此地址"
        >
          <Input placeholder="例如：电子产品类目、XX店铺" />
        </Form.Item>

        <Space size="large" align="start">
          <Form.Item
            name="target_count"
            label="目标采集数量"
            rules={[{ required: true, message: '请输入采集数量' }]}
          >
            <InputNumber min={1} max={1000} style={{ width: 120 }} />
          </Form.Item>

          <Form.Item
            name="priority"
            label={
              <span>
                优先级{' '}
                <Tooltip title="数值越高越优先采集">
                  <QuestionCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </span>
            }
          >
            <InputNumber min={0} max={100} style={{ width: 100 }} />
          </Form.Item>

          <Form.Item
            name="is_enabled"
            label="启用"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
};

/**
 * 采集地址管理标签页
 */
export const CollectionSourcesTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSource, setEditingSource] = useState<CollectionSource | null>(null);

  const {
    sources,
    total,
    isLoading,
    refetch,
    create,
    update,
    remove,
    batchRemove,
    toggleEnabled,
    isCreating,
    isUpdating,
    isDeleting,
  } = useCollectionSources({ page, pageSize });

  // 表格列定义
  const columns: ColumnsType<CollectionSource> = [
    {
      title: '类型',
      dataIndex: 'source_type',
      key: 'source_type',
      width: 80,
      render: (type) => <TypeTag type={type} />,
    },
    {
      title: '地址',
      dataIndex: 'source_path',
      key: 'source_path',
      ellipsis: true,
      render: (path, record) => (
        <Tooltip title={record.source_url}>
          <a href={record.source_url} target="_blank" rel="noopener noreferrer">
            {record.display_name || path}
          </a>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status, record) => (
        <Tooltip title={record.last_error}>
          <span>
            <StatusTag status={status} errorCount={record.error_count} />
          </span>
        </Tooltip>
      ),
    },
    {
      title: '目标数量',
      dataIndex: 'target_count',
      key: 'target_count',
      width: 90,
      align: 'center',
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
      align: 'center',
      sorter: (a, b) => b.priority - a.priority,
    },
    {
      title: '上次采集',
      dataIndex: 'last_collected_at',
      key: 'last_collected_at',
      width: 140,
      render: (date, record) => {
        if (!date) return <Text type="secondary">从未采集</Text>;
        const isOverdue = dayjs().diff(dayjs(date), 'day') >= 7;
        return (
          <Tooltip title={dayjs(date).format('YYYY-MM-DD HH:mm:ss')}>
            <Text type={isOverdue ? 'warning' : undefined}>
              {dayjs(date).fromNow()}
              {record.last_product_count > 0 && (
                <Text type="secondary"> ({record.last_product_count})</Text>
              )}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: '累计采集',
      dataIndex: 'total_collected_count',
      key: 'total_collected_count',
      width: 90,
      align: 'center',
      render: (count) => count.toLocaleString(),
    },
    {
      title: '启用',
      dataIndex: 'is_enabled',
      key: 'is_enabled',
      width: 70,
      align: 'center',
      render: (enabled, record) => (
        <Switch
          checked={enabled}
          size="small"
          onChange={(checked) => toggleEnabled(record.id, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => {
                setEditingSource(record);
                setModalVisible(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="确定删除这个采集地址吗？"
            onConfirm={() => remove(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                size="small"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 处理添加/编辑提交
  const handleSubmit = async (values: CreateSourceRequest) => {
    if (editingSource) {
      await update({ id: editingSource.id, data: values });
    } else {
      await create(values);
    }
    setModalVisible(false);
    setEditingSource(null);
  };

  // 处理批量删除
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    await batchRemove(selectedRowKeys as number[]);
    setSelectedRowKeys([]);
  };

  return (
    <div style={{ padding: '16px 0' }}>
      {/* 工具栏 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingSource(null);
              setModalVisible(true);
            }}
          >
            添加地址
          </Button>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 个地址吗？`}
              onConfirm={handleBatchDelete}
              okText="删除"
              cancelText="取消"
            >
              <Button danger icon={<DeleteOutlined />} loading={isDeleting}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          )}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
          刷新
        </Button>
      </div>

      {/* 使用说明 */}
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        添加需要定期采集的 OZON 类目或店铺地址。浏览器插件会自动轮流打开这些地址进行商品采集，
        优先采集超过 7 天未更新的地址。
      </Paragraph>

      {/* 表格 */}
      <Table
        columns={columns}
        dataSource={sources}
        rowKey="id"
        loading={isLoading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        size="small"
      />

      {/* 添加/编辑弹窗 */}
      <SourceFormModal
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingSource(null);
        }}
        onSubmit={handleSubmit}
        initialValues={editingSource || undefined}
        isEdit={!!editingSource}
        loading={isCreating || isUpdating}
      />
    </div>
  );
};

export default CollectionSourcesTab;
