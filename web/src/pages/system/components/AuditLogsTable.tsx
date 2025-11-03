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
  Spin,
  Empty,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState, useEffect } from 'react';

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
    } catch (error) {
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
    };
    const labels: Record<string, string> = {
      create: '创建',
      update: '更新',
      delete: '删除',
      print: '打印',
    };
    return <Tag color={colors[action] || 'default'}>{labels[action] || action}</Tag>;
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
      minWidth: 200,
      render: (_: unknown, record: AuditLog) => (
        <Space size="small">
          {getModuleTag(record.module)}
          {getActionTag(record.action)}
          {record.action_display && (
            <Text type="secondary">({record.action_display})</Text>
          )}
        </Space>
      ),
    },
    {
      title: '表名',
      dataIndex: 'table_name',
      key: 'table_name',
      minWidth: 150,
      render: (text: string) => <Text code>{text}</Text>,
    },
    {
      title: '记录ID',
      dataIndex: 'record_id',
      key: 'record_id',
      minWidth: 150,
      ellipsis: true,
    },
    {
      title: '变更详情',
      dataIndex: 'changes',
      key: 'changes',
      minWidth: 200,
      ellipsis: true,
      render: (changes: Record<string, unknown> | null) => {
        if (!changes) return <Text type="secondary">-</Text>;
        const keys = Object.keys(changes);
        return (
          <Text type="secondary">
            {keys.length > 0 ? `${keys[0]} 等 ${keys.length} 个字段` : '无变更'}
          </Text>
        );
      },
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

        <Form.Item name="date_range" label="时间范围">
          <RangePicker showTime />
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
        width={800}
      >
        {selectedLog ? (
          <div>
            <Space direction="vertical" className={styles.detailContent} size="middle">
              <div>
                <Text strong>用户：</Text>
                <Text>{selectedLog.username} (ID: {selectedLog.user_id})</Text>
              </div>
              <div>
                <Text strong>模块：</Text>
                {getModuleTag(selectedLog.module)}
              </div>
              <div>
                <Text strong>操作类型：</Text>
                {getActionTag(selectedLog.action)}
              </div>
              {selectedLog.action_display && (
                <div>
                  <Text strong>操作说明：</Text>
                  <Text>{selectedLog.action_display}</Text>
                </div>
              )}
              <div>
                <Text strong>表名：</Text>
                <Text code>{selectedLog.table_name}</Text>
              </div>
              <div>
                <Text strong>记录ID：</Text>
                <Text>{selectedLog.record_id}</Text>
              </div>
              {selectedLog.changes && (
                <div>
                  <Text strong>变更详情：</Text>
                  <pre className={styles.detailChanges}>
                    {JSON.stringify(selectedLog.changes, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.ip_address && (
                <div>
                  <Text strong>IP地址：</Text>
                  <Text>{selectedLog.ip_address}</Text>
                </div>
              )}
              {selectedLog.user_agent && (
                <div>
                  <Text strong>User Agent：</Text>
                  <Text className={styles.detailUserAgent} type="secondary">
                    {selectedLog.user_agent}
                  </Text>
                </div>
              )}
              {selectedLog.request_id && (
                <div>
                  <Text strong>请求ID：</Text>
                  <Text code>{selectedLog.request_id}</Text>
                </div>
              )}
              {selectedLog.notes && (
                <div>
                  <Text strong>备注：</Text>
                  <Text>{selectedLog.notes}</Text>
                </div>
              )}
              <div>
                <Text strong>操作时间：</Text>
                <Text>{formatDateTime(selectedLog.created_at, 'YYYY-MM-DD HH:mm:ss')}</Text>
              </div>
            </Space>
          </div>
        ) : (
          <Empty description="无法加载详情" />
        )}
      </Modal>
    </>
  );
};

export default AuditLogsTable;
