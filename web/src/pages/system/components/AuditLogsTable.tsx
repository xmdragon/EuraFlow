/**
 * 用户操作日志表格组件
 * 显示用户的数据修改操作记录，支持筛选和详情查看
 */
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Table,
  Button,
  Form,
  Select,
  DatePicker,
  Space,
  Tag,
  Modal,
  Typography,
  Empty,
  Input,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState, useEffect } from 'react';

import {
  OZON_ORDER_STATUS_MAP,
  OZON_OPERATION_STATUS_MAP,
} from '@/constants/ozonStatus';
import { useDateTime } from '@/hooks/useDateTime';
import axios from '@/services/axios';
import { notifyError } from '@/utils/notification';

import styles from './AuditLogsTable.module.scss';

const { RangePicker } = DatePicker;
const { Text } = Typography;

interface AuditLog {
  id: number;
  user_id: number;
  username: string;
  module: string;
  action: string;
  action_display: string | null;
  table_name: string;
  record_id: string;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  notes: string | null;
  created_at: string;
}

interface User {
  id: number;
  username: string;
}

const AuditLogsTable: React.FC = () => {
  const { formatDateTime, toUTCRange } = useDateTime();
  const [form] = Form.useForm();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // 模块选项
  const MODULE_OPTIONS = [
    { value: 'ozon', label: 'OZON渠道' },
    { value: 'finance', label: '财务' },
    { value: 'user', label: '用户管理' },
    { value: 'system', label: '系统' },
  ];

  // 操作类型选项
  const ACTION_OPTIONS = [
    { value: 'create', label: '创建' },
    { value: 'update', label: '更新' },
    { value: 'delete', label: '删除' },
    { value: 'print', label: '打印' },
    { value: 'login', label: '登录' },
  ];

  // 获取用户列表
  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/ef/v1/auth/users');
      setUsers(response.data || []);
    } catch (error) {
      console.error('获取用户列表失败:', error);
    }
  };

  // 获取日志列表
  const fetchLogs = async (resetCursor = true) => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const params: Record<string, unknown> = {
        page_size: 50,
      };

      if (values.user_id) params.user_id = values.user_id;
      if (values.module) params.module = values.module;
      if (values.action) params.action = values.action;
      if (values.record_id) params.record_id = values.record_id;
      if (values.date_range && values.date_range.length === 2) {
        params.start_date = toUTCRange(values.date_range[0], false);
        params.end_date = toUTCRange(values.date_range[1], true);
      }
      if (!resetCursor && cursor) {
        params.cursor = cursor;
      }

      const response = await axios.get('/api/ef/v1/audit/logs', { params });

      if (response.data.ok) {
        const newLogs = response.data.data.items || [];
        setLogs(resetCursor ? newLogs : [...logs, ...newLogs]);
        setHasMore(response.data.data.has_more);
        setCursor(response.data.data.next_cursor);
      } else {
        notifyError('查询失败', response.data.error?.detail || '未知错误');
      }
    } catch {
      notifyError('查询失败', '获取操作日志失败');
    } finally {
      setLoading(false);
    }
  };

  // 查看详情
  const viewDetail = (log: AuditLog) => {
    setSelectedLog(log);
    setDetailModalVisible(true);
  };

  useEffect(() => {
    fetchUsers();
    // 默认最近30天
    form.setFieldsValue({
      date_range: [dayjs().subtract(30, 'days'), dayjs()],
    });
    fetchLogs();
  }, []);

  // 模块标签颜色
  const getModuleTag = (module: string) => {
    const colors: Record<string, string> = {
      ozon: 'blue',
      finance: 'green',
      user: 'orange',
      system: 'purple',
    };
    const labels: Record<string, string> = {
      ozon: 'OZON',
      finance: '财务',
      user: '用户',
      system: '系统',
    };
    return <Tag color={colors[module] || 'default'}>{labels[module] || module}</Tag>;
  };

  // 操作类型标签颜色
  const getActionTag = (action: string) => {
    const colors: Record<string, string> = {
      create: 'green',
      update: 'blue',
      delete: 'red',
      print: 'orange',
      login: 'cyan',
    };
    const labels: Record<string, string> = {
      create: '创建',
      update: '更新',
      delete: '删除',
      print: '打印',
      login: '登录',
    };
    return <Tag color={colors[action] || 'default'}>{labels[action] || action}</Tag>;
  };

  // 字段名称映射
  const FIELD_LABEL_MAP: Record<string, string> = {
    // OZON 订单/库存字段
    operation_status: '操作状态',
    status: '订单状态',
    label_printed: '标签打印',
    tracking_number: '运单号',
    domestic_tracking_number: '国内运单号',
    domestic_tracking_numbers: '国内运单号',
    shipped_at: '发货时间',
    notes: '备注',
    order_notes: '订单备注',
    price: '价格',
    stock: '库存',
    qty_available: '库存数量',
    unit_price: '单价',
    source_platform: '采购平台',
    purchase_price: '进货价格',
    material_cost: '物料成本',
    is_enabled: '启用状态',
    print_count: '打印次数',
    sku: 'SKU',
    international_logistics_fee_cny: '国际运费(CNY)',
    last_mile_delivery_fee_cny: '尾程运费(CNY)',

    // 用户模块字段
    username: '用户名',
    role: '角色',
    is_active: '启用状态',
    shop_ids: '关联店铺',
    permissions: '权限列表',
    password: '密码',
    login_method: '登录方式',
    success: '登录结果',

    // API密钥字段
    key_prefix: 'API密钥前缀',
    key: 'API密钥',
    name: '名称',
    expires_at: '过期时间',
    key_id: '密钥ID',

    // 选品字段
    batch_id: '批次ID',
    batch_name: '批次名称',
    deleted_count: '删除数量',
    deleted_products: '删除商品数',
    deleted_batches: '删除批次数',
    marked_count: '标记数量',

    // 草稿模板字段
    template_name: '模板名称',
    form_data: '表单数据',
    tags: '标签',

    // 促销字段
    auto_cancel: '自动取消',
    add_mode: '加入方式',

    // 系统配置字段
    api_provider: 'API服务商',
    base_currency: '基准货币',
    api_key: 'API密钥',

    // 水印存储字段
    cloud_name: 'Cloudinary账号',
    bucket_name: 'OSS存储桶',
    endpoint: 'OSS端点',
    is_default: '默认存储',
    enabled: '启用状态',
    provider: '存储服务商',
    product_images_folder: '商品图片目录',
    region_id: '区域ID',
    access_key_id: 'AccessKey ID',
  };

  // 需要跳过的上下文信息字段（不是实际变更，只是描述信息）
  const SKIP_FIELDS = new Set([
    'reason',
    'posting_number',
    'deduct_requested',
    'deduct_actual',
    'deleted',
    'change',
    'is_reprint',
  ]);

  // 值翻译映射（合并多个状态映射）
  const VALUE_LABEL_MAP: Record<string, string> = {
    ...OZON_ORDER_STATUS_MAP,
    ...OZON_OPERATION_STATUS_MAP,
    // 标签打印状态
    printed: '已打印',
    not_printed: '未打印',
    // 布尔值
    true: '是',
    false: '否',
    // 用户角色
    admin: '管理员',
    operator: '操作员',
    viewer: '查看者',
    // 登录方式
    password: '密码登录',
    // 加入方式
    manual: '手动',
    automatic: '自动',
    // 存储服务商
    cloudinary: 'Cloudinary',
    aliyun_oss: '阿里云OSS',
  };

  // 翻译字段值
  const translateValue = (value: unknown): string => {
    if (value === null || value === undefined) return '空';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (Array.isArray(value)) {
      if (value.length === 0) return '空';
      return value.join(', ');
    }
    if (typeof value === 'object') {
      // 复杂对象，尝试提取有意义的值
      return JSON.stringify(value);
    }
    const strValue = String(value);
    return VALUE_LABEL_MAP[strValue] || strValue;
  };

  // 判断值是否为空
  const isEmpty = (val: unknown): boolean => {
    return val === null || val === undefined || val === '';
  };

  // 格式化变更详情为友好格式
  const formatChanges = (changes: Record<string, unknown> | null) => {
    if (!changes) return null;

    const items: React.ReactNode[] = [];

    const processChange = (field: string, value: unknown, prefix = '') => {
      const fullField = prefix ? `${prefix}.${field}` : field;
      const fieldLabel = FIELD_LABEL_MAP[field] || field;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;

        // 检查是否是 old/new 格式
        if ('old' in obj && 'new' in obj) {
          const oldVal = obj.old;
          const newVal = obj.new;

          // 跳过无意义的变更（空 → 空）
          if (isEmpty(oldVal) && isEmpty(newVal)) {
            return;
          }
          const oldStr = translateValue(oldVal);
          const newStr = translateValue(newVal);
          // 跳过值相同的变更
          if (oldStr === newStr) {
            return;
          }

          // 如果有 change 字段，显示变化量
          const changeAmount = obj.change;
          const changeText = changeAmount !== undefined
            ? ` (${Number(changeAmount) > 0 ? '+' : ''}${changeAmount})`
            : '';

          items.push(
            <div key={fullField} className={styles.changeItem}>
              <Text strong>{fieldLabel}：</Text>
              <Text type="secondary">{oldStr}</Text>
              <Text className={styles.changeArrow}>→</Text>
              <Text>{newStr}{changeText}</Text>
            </div>
          );
        } else if ('new' in obj && !('old' in obj)) {
          // 只有 new，表示新增
          const newVal = obj.new;
          if (!isEmpty(newVal)) {
            items.push(
              <div key={fullField} className={styles.changeItem}>
                <Text strong>{fieldLabel}：</Text>
                <Text type="secondary">空</Text>
                <Text className={styles.changeArrow}>→</Text>
                <Text>{translateValue(newVal)}</Text>
              </div>
            );
          }
        } else {
          // 其他对象，跳过（如 reason、posting_number 等额外信息字段）
          // 这些不是变更，只是上下文信息
        }
      } else {
        // 简单值 - 通常是额外的上下文信息，跳过
        // 如 reason: "订单备货", posting_number: "xxx" 等
      }
    };

    Object.entries(changes).forEach(([field, value]) => {
      processChange(field, value);
    });

    if (items.length === 0) {
      return <Text type="secondary">无有效变更</Text>;
    }

    return <div className={styles.changesList}>{items}</div>;
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      minWidth: 180,
      render: (text: string) => formatDateTime(text, 'YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      minWidth: 120,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, record: AuditLog) => (
        <Space size="small">
          {getModuleTag(record.module)}
          {getActionTag(record.action)}
        </Space>
      ),
    },
    {
      title: '操作说明',
      dataIndex: 'action_display',
      key: 'action_display',
      width: 160,
      ellipsis: true,
      render: (text: string | null) => text || <Text type="secondary">-</Text>,
    },
    {
      title: '货件编号',
      dataIndex: 'record_id',
      key: 'record_id',
      width: 150,
      ellipsis: true,
    },
    {
      title: 'IP地址',
      dataIndex: 'ip_address',
      key: 'ip_address',
      minWidth: 140,
      render: (text: string | null) => text || <Text type="secondary">-</Text>,
    },
    {
      title: '操作',
      key: 'operation',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: AuditLog) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          size="small"
          onClick={() => viewDetail(record)}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <>
      <Form
        form={form}
        layout="inline"
        className={styles.formContainer}
        onFinish={() => fetchLogs(true)}
      >
        <Form.Item name="user_id" label="用户">
          <Select
            className={styles.userSelect}
            placeholder="全部用户"
            allowClear
            showSearch
            optionFilterProp="children"
          >
            {users.map((user) => (
              <Select.Option key={user.id} value={user.id}>
                {user.username}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="module" label="模块">
          <Select
            className={styles.moduleSelect}
            placeholder="全部模块"
            allowClear
          >
            {MODULE_OPTIONS.map((module) => (
              <Select.Option key={module.value} value={module.value}>
                {module.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="action" label="操作">
          <Select
            className={styles.actionSelect}
            placeholder="全部操作"
            allowClear
          >
            {ACTION_OPTIONS.map((action) => (
              <Select.Option key={action.value} value={action.value}>
                {action.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="record_id" label="货件编号">
          <Input
            placeholder="请输入货件编号"
            allowClear
            className={styles.recordIdInput}
          />
        </Form.Item>

        <Form.Item name="date_range" label="时间范围">
          <RangePicker />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              查询
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  date_range: [dayjs().subtract(30, 'days'), dayjs()],
                });
                fetchLogs(true);
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: '100%' }}
      />

      {hasMore && (
        <div className={styles.loadMoreContainer}>
          <Button onClick={() => fetchLogs(false)} loading={loading}>
            加载更多
          </Button>
        </div>
      )}

      <Modal
        title="操作日志详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={600}
      >
        {selectedLog ? (
          <div className={styles.detailContent}>
            <div className={styles.detailRow}>
              <Text strong>用户：</Text>
              <Text>{selectedLog.username} (ID: {selectedLog.user_id})</Text>
            </div>
            <div className={styles.detailRow}>
              <Text strong>模块：</Text>
              {getModuleTag(selectedLog.module)}
            </div>
            <div className={styles.detailRow}>
              <Text strong>操作类型：</Text>
              {getActionTag(selectedLog.action)}
            </div>
            {selectedLog.action_display && (
              <div className={styles.detailRow}>
                <Text strong>操作说明：</Text>
                <Text>{selectedLog.action_display}</Text>
              </div>
            )}
            <div className={styles.detailRow}>
              <Text strong>货件编号：</Text>
              <Text>{selectedLog.record_id}</Text>
            </div>
            {selectedLog.changes && (
              <div className={styles.detailRow}>
                <Text strong>变更详情：</Text>
                {formatChanges(selectedLog.changes)}
              </div>
            )}
            {selectedLog.ip_address && (
              <div className={styles.detailRow}>
                <Text strong>IP地址：</Text>
                <Text>{selectedLog.ip_address}</Text>
              </div>
            )}
            {selectedLog.notes && (
              <div className={styles.detailRow}>
                <Text strong>备注：</Text>
                <Text>{selectedLog.notes}</Text>
              </div>
            )}
            <div className={styles.detailRow}>
              <Text strong>操作时间：</Text>
              <Text>{formatDateTime(selectedLog.created_at, 'YYYY-MM-DD HH:mm:ss')}</Text>
            </div>
          </div>
        ) : (
          <Empty description="无法加载详情" />
        )}
      </Modal>
    </>
  );
};

export default AuditLogsTable;
