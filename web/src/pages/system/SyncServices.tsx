/**
 * 后台服务管理页面
 *
 * 功能：
 * 1. 查看服务列表
 * 2. 编辑服务配置（cron 表达式、启用/禁用）
 * 3. 手动触发服务（通过 Celery Beat）
 * 4. 查看日志
 * 5. 查看统计
 * 6. 清空日志
 * 7. 重置统计
 */
import {
  SyncOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  BarChartOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Card, Table, Button, Space, Tag, Modal, Descriptions, Tooltip, Spin, App, Form, Input, Switch } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState, useEffect } from 'react';

import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

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
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Celery 集成字段
  celery_task_name: string | null;
  plugin_name: string | null;
  source: string | null;
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
  extra_data?: Record<string, unknown>;
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

// 触发按钮组件 - 带执行中状态
const TriggerButton: React.FC<{
  service: SyncService;
  onTrigger: (service: SyncService) => Promise<void>;
}> = ({ service, onTrigger }) => {
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await onTrigger(service);
      // 保持 3 秒的执行中状态
      setTimeout(() => setTriggering(false), 3000);
    } catch {
      setTriggering(false);
    }
  };

  return (
    <Button
      type="primary"
      size="small"
      icon={<PlayCircleOutlined spin={triggering} />}
      onClick={handleTrigger}
      loading={triggering}
      disabled={!service.celery_task_name}
    >
      {triggering ? '执行中...' : '触发'}
    </Button>
  );
};

