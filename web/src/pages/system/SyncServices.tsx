/**
 * 后台服务管理页面（增强版）
 *
 * 新增功能：
 * 1. 编辑服务配置（EditServiceModal）
 * 2. 添加新服务（AddServiceModal）
 * 3. 可视化Cron编辑器（react-js-cron）
 * 4. 清空日志（按日期）
 */
import { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Descriptions,
  Switch,
  Tooltip,
  Spin,
  Form,
  Input,
  Radio,
  InputNumber,
  DatePicker,
  Select,
  Popconfirm,
} from 'antd';
import {
  SyncOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  BarChartOutlined,
  ReloadOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Cron } from 'react-js-cron';
import 'react-js-cron/dist/styles.css';
import axios from '@/services/axios';
import dayjs from 'dayjs';
import { notifySuccess, notifyError } from '@/utils/notification';
import { usePermission } from '@/hooks/usePermission';

const { TextArea } = Input;

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

interface HandlerInfo {
  service_key: string;
  name: string;
  description: string;
  plugin: string;
  config_schema: Record<string, any>;
}

const SyncServices = () => {
  const { canOperate } = usePermission();
  const [services, setServices] = useState<SyncService[]>([]);
  const [handlers, setHandlers] = useState<HandlerInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // 日志模态框
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [logs, setLogs] = useState<SyncServiceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // 统计模态框
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [stats, setStats] = useState<SyncServiceStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // 编辑模态框
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();

  // 添加模态框
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addForm] = Form.useForm();

  const [selectedService, setSelectedService] = useState<SyncService | null>(null);

  // 加载服务列表
  const loadServices = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/sync-services');
      setServices(response.data || []);
    } catch (error: any) {
      notifyError('加载失败', error.response?.data?.error?.detail || '加载服务列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载可用Handler列表
  const loadHandlers = async () => {
    try {
      const response = await axios.get('/api/ef/v1/sync-services/handlers');
      setHandlers(response.data || []);
    } catch (error: any) {
      console.error('加载Handler列表失败:', error);
    }
  };

  // 切换服务状态
  const toggleService = async (service: SyncService) => {
    try {
      await axios.post(`/api/ef/v1/sync-services/${service.id}/toggle`);
      notifySuccess('操作成功', `服务已${service.is_enabled ? '禁用' : '启用'}`);
      loadServices();
    } catch (error: any) {
      notifyError('操作失败', error.response?.data?.error?.detail || '操作失败');
    }
  };

  // 手动触发服务
  const triggerService = async (service: SyncService) => {
    try {
      await axios.post(`/api/ef/v1/sync-services/${service.id}/trigger`);
      notifySuccess('触发成功', '服务已触发，正在后台执行');
      setTimeout(loadServices, 3000);
    } catch (error: any) {
      notifyError('触发失败', error.response?.data?.error?.detail || '触发失败');
    }
  };

  // 查看日志
  const viewLogs = async (service: SyncService) => {
    setSelectedService(service);
    setLogsModalVisible(true);
    setLogsLoading(true);
    try {
      const response = await axios.get(`/api/ef/v1/sync-services/${service.id}/logs`);
      setLogs(response.data || []);
    } catch (error: any) {
      notifyError('加载失败', error.response?.data?.error?.detail || '加载日志失败');
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
      const response = await axios.get(`/api/ef/v1/sync-services/${service.id}/stats`);
      setStats(response.data || null);
    } catch (error: any) {
      notifyError('加载失败', error.response?.data?.error?.detail || '加载统计失败');
    } finally {
      setStatsLoading(false);
    }
  };

  // 打开编辑对话框
  const openEditModal = (service: SyncService) => {
    setSelectedService(service);
    editForm.setFieldsValue({
      service_name: service.service_name,
      service_description: service.service_description,
      service_type: service.service_type,
      // 如果是 interval 类型，将字符串转换为数字
      schedule_config: service.service_type === 'interval'
        ? parseInt(service.schedule_config)
        : service.schedule_config,
      is_enabled: service.is_enabled,
    });
    setEditModalVisible(true);
  };

  // 提交编辑
  const handleEditSubmit = async (values: any) => {
    if (!selectedService) return;

    try {
      // 如果是 interval 类型，确保 schedule_config 是字符串
      const payload = {
        ...values,
        schedule_config: values.service_type === 'interval'
          ? String(values.schedule_config)
          : values.schedule_config
      };

      await axios.put(`/api/ef/v1/sync-services/${selectedService.id}`, payload);
      notifySuccess('更新成功', '服务配置已更新');
      setEditModalVisible(false);
      editForm.resetFields();
      loadServices();
    } catch (error: any) {
      notifyError('更新失败', error.response?.data?.detail || '更新失败');
    }
  };

  // 打开添加对话框
  const openAddModal = () => {
    addForm.resetFields();
    setAddModalVisible(true);
  };

  // 提交添加
  const handleAddSubmit = async (values: any) => {
    try {
      // 如果是 interval 类型，确保 schedule_config 是字符串
      const payload = {
        ...values,
        schedule_config: values.service_type === 'interval'
          ? String(values.schedule_config)
          : values.schedule_config
      };

      await axios.post('/api/ef/v1/sync-services', payload);
      notifySuccess('添加成功', '服务已添加');
      setAddModalVisible(false);
      addForm.resetFields();
      loadServices();
    } catch (error: any) {
      notifyError('添加失败', error.response?.data?.detail || '添加失败');
    }
  };

  // 清空日志
  const clearLogs = async (service: SyncService, beforeDate?: string) => {
    try {
      const response = await axios.delete(`/api/ef/v1/sync-services/${service.id}/logs`, {
        data: { before_date: beforeDate }
      });
      notifySuccess('清空成功', `已清空 ${response.data.data.deleted_count} 条日志`);
      if (logsModalVisible && selectedService?.id === service.id) {
        viewLogs(service);
      }
    } catch (error: any) {
      notifyError('清空失败', error.response?.data?.detail || '清空日志失败');
    }
  };

  // 重置统计
  const resetStats = async (service: SyncService) => {
    try {
      await axios.post(`/api/ef/v1/sync-services/${service.id}/reset-stats`);
      notifySuccess('重置成功', '统计数据已重置');
      loadServices(); // 刷新服务列表
      if (statsModalVisible && selectedService?.id === service.id) {
        viewStats(service); // 刷新统计数据
      }
    } catch (error: any) {
      notifyError('重置失败', error.response?.data?.error?.detail || '重置统计失败');
    }
  };

  useEffect(() => {
    loadServices();
    loadHandlers();
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
      width: 320,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          {canOperate && (
            <>
              <Tooltip title={record.is_enabled ? '禁用服务' : '启用服务'}>
                <Switch
                  size="small"
                  checked={record.is_enabled}
                  onChange={() => toggleService(record)}
                />
              </Tooltip>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEditModal(record)}
              >
                编辑
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => triggerService(record)}
              >
                触发
              </Button>
            </>
          )}
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => viewLogs(record)}
          />
          <Button
            size="small"
            icon={<BarChartOutlined />}
            onClick={() => viewStats(record)}
          />
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
        const shortText = text.includes(':') ? text.split(':')[0] : text;
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
        <Space>
          {canOperate && (
            <Button icon={<PlusOutlined />} type="primary" onClick={openAddModal}>
              添加服务
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={loadServices}>
            刷新
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={services}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 1400 }}
      />

      {/* 编辑服务对话框 */}
      <Modal
        title="编辑服务配置"
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          editForm.resetFields();
        }}
        onOk={() => editForm.submit()}
        width={700}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleEditSubmit}
        >
          <Form.Item
            label="服务名称"
            name="service_name"
            rules={[{ required: true, message: '请输入服务名称' }]}
          >
            <Input placeholder="服务显示名称" />
          </Form.Item>

          <Form.Item
            label="服务描述"
            name="service_description"
          >
            <TextArea rows={3} placeholder="服务功能说明" />
          </Form.Item>

          <Form.Item
            label="调度类型"
            name="service_type"
            rules={[{ required: true }]}
          >
            <Radio.Group>
              <Radio value="cron">Cron定时</Radio>
              <Radio value="interval">间隔周期</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.service_type !== curr.service_type}>
            {({ getFieldValue }) => {
              const serviceType = getFieldValue('service_type');

              if (serviceType === 'cron') {
                return (
                  <Form.Item
                    label="Cron表达式"
                    name="schedule_config"
                    rules={[{ required: true, message: '请配置Cron表达式' }]}
                  >
                    <Cron
                      value={editForm.getFieldValue('schedule_config') || '0 * * * *'}
                      setValue={(value) => editForm.setFieldValue('schedule_config', value)}
                      clearButton={false}
                    />
                  </Form.Item>
                );
              } else {
                return (
                  <Form.Item
                    label="间隔秒数"
                    name="schedule_config"
                    rules={[{ required: true, message: '请输入间隔秒数' }]}
                  >
                    <InputNumber
                      min={1}
                      addonAfter="秒"
                      placeholder="执行间隔（秒）"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                );
              }
            }}
          </Form.Item>

          <Form.Item
            label="启用状态"
            name="is_enabled"
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 添加服务对话框 */}
      <Modal
        title="添加服务"
        open={addModalVisible}
        onCancel={() => {
          setAddModalVisible(false);
          addForm.resetFields();
        }}
        onOk={() => addForm.submit()}
        width={700}
      >
        <Form
          form={addForm}
          layout="vertical"
          onFinish={handleAddSubmit}
        >
          <Form.Item
            label="选择Handler"
            name="service_key"
            rules={[{ required: true, message: '请选择Handler' }]}
          >
            <Select placeholder="从已注册的Handler中选择">
              {handlers.map((h) => (
                <Select.Option key={h.service_key} value={h.service_key}>
                  {h.name} ({h.plugin})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="服务名称"
            name="service_name"
            rules={[{ required: true, message: '请输入服务名称' }]}
          >
            <Input placeholder="服务显示名称" />
          </Form.Item>

          <Form.Item
            label="服务描述"
            name="service_description"
          >
            <TextArea rows={3} placeholder="服务功能说明" />
          </Form.Item>

          <Form.Item
            label="调度类型"
            name="service_type"
            rules={[{ required: true }]}
            initialValue="cron"
          >
            <Radio.Group>
              <Radio value="cron">Cron定时</Radio>
              <Radio value="interval">间隔周期</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.service_type !== curr.service_type}>
            {({ getFieldValue }) => {
              const serviceType = getFieldValue('service_type');

              if (serviceType === 'cron') {
                return (
                  <Form.Item
                    label="Cron表达式"
                    name="schedule_config"
                    rules={[{ required: true, message: '请配置Cron表达式' }]}
                    initialValue="0 * * * *"
                  >
                    <Cron
                      value={addForm.getFieldValue('schedule_config') || '0 * * * *'}
                      setValue={(value) => addForm.setFieldValue('schedule_config', value)}
                      clearButton={false}
                    />
                  </Form.Item>
                );
              } else {
                return (
                  <Form.Item
                    label="间隔秒数"
                    name="schedule_config"
                    rules={[{ required: true, message: '请输入间隔秒数' }]}
                  >
                    <InputNumber
                      min={1}
                      addonAfter="秒"
                      placeholder="执行间隔（秒）"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                );
              }
            }}
          </Form.Item>

          <Form.Item
            label="启用状态"
            name="is_enabled"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 日志模态框 */}
      <Modal
        title={`执行日志 - ${selectedService?.service_name}`}
        open={logsModalVisible}
        onCancel={() => setLogsModalVisible(false)}
        width={1000}
        footer={
          <Space>
            {canOperate && (
              <Popconfirm
                title="清空日志"
                description={
                  <div>
                    <p>选择清空范围：</p>
                    <DatePicker
                      placeholder="清空此日期前的日志（可选）"
                      onChange={(date) => {
                        if (selectedService) {
                          clearLogs(selectedService, date ? date.toISOString() : undefined);
                        }
                      }}
                    />
                  </div>
                }
                onConfirm={() => {
                  if (selectedService) {
                    clearLogs(selectedService);
                  }
                }}
                okText="全部清空"
                cancelText="取消"
              >
                <Button danger icon={<DeleteOutlined />}>
                  清空日志
                </Button>
              </Popconfirm>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => selectedService && viewLogs(selectedService)}>
              刷新日志
            </Button>
          </Space>
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
        footer={
          <Space>
            {canOperate && (
              <Popconfirm
                title="重置统计数据"
                description="确定要重置此服务的统计数据吗？这将清空总运行次数、成功次数、失败次数等统计信息。"
                onConfirm={() => {
                  if (selectedService) {
                    resetStats(selectedService);
                  }
                }}
                okText="确定"
                cancelText="取消"
              >
                <Button danger icon={<DeleteOutlined />}>
                  重置统计
                </Button>
              </Popconfirm>
            )}
            <Button onClick={() => setStatsModalVisible(false)}>
              关闭
            </Button>
          </Space>
        }
      >
        <Spin spinning={statsLoading}>
          {stats && (
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
          )}
        </Spin>
      </Modal>
    </Card>
  );
};

export default SyncServices;
