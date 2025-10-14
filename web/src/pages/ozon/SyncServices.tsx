import { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  message,
  Modal,
  Descriptions,
  Switch,
  Tooltip,
  Spin,
} from 'antd';
import {
  SyncOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  BarChartOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import axios from '@/services/axios';

interface SyncService {
  id: number;
  service_key: string;
  service_name: string;
  service_description: string;
  service_type: string;
  schedule_config: string;
  is_enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  run_count: number;
  success_count: number;
  error_count: number;
  config_json: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface SyncServiceLog {
  id: number;
  service_key: string;
  run_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_processed: number;
  records_updated: number;
  execution_time_ms: number | null;
  error_message: string | null;
  extra_data?: Record<string, any>;
}

interface SyncServiceStats {
  total_runs: number;
  success_rate: number;
  avg_execution_time_ms: number | null;
  recent_errors: Array<{
    run_id: string;
    started_at: string;
    error_message: string;
  }>;
}

const SyncServices = () => {
  const [services, setServices] = useState<SyncService[]>([]);
  const [loading, setLoading] = useState(false);
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [selectedService, setSelectedService] = useState<SyncService | null>(null);
  const [logs, setLogs] = useState<SyncServiceLog[]>([]);
  const [stats, setStats] = useState<SyncServiceStats | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);

  // 加载服务列表
  const loadServices = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/ozon/sync-services');
      setServices(response.data || []);
    } catch (error: any) {
      message.error(error.response?.data?.error?.detail || '加载服务列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 切换服务状态
  const toggleService = async (service: SyncService) => {
    try {
      await axios.post(`/api/ef/v1/ozon/sync-services/${service.id}/toggle`);
      message.success(`服务已${service.is_enabled ? '禁用' : '启用'}`);
      loadServices();
    } catch (error: any) {
      message.error(error.response?.data?.error?.detail || '操作失败');
    }
  };

  // 手动触发服务
  const triggerService = async (service: SyncService) => {
    try {
      await axios.post(`/api/ef/v1/ozon/sync-services/${service.id}/trigger`);
      message.success('服务已触发，正在后台执行');
      // 3秒后刷新列表
      setTimeout(loadServices, 3000);
    } catch (error: any) {
      message.error(error.response?.data?.error?.detail || '触发失败');
    }
  };

  // 查看日志
  const viewLogs = async (service: SyncService) => {
    setSelectedService(service);
    setLogsModalVisible(true);
    setLogsLoading(true);
    try {
      const response = await axios.get(`/api/ef/v1/ozon/sync-services/${service.id}/logs`);
      setLogs(response.data || []);
    } catch (error: any) {
      message.error(error.response?.data?.error?.detail || '加载日志失败');
    } finally {
      setLogsLoading(false);
    }
  };

  // 查看统计
  const viewStats = async (service: SyncService) => {
    setSelectedService(service);
    setStatsModalVisible(true);
    setStatsLoading(true);
    try {
      const response = await axios.get(`/api/ef/v1/ozon/sync-services/${service.id}/stats`);
      setStats(response.data || null);
    } catch (error: any) {
      message.error(error.response?.data?.error?.detail || '加载统计失败');
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
    // 每30秒自动刷新
    const interval = setInterval(loadServices, 30000);
    return () => clearInterval(interval);
  }, []);

  const columns: ColumnsType<SyncService> = [
    {
      title: '服务名称',
      dataIndex: 'service_name',
      key: 'service_name',
      width: 200,
    },
    {
      title: '描述',
      dataIndex: 'service_description',
      key: 'service_description',
      ellipsis: true,
    },
    {
      title: '调度配置',
      key: 'schedule',
      width: 150,
      render: (_, record) => (
        <span>
          {record.service_type === 'interval'
            ? `每 ${Math.floor(parseInt(record.schedule_config) / 60)} 分钟`
            : record.schedule_config}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_, record) => (
        <Tag color={record.is_enabled ? 'green' : 'default'}>
          {record.is_enabled ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '最后运行',
      key: 'last_run',
      width: 200,
      render: (_, record) => (
        <div>
          {record.last_run_at ? (
            <>
              <div>{new Date(record.last_run_at).toLocaleString('zh-CN')}</div>
              <Tag color={record.last_run_status === 'success' ? 'green' : 'red'}>
                {record.last_run_status === 'success' ? '成功' : '失败'}
              </Tag>
            </>
          ) : (
            <span style={{ color: '#999' }}>未运行</span>
          )}
        </div>
      ),
    },
    {
      title: '统计',
      key: 'stats',
      width: 150,
      render: (_, record) => (
        <div>
          <div>总计: {record.run_count}</div>
          <div style={{ color: '#52c41a' }}>成功: {record.success_count}</div>
          <div style={{ color: '#f5222d' }}>失败: {record.error_count}</div>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_, record) => (
        <Space>
          <Tooltip title={record.is_enabled ? '禁用服务' : '启用服务'}>
            <Switch
              size="small"
              checked={record.is_enabled}
              onChange={() => toggleService(record)}
            />
          </Tooltip>
          <Tooltip title="手动触发">
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => triggerService(record)}
            >
              触发
            </Button>
          </Tooltip>
          <Tooltip title="查看日志">
            <Button size="small" icon={<FileTextOutlined />} onClick={() => viewLogs(record)} />
          </Tooltip>
          <Tooltip title="查看统计">
            <Button size="small" icon={<BarChartOutlined />} onClick={() => viewStats(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const logColumns: ColumnsType<SyncServiceLog> = [
    {
      title: '订单号',
      key: 'posting_number',
      ellipsis: true,
      width: 250,
      render: (_, record) => {
        // 优先显示 extra_data 中的 posting_number
        const extraData = record.extra_data as any;
        return extraData?.posting_number || record.run_id;
      },
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 180,
      render: (text) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 100,
      render: (_, record) =>
        record.execution_time_ms ? `${(record.execution_time_ms / 1000).toFixed(2)}秒` : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (text) => (
        <Tag color={text === 'success' ? 'green' : 'red'}>{text === 'success' ? '成功' : '失败'}</Tag>
      ),
    },
    {
      title: '处理/更新',
      key: 'records',
      width: 120,
      render: (_, record) => `${record.records_processed} / ${record.records_updated}`,
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      key: 'error_message',
      ellipsis: true,
      render: (text) => {
        if (!text) return '-';
        // 简化显示：如果包含冒号，只取冒号前的部分
        const shortText = text.includes(':') ? text.split(':')[0] : text;
        // 限制长度为30个字符
        const displayText = shortText.length > 30 ? shortText.substring(0, 30) + '...' : shortText;
        return (
          <Tooltip title={text}>
            <span style={{ color: '#f5222d' }}>{displayText}</span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Card
      title={
        <Space>
          <SyncOutlined />
          后台服务管理
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadServices}>
          刷新
        </Button>
      }
    >
      <Table
        columns={columns}
        dataSource={services}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 1200 }}
      />

      {/* 日志模态框 */}
      <Modal
        title={`执行日志 - ${selectedService?.service_name}`}
        open={logsModalVisible}
        onCancel={() => setLogsModalVisible(false)}
        width={1000}
        footer={
          <Button icon={<ReloadOutlined />} onClick={() => selectedService && viewLogs(selectedService)}>
            刷新日志
          </Button>
        }
      >
        <Spin spinning={logsLoading}>
          <Table
            columns={logColumns}
            dataSource={logs}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            scroll={{ x: 900 }}
          />
        </Spin>
      </Modal>

      {/* 统计模态框 */}
      <Modal
        title={`服务统计 - ${selectedService?.service_name}`}
        open={statsModalVisible}
        onCancel={() => setStatsModalVisible(false)}
        width={800}
        footer={null}
      >
        <Spin spinning={statsLoading}>
          {stats && (
            <>
              <Descriptions bordered column={2}>
                <Descriptions.Item label="总运行次数">{stats.total_runs}</Descriptions.Item>
                <Descriptions.Item label="成功率">
                  <Tag color={stats.success_rate >= 90 ? 'green' : stats.success_rate >= 70 ? 'orange' : 'red'}>
                    {stats.success_rate.toFixed(2)}%
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="平均执行时间" span={2}>
                  {stats.avg_execution_time_ms
                    ? `${(stats.avg_execution_time_ms / 1000).toFixed(2)} 秒`
                    : '-'}
                </Descriptions.Item>
              </Descriptions>

              {stats.recent_errors.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h4>最近错误</h4>
                  {stats.recent_errors.map((error, index) => (
                    <Card key={index} size="small" style={{ marginBottom: 8 }}>
                      <div>
                        <strong>运行ID:</strong> {error.run_id}
                      </div>
                      <div>
                        <strong>时间:</strong> {new Date(error.started_at).toLocaleString('zh-CN')}
                      </div>
                      <div style={{ color: '#f5222d' }}>
                        <strong>错误:</strong> {error.error_message}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </Spin>
      </Modal>
    </Card>
  );
};

export default SyncServices;