const SyncServices = () => {
  const { modal } = App.useApp();
  const { canOperate } = usePermission();
  const [services, setServices] = useState<SyncService[]>([]);
  const [loading, setLoading] = useState(false);

  // 编辑模态框
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();

  // 日志模态框
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [logs, setLogs] = useState<SyncServiceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // 统计模态框
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [stats, setStats] = useState<SyncServiceStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [selectedService, setSelectedService] = useState<SyncService | null>(null);

  // 加载服务列表
  const loadServices = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ef/v1/sync-services');
      setServices(response.data || []);
    } catch (error) {
      notifyError('加载失败', error.response?.data?.error?.detail || '加载服务列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 打开编辑模态框
  const openEditModal = (service: SyncService) => {
    setSelectedService(service);
    editForm.setFieldsValue({
      schedule_config: service.schedule_config,
      is_enabled: service.is_enabled,
    });
    setEditModalVisible(true);
  };

  // 保存编辑
  const saveEdit = async () => {
    if (!selectedService) return;

    try {
      const values = await editForm.validateFields();
      setEditLoading(true);

      await axios.put(`/api/ef/v1/sync-services/${selectedService.id}`, {
        schedule_config: values.schedule_config,
        is_enabled: values.is_enabled,
      });

      notifySuccess('保存成功', '服务配置已更新');
      setEditModalVisible(false);
      loadServices();
    } catch (error) {
      notifyError('保存失败', error.response?.data?.detail || '保存服务配置失败');
    } finally {
      setEditLoading(false);
    }
  };

  // 快速切换启用/禁用
  const toggleEnabled = async (service: SyncService) => {
    try {
      await axios.put(`/api/ef/v1/sync-services/${service.id}`, {
        is_enabled: !service.is_enabled,
      });
      notifySuccess('操作成功', service.is_enabled ? '服务已禁用' : '服务已启用');
      loadServices();
    } catch (error) {
      notifyError('操作失败', error.response?.data?.detail || '切换状态失败');
    }
  };

  // 手动触发服务
  const triggerService = async (service: SyncService) => {
    try {
      await axios.post(`/api/ef/v1/sync-services/${service.id}/trigger`);
      notifySuccess('触发成功', '服务已触发，正在后台执行');
      setTimeout(loadServices, 3000);
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      notifyError('加载失败', error.response?.data?.error?.detail || '加载统计失败');
    } finally {
      setStatsLoading(false);
    }
  };

  // 清空日志
  const clearLogs = async (service: SyncService, beforeDate?: string) => {
    try {
      const response = await axios.delete(`/api/ef/v1/sync-services/${service.id}/logs`, {
        data: { before_date: beforeDate },
      });
      notifySuccess('清空成功', `已清空 ${response.data.data.deleted_count} 条日志`);
      if (logsModalVisible && selectedService?.id === service.id) {
        viewLogs(service);
      }
    } catch (error) {
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
    } catch (error) {
      notifyError('重置失败', error.response?.data?.error?.detail || '重置统计失败');
    }
  };

  useEffect(() => {
    loadServices();
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
        canOperate ? (
          <Switch
            checked={record.is_enabled}
            checkedChildren="启用"
            unCheckedChildren="禁用"
            onChange={() => toggleEnabled(record)}
          />
        ) : (
          <Tag color={record.is_enabled ? 'green' : 'default'}>
            {record.is_enabled ? '启用' : '禁用'}
          </Tag>
        )
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
      width: 300,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          {canOperate && (
            <>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEditModal(record)}
              >
                编辑
              </Button>
              <TriggerButton service={record} onTrigger={triggerService} />
            </>
          )}
          <Button size="small" icon={<FileTextOutlined />} onClick={() => viewLogs(record)} />
          <Button size="small" icon={<BarChartOutlined />} onClick={() => viewStats(record)} />
        </Space>
      ),
    },
  ];

  const logColumns: ColumnsType<SyncServiceLog> = [
    {
      title: '运行 ID',
      dataIndex: 'run_id',
      key: 'run_id',
      ellipsis: true,
      width: 200,
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
        <Tag color={text === 'success' ? 'green' : 'red'}>
          {text === 'success' ? '成功' : '失败'}
        </Tag>
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
    <div>
      <PageTitle icon={<SyncOutlined />} title="后台服务管理" />

      <Card
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
            <Space>
              {canOperate && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    modal.confirm({
                      title: '清空日志',
                      content: '确定要清空此服务的全部日志吗？',
                      okText: '全部清空',
                      cancelText: '取消',
                      onOk: () => {
                        if (selectedService) {
                          clearLogs(selectedService);
                        }
                      },
                    });
                  }}
                >
                  清空日志
                </Button>
              )}
              <Button
                icon={<ReloadOutlined />}
                onClick={() => selectedService && viewLogs(selectedService)}
              >
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

        {/* 编辑模态框 */}
        <Modal
          title={`编辑服务 - ${selectedService?.service_name}`}
          open={editModalVisible}
          onCancel={() => setEditModalVisible(false)}
          onOk={saveEdit}
          confirmLoading={editLoading}
          okText="保存"
          cancelText="取消"
        >
          <Form form={editForm} layout="vertical">
            <Form.Item
              name="schedule_config"
              label="Cron 表达式"
              rules={[{ required: true, message: '请输入 Cron 表达式' }]}
              extra={
                <span style={{ color: '#888' }}>
                  格式：分 时 日 月 周，例如 */5 * * * * 表示每5分钟执行
                </span>
              }
            >
              <Input placeholder="*/5 * * * *" />
            </Form.Item>
            <Form.Item
              name="is_enabled"
              label="启用状态"
              valuePropName="checked"
            >
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
            {selectedService?.celery_task_name && (
              <Form.Item label="Celery 任务名">
                <Input value={selectedService.celery_task_name} disabled />
              </Form.Item>
            )}
            {selectedService?.plugin_name && (
              <Form.Item label="所属插件">
                <Input value={selectedService.plugin_name} disabled />
              </Form.Item>
            )}
          </Form>
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
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    modal.confirm({
                      title: '重置统计数据',
                      content:
                        '确定要重置此服务的统计数据吗？这将清空总运行次数、成功次数、失败次数等统计信息。',
                      okText: '确定',
                      cancelText: '取消',
                      onOk: () => {
                        if (selectedService) {
                          resetStats(selectedService);
                        }
                      },
                    });
                  }}
                >
                  重置统计
                </Button>
              )}
              <Button onClick={() => setStatsModalVisible(false)}>关闭</Button>
            </Space>
          }
        >
          <Spin spinning={statsLoading}>
            {stats && (
              <Descriptions bordered column={2}>
                <Descriptions.Item label="总运行次数">{stats.total_runs}</Descriptions.Item>
                <Descriptions.Item label="成功率">
                  <Tag
                    color={
                      stats.success_rate >= 90
                        ? 'green'
                        : stats.success_rate >= 70
                          ? 'orange'
                          : 'red'
                    }
                  >
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
    </div>
  );
};

export default SyncServices;
