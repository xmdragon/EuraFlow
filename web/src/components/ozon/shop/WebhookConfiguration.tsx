/**
 * Webhook 配置组件
 */
import React, { useState } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Alert,
  Badge,
  Modal,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as ozonApi from '@/services/ozonApi';
import { notifySuccess, notifyError } from '@/utils/notification';
import styles from '../../../pages/ozon/ShopSettings.module.scss';

const { Text } = Typography;
const { confirm } = Modal;

interface Shop {
  id: number;
  shop_name: string;
  shop_name_cn?: string;
  platform: string;
  status: 'active' | 'inactive' | 'suspended';
}

export interface WebhookConfigurationProps {
  selectedShop: Shop | null;
}

export const WebhookConfiguration: React.FC<WebhookConfigurationProps> = ({ selectedShop }) => {
  const [webhookConfig, setWebhookConfig] = useState<any>(null);
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [eventsModalVisible, setEventsModalVisible] = useState(false);
  const [configForm] = Form.useForm();

  // 获取webhook配置
  const { data: webhookData, refetch: refetchWebhookConfig } = useQuery({
    queryKey: ['ozon', 'webhook-config', selectedShop?.id],
    queryFn: () => ozonApi.getWebhookConfig(selectedShop!.id),
    enabled: !!selectedShop?.id,
    staleTime: 30 * 1000,
  });

  // 配置webhook
  const configureWebhookMutation = useMutation({
    mutationFn: async (config: any) => {
      return ozonApi.configureWebhook(selectedShop!.id, config);
    },
    onSuccess: (data) => {
      notifySuccess('配置成功', 'Webhook配置成功');
      setConfigModalVisible(false);
      refetchWebhookConfig();

      // 显示配置成功信息
      Modal.info({
        title: '配置成功！',
        width: 600,
        content: (
          <div>
            <Typography.Paragraph>
              Webhook已成功配置，请按以下步骤在Ozon后台完成设置：
            </Typography.Paragraph>
            <ol>
              <li>登录 Ozon 卖家后台</li>
              <li>进入"设置" → "Webhook"配置页面</li>
              <li>设置 Webhook URL: <Text code copyable>{data.webhook_url}</Text></li>
              <li>启用以下事件类型：
                <ul style={{ marginTop: 8 }}>
                  <li>posting.status_changed（订单状态变更）</li>
                  <li>posting.cancelled（订单取消）</li>
                  <li>posting.delivered（订单妥投）</li>
                  <li>product.price_changed（商品价格变更）</li>
                  <li>product.stock_changed（商品库存变更）</li>
                  <li>return.created（退货创建）</li>
                  <li>return.status_changed（退货状态变更）</li>
                </ul>
              </li>
              <li>点击"测试"按钮验证配置</li>
            </ol>
          </div>
        ),
      });
    },
    onError: (error: any) => {
      notifyError('配置失败', `配置失败: ${error.message}`);
    },
  });

  // 测试webhook
  const testWebhookMutation = useMutation({
    mutationFn: async () => {
      return ozonApi.testWebhook(selectedShop!.id);
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('测试成功', 'Webhook测试成功');
      } else {
        notifyError('测试失败', `Webhook测试失败: ${data.message}`);
      }
    },
    onError: (error: any) => {
      notifyError('测试失败', `测试失败: ${error.message}`);
    },
  });

  // 删除webhook配置
  const deleteWebhookMutation = useMutation({
    mutationFn: async () => {
      return ozonApi.deleteWebhookConfig(selectedShop!.id);
    },
    onSuccess: () => {
      notifySuccess('删除成功', 'Webhook配置已删除');
      refetchWebhookConfig();
    },
    onError: (error: any) => {
      notifyError('删除失败', `删除失败: ${error.message}`);
    },
  });

  // 获取webhook事件列表
  const fetchWebhookEvents = async () => {
    if (!selectedShop?.id) return;

    setLoading(true);
    try {
      const response = await ozonApi.getWebhookEvents(selectedShop.id);
      setWebhookEvents(response.events || []);
    } catch (error: any) {
      notifyError('获取失败', `获取事件失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigureWebhook = () => {
    // 自动生成webhook URL
    // 本地开发环境使用后端端口8000，生产环境使用当前域名
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isDev
      ? `http://localhost:8000`  // 本地开发直接指向后端
      : window.location.origin;   // 生产环境使用当前域名
    const webhookUrl = `${baseUrl}/api/ef/v1/ozon/webhook`;

    configForm.setFieldsValue({
      webhook_url: webhookUrl,
    });
    setConfigModalVisible(true);
  };

  const handleDeleteWebhook = () => {
    confirm({
      title: '确认删除',
      content: '确定要删除Webhook配置吗？删除后将无法接收实时事件通知。',
      onOk: () => deleteWebhookMutation.mutate(),
    });
  };

  const webhookEnabled = webhookData?.webhook_enabled;

  return (
    <div>
      <Alert
        message="Webhook 实时事件通知"
        description="配置Webhook后，系统将实时接收Ozon平台的事件通知，如订单状态变更、商品价格变更等，无需定时轮询，提高响应速度。"
        type="info"
        showIcon
        className={styles.webhookAlert}
      />

      <Card size="small" title="配置状态">
        <Space direction="vertical" className={styles.webhookStatusCard}>
          <div>
            <Badge
              status={webhookEnabled ? 'success' : 'default'}
              text={webhookEnabled ? '已配置' : '未配置'}
            />
          </div>
          {webhookEnabled && (
            <div>
              <Text type="secondary">URL: </Text>
              <Text code className={styles.webhookUrlCode}>
                {webhookData.webhook_url || 'N/A'}
              </Text>
            </div>
          )}
          <Space>
            {webhookEnabled ? (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<ApiOutlined />}
                  onClick={() => testWebhookMutation.mutate()}
                  loading={testWebhookMutation.isPending}
                >
                  测试
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    fetchWebhookEvents();
                    setEventsModalVisible(true);
                  }}
                >
                  查看事件
                </Button>
                <Button
                  danger
                  size="small"
                  onClick={handleDeleteWebhook}
                  loading={deleteWebhookMutation.isPending}
                >
                  删除
                </Button>
              </>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<SettingOutlined />}
                onClick={handleConfigureWebhook}
              >
                配置Webhook
              </Button>
            )}
          </Space>
        </Space>
      </Card>

      {/* 配置Webhook弹窗 */}
      <Modal
        title="配置Webhook"
        open={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={configForm}
          layout="vertical"
          onFinish={(values) => configureWebhookMutation.mutate(values)}
        >
          <Form.Item
            name="webhook_url"
            label="Webhook URL"
            rules={[
              { required: true, message: '请输入Webhook URL' },
              { type: 'url', message: '请输入有效的URL' },
            ]}
            extra="系统将自动生成安全的webhook URL"
          >
            <Input placeholder="https://your-domain.com/api/ef/v1/ozon/webhook" />
          </Form.Item>

          <Alert
            message="配置说明"
            description={
              <div>
                <p>1. Webhook URL 用于接收Ozon平台推送的事件通知</p>
                <p>2. 配置完成后，请在Ozon后台设置相应的Webhook URL</p>
                <p>3. 系统将自动接收并处理Ozon推送的实时事件</p>
              </div>
            }
            type="info"
            showIcon
            className={styles.modalAlert}
          />

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={configureWebhookMutation.isPending}
              >
                确认配置
              </Button>
              <Button onClick={() => setConfigModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 查看事件弹窗 */}
      <Modal
        title="Webhook事件记录"
        open={eventsModalVisible}
        onCancel={() => setEventsModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setEventsModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={1200}
      >
        <Table
          dataSource={webhookEvents}
          loading={loading}
          size="small"
          rowKey="id"
          columns={[
            {
              title: '事件ID',
              dataIndex: 'event_id',
              key: 'event_id',
              width: 100,
              render: (text) => {
                // 只显示后面的数字部分（去掉evt_前缀）
                const id = text ? text.replace(/^evt_/, '') : '-';
                return <Text code>{id}</Text>;
              }
            },
            {
              title: '事件类型',
              dataIndex: 'event_type',
              key: 'event_type',
              width: 180,
              render: (text) => {
                // 事件类型中文映射
                const eventTypeMap: Record<string, string> = {
                  'posting.status_changed': '订单状态变更',
                  'posting.cancelled': '订单取消',
                  'posting.delivered': '订单妥投',
                  'product.price_changed': '商品价格变更',
                  'product.stock_changed': '商品库存变更',
                  'return.created': '退货创建',
                  'return.status_changed': '退货状态变更',
                };
                const displayText = eventTypeMap[text] || text;
                return <Tag>{displayText}</Tag>;
              }
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 100,
              render: (status) => {
                // 状态中文映射
                const statusMap: Record<string, { text: string; badgeStatus: any }> = {
                  'processed': { text: '已处理', badgeStatus: 'success' },
                  'failed': { text: '失败', badgeStatus: 'error' },
                  'processing': { text: '处理中', badgeStatus: 'processing' },
                  'pending': { text: '待处理', badgeStatus: 'default' },
                };
                const config = statusMap[status] || { text: status, badgeStatus: 'default' };
                return <Badge status={config.badgeStatus} text={config.text} />;
              }
            },
            {
              title: '重试次数',
              dataIndex: 'retry_count',
              key: 'retry_count',
              width: 80,
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 160,
              render: (time) => time ? new Date(time).toLocaleString() : '-'
            },
            {
              title: '错误信息',
              dataIndex: 'error_message',
              key: 'error_message',
              render: (error) => error ? <Text type="danger">{error}</Text> : '-'
            },
          ]}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
          }}
        />
      </Modal>
    </div>
  );
};

export default WebhookConfiguration;
