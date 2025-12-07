/**
 * Webhook 通知日志表格组件
 * 显示 OZON Webhook 事件日志，支持筛选和详情查看
 */
import { EyeOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
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
  Input,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState, useEffect } from 'react';

import axios from '@/services/axios';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import { notifyError } from '@/utils/notification';

import styles from './WebhookLogsTable.module.scss';

const { RangePicker } = DatePicker;
const { Text } = Typography;

interface WebhookLog {
  id: number;
  event_id: string;
  event_type: string;
  shop_id: number;
  shop_name: string;
  status: string;
  entity_type: string | null;
  entity_id: string | null;
  posting_number: string | null;
  retry_count: number;
  error_message: string | null;
  result_message: string | null;
  processing_duration_ms: number | null;
  created_at: string;
  processed_at: string | null;
}

interface WebhookLogDetail extends WebhookLog {
  payload: Record<string, unknown>;
  headers: Record<string, unknown> | null;
  signature: string | null;
  is_verified: boolean;
  idempotency_key: string | null;
  updated_at: string;
}

interface Shop {
  id: number;
  shop_name: string;
  shop_name_cn: string;
}

const WebhookLogsTable: React.FC = () => {
  const { formatDateTime, toUTCRange } = useDateTime();
  const [form] = Form.useForm();
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<WebhookLogDetail | null>(null);
  const { copyToClipboard } = useCopy();

  // 事件类型选项
  const EVENT_TYPES = [
    { value: 'ping', label: 'Ping（连接检查）' },
    { value: 'posting.created', label: '新订单创建' },
    { value: 'posting.cancelled', label: '订单取消' },
    { value: 'posting.status_changed', label: '订单状态变更' },
    { value: 'posting.delivered', label: '订单送达' },
    { value: 'posting.cutoff_date_changed', label: '订单截止日期变更' },
    { value: 'posting.delivery_date_changed', label: '订单配送日期变更' },
    { value: 'product.created', label: '商品创建' },
    { value: 'product.updated', label: '商品更新' },
    { value: 'product.create_or_update', label: '商品创建/更新' },
    { value: 'product.price_changed', label: '商品价格变更' },
    { value: 'product.stock_changed', label: '库存变更' },
    { value: 'product.price_index_changed', label: '价格指数变更' },
    { value: 'chat.message_created', label: '新聊天消息' },
    { value: 'chat.message_updated', label: '聊天消息更新' },
    { value: 'chat.message_read', label: '消息已读' },
    { value: 'chat.closed', label: '聊天关闭' },
    { value: 'return.created', label: '退货创建' },
    { value: 'return.status_changed', label: '退货状态变更' },
  ];

  // 状态选项
  const STATUS_OPTIONS = [
    { value: 'processed', label: '已处理' },
    { value: 'failed', label: '失败' },
    { value: 'ignored', label: '已忽略' },
    { value: 'pending', label: '待处理' },
  ];

  // 获取店铺列表
  const fetchShops = async () => {
    try {
      const response = await axios.get('/api/ef/v1/ozon/shops');
      setShops(response.data.data || []);
    } catch (error) {
      console.error('获取店铺列表失败:', error);
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

      if (values.shop_id) params.shop_id = values.shop_id;
      if (values.event_type) params.event_type = values.event_type;
      if (values.status) params.status = values.status;
      if (values.posting_number) params.posting_number = values.posting_number.trim();
      if (values.date_range && values.date_range.length === 2) {
        params.start_date = toUTCRange(values.date_range[0], false);
        params.end_date = toUTCRange(values.date_range[1], true);
      }
      if (!resetCursor && cursor) {
        params.cursor = cursor;
      }

      const response = await axios.get('/api/ef/v1/audit/webhooks/logs', { params });

      if (response.data.ok) {
        const newLogs = response.data.data.items || [];
        setLogs(resetCursor ? newLogs : [...logs, ...newLogs]);
        setHasMore(response.data.data.has_more);
        setCursor(response.data.data.next_cursor);
      } else {
        notifyError('查询失败', response.data.error?.detail || '未知错误');
      }
    } catch {
      notifyError('查询失败', '获取Webhook日志失败');
    } finally {
      setLoading(false);
    }
  };

  // 查看详情
  const viewDetail = async (logId: number) => {
    setDetailModalVisible(true);
    setDetailLoading(true);
    setSelectedDetail(null);

    try {
      const response = await axios.get(`/api/ef/v1/audit/webhooks/logs/${logId}`);
      if (response.data.ok) {
        setSelectedDetail(response.data.data);
      } else {
        notifyError('获取详情失败', response.data.error?.detail || '未知错误');
      }
    } catch {
      notifyError('获取详情失败', '无法获取Webhook日志详情');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchShops();
    // 默认最近7天
    form.setFieldsValue({
      date_range: [dayjs().subtract(7, 'days'), dayjs()],
    });
    fetchLogs();
  }, []);

  // 状态标签颜色
  const getStatusTag = (status: string) => {
    const colors: Record<string, string> = {
      processed: 'success',
      failed: 'error',
      ignored: 'default',
      pending: 'processing',
    };
    const labels: Record<string, string> = {
      processed: '已处理',
      failed: '失败',
      ignored: '已忽略',
      pending: '待处理',
    };
    return <Tag color={colors[status]}>{labels[status] || status}</Tag>;
  };

  // 事件类型中文映射
  const EVENT_TYPE_MAP: Record<string, string> = {
    'ping': 'Ping（连接检查）',
    'posting.created': '新订单创建',
    'posting.cancelled': '订单取消',
    'posting.status_changed': '订单状态变更',
    'posting.delivered': '订单送达',
    'posting.cutoff_date_changed': '订单截止日期变更',
    'posting.delivery_date_changed': '订单配送日期变更',
    'product.created': '商品创建',
    'product.updated': '商品更新',
    'product.create_or_update': '商品创建/更新',
    'product.price_changed': '商品价格变更',
    'product.stock_changed': '库存变更',
    'product.price_index_changed': '价格指数变更',
    'chat.message_created': '新聊天消息',
    'chat.message_updated': '聊天消息更新',
    'chat.message_read': '消息已读',
    'chat.closed': '聊天关闭',
    'return.created': '退货创建',
    'return.status_changed': '退货状态变更',
  };

  // 事件类型标签颜色
  const getEventTypeTag = (eventType: string) => {
    const colors: Record<string, string> = {
      ping: 'blue',
      'posting.created': 'green',
      'posting.cancelled': 'red',
      'posting.status_changed': 'orange',
      'posting.delivered': 'cyan',
      'posting.cutoff_date_changed': 'orange',
      'posting.delivery_date_changed': 'orange',
      'product.created': 'purple',
      'product.updated': 'purple',
      'product.create_or_update': 'purple',
      'product.price_changed': 'gold',
      'product.stock_changed': 'magenta',
      'product.price_index_changed': 'gold',
      'chat.message_created': 'geekblue',
      'chat.message_updated': 'geekblue',
      'chat.message_read': 'lime',
      'chat.closed': 'default',
      'return.created': 'volcano',
      'return.status_changed': 'volcano',
    };
    return <Tag color={colors[eventType] || 'default'}>{EVENT_TYPE_MAP[eventType] || eventType}</Tag>;
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 165,
      render: (text: string) => formatDateTime(text, 'YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '店铺',
      dataIndex: 'shop_name',
      key: 'shop_name',
      minWidth: 150,
    },
    {
      title: '事件类型',
      dataIndex: 'event_type',
      key: 'event_type',
      minWidth: 200,
      render: (text: string) => getEventTypeTag(text),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      minWidth: 100,
      render: (text: string) => getStatusTag(text),
    },
    {
      title: '关联实体',
      key: 'entity',
      width: 220,
      render: (_: unknown, record: WebhookLog) => {
        if (record.entity_type && record.entity_id) {
          // 如果是 posting 类型，优先显示 posting_number，带复制图标
          if (record.entity_type === 'posting') {
            const displayValue = record.posting_number || record.entity_id;
            return (
              <Space size={4}>
                <Text>{displayValue}</Text>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyToClipboard(displayValue!, 'Posting号')}
                  className={styles.copyButton}
                />
              </Space>
            );
          }
          return (
            <Text type="secondary">
              {record.entity_type}: {record.entity_id}
            </Text>
          );
        }
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: '重试',
      dataIndex: 'retry_count',
      key: 'retry_count',
      width: 60,
      render: (count: number) => (count > 0 ? <Tag color="warning">{count}</Tag> : '-'),
    },
    {
      title: '耗时',
      dataIndex: 'processing_duration_ms',
      key: 'processing_duration_ms',
      width: 70,
      render: (ms: number | null) => (ms ? `${ms}ms` : '-'),
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      key: 'error_message',
      minWidth: 200,
      ellipsis: true,
      render: (text: string | null) =>
        text ? <Text type="danger">{text}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: WebhookLog) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          size="small"
          onClick={() => viewDetail(record.id)}
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
        <Form.Item name="shop_id" label="店铺">
          <Select
            className={styles.shopSelect}
            placeholder="全部店铺"
            allowClear
          >
            {shops.map((shop) => (
              <Select.Option key={shop.id} value={shop.id}>
                {shop.shop_name} {shop.shop_name_cn && `[${shop.shop_name_cn}]`}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="event_type" label="事件类型">
          <Select
            className={styles.eventTypeSelect}
            placeholder="全部类型"
            allowClear
          >
            {EVENT_TYPES.map((type) => (
              <Select.Option key={type.value} value={type.value}>
                {type.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="posting_number" label="货件编号">
          <Input
            className={styles.postingNumberInput}
            placeholder="支持精确匹配或左匹配"
            allowClear
          />
        </Form.Item>

        <Form.Item name="status" label="状态">
          <Select
            className={styles.statusSelect}
            placeholder="全部状态"
            allowClear
          >
            {STATUS_OPTIONS.map((status) => (
              <Select.Option key={status.value} value={status.value}>
                {status.label}
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
                  date_range: [dayjs().subtract(7, 'days'), dayjs()],
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
        title="Webhook 日志详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={800}
      >
        {detailLoading ? (
          <div className={styles.detailLoadingContainer}>
            <Spin size="large" />
          </div>
        ) : selectedDetail ? (
          <div>
            <Space direction="vertical" className={styles.detailContent} size="middle">
              <div>
                <Text strong>事件ID：</Text>
                <Text>{selectedDetail.event_id}</Text>
              </div>
              <div>
                <Text strong>事件类型：</Text>
                {getEventTypeTag(selectedDetail.event_type)}
              </div>
              <div>
                <Text strong>店铺：</Text>
                <Text>{selectedDetail.shop_name}</Text>
              </div>
              <div>
                <Text strong>状态：</Text>
                {getStatusTag(selectedDetail.status)}
              </div>
              {selectedDetail.entity_type && (
                <div>
                  <Text strong>关联实体：</Text>
                  <Text>
                    {selectedDetail.entity_type}: {selectedDetail.entity_id}
                  </Text>
                </div>
              )}
              <div>
                <Text strong>重试次数：</Text>
                <Text>{selectedDetail.retry_count}</Text>
              </div>
              {selectedDetail.processing_duration_ms && (
                <div>
                  <Text strong>处理耗时：</Text>
                  <Text>{selectedDetail.processing_duration_ms} ms</Text>
                </div>
              )}
              {selectedDetail.result_message && (
                <div>
                  <Text strong>处理结果：</Text>
                  <Text>{selectedDetail.result_message}</Text>
                </div>
              )}
              {selectedDetail.error_message && (
                <div>
                  <Text strong>错误信息：</Text>
                  <Text type="danger">{selectedDetail.error_message}</Text>
                </div>
              )}
              <div>
                <Text strong>幂等键：</Text>
                <Text>{selectedDetail.idempotency_key || '-'}</Text>
              </div>
              <div>
                <Text strong>创建时间：</Text>
                <Text>{formatDateTime(selectedDetail.created_at, 'YYYY-MM-DD HH:mm:ss')}</Text>
              </div>
              {selectedDetail.processed_at && (
                <div>
                  <Text strong>处理时间：</Text>
                  <Text>{formatDateTime(selectedDetail.processed_at, 'YYYY-MM-DD HH:mm:ss')}</Text>
                </div>
              )}
              <div>
                <Text strong>Payload：</Text>
                <pre className={styles.detailPayload}>
                  {JSON.stringify(selectedDetail.payload, null, 2)}
                </pre>
              </div>
              {selectedDetail.headers && (
                <div>
                  <Text strong>Headers：</Text>
                  <pre className={styles.detailHeaders}>
                    {JSON.stringify(selectedDetail.headers, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </div>
        ) : (
          <Empty description="无法加载详情" />
        )}
      </Modal>
    </>
  );
};

export default WebhookLogsTable;
