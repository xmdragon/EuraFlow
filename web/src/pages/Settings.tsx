import React, { useState } from 'react';
import { Card, Form, Switch, Select, Button, Row, Col, Typography, Space, message, Divider } from 'antd';
import { BellOutlined, GlobalOutlined, DatabaseOutlined, SecurityScanOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Option } = Select;

interface SettingsData {
  notifications: {
    email: boolean;
    browser: boolean;
    order_updates: boolean;
    price_alerts: boolean;
    inventory_alerts: boolean;
  };
  display: {
    language: string;
    timezone: string;
    currency: string;
    date_format: string;
  };
  sync: {
    auto_sync: boolean;
    sync_interval: number;
    sync_on_login: boolean;
  };
  security: {
    two_factor_auth: boolean;
    session_timeout: number;
  };
}

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // 默认设置
  const defaultSettings: SettingsData = {
    notifications: {
      email: true,
      browser: false,
      order_updates: true,
      price_alerts: true,
      inventory_alerts: true,
    },
    display: {
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      currency: 'RUB',
      date_format: 'YYYY-MM-DD',
    },
    sync: {
      auto_sync: true,
      sync_interval: 30,
      sync_on_login: true,
    },
    security: {
      two_factor_auth: false,
      session_timeout: 60,
    },
  };

  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      // TODO: 保存设置到后端
      console.log('Saving settings:', values);
      message.success('设置已保存');
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <Title level={3}>系统设置</Title>

      <Form
        form={form}
        layout="vertical"
        initialValues={defaultSettings}
        onFinish={handleSave}
      >
        <Row gutter={24}>
          {/* 通知设置 */}
          <Col xs={24} lg={12}>
            <Card
              title={
                <Space>
                  <BellOutlined />
                  <span>通知设置</span>
                </Space>
              }
              bordered={false}
            >
              <Form.Item
                name={['notifications', 'email']}
                valuePropName="checked"
                label="邮件通知"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name={['notifications', 'browser']}
                valuePropName="checked"
                label="浏览器通知"
              >
                <Switch />
              </Form.Item>

              <Divider />

              <Text type="secondary">通知类型</Text>

              <Form.Item
                name={['notifications', 'order_updates']}
                valuePropName="checked"
                label="订单更新"
                style={{ marginTop: 16 }}
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name={['notifications', 'price_alerts']}
                valuePropName="checked"
                label="价格变动提醒"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name={['notifications', 'inventory_alerts']}
                valuePropName="checked"
                label="库存预警"
              >
                <Switch />
              </Form.Item>
            </Card>
          </Col>

          {/* 显示设置 */}
          <Col xs={24} lg={12}>
            <Card
              title={
                <Space>
                  <GlobalOutlined />
                  <span>显示设置</span>
                </Space>
              }
              bordered={false}
            >
              <Form.Item
                name={['display', 'language']}
                label="界面语言"
              >
                <Select>
                  <Option value="zh-CN">简体中文</Option>
                  <Option value="en-US">English</Option>
                  <Option value="ru-RU">Русский</Option>
                </Select>
              </Form.Item>

              <Form.Item
                name={['display', 'timezone']}
                label="时区"
              >
                <Select>
                  <Option value="Asia/Shanghai">北京时间 (GMT+8)</Option>
                  <Option value="Europe/Moscow">莫斯科时间 (GMT+3)</Option>
                  <Option value="UTC">UTC (GMT+0)</Option>
                </Select>
              </Form.Item>

              <Form.Item
                name={['display', 'currency']}
                label="默认货币"
              >
                <Select>
                  <Option value="RUB">卢布 (₽)</Option>
                  <Option value="CNY">人民币 (¥)</Option>
                  <Option value="USD">美元 ($)</Option>
                </Select>
              </Form.Item>

              <Form.Item
                name={['display', 'date_format']}
                label="日期格式"
              >
                <Select>
                  <Option value="YYYY-MM-DD">2025-01-29</Option>
                  <Option value="DD/MM/YYYY">29/01/2025</Option>
                  <Option value="MM/DD/YYYY">01/29/2025</Option>
                </Select>
              </Form.Item>
            </Card>
          </Col>

          {/* 同步设置 */}
          <Col xs={24} lg={12}>
            <Card
              title={
                <Space>
                  <DatabaseOutlined />
                  <span>数据同步</span>
                </Space>
              }
              bordered={false}
              style={{ marginTop: 24 }}
            >
              <Form.Item
                name={['sync', 'auto_sync']}
                valuePropName="checked"
                label="自动同步"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name={['sync', 'sync_interval']}
                label="同步间隔（分钟）"
              >
                <Select>
                  <Option value={15}>15分钟</Option>
                  <Option value={30}>30分钟</Option>
                  <Option value={60}>1小时</Option>
                  <Option value={120}>2小时</Option>
                  <Option value={240}>4小时</Option>
                </Select>
              </Form.Item>

              <Form.Item
                name={['sync', 'sync_on_login']}
                valuePropName="checked"
                label="登录时同步"
              >
                <Switch />
              </Form.Item>
            </Card>
          </Col>

          {/* 安全设置 */}
          <Col xs={24} lg={12}>
            <Card
              title={
                <Space>
                  <SecurityScanOutlined />
                  <span>安全设置</span>
                </Space>
              }
              bordered={false}
              style={{ marginTop: 24 }}
            >
              <Form.Item
                name={['security', 'two_factor_auth']}
                valuePropName="checked"
                label="双因素认证"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name={['security', 'session_timeout']}
                label="会话超时（分钟）"
              >
                <Select>
                  <Option value={30}>30分钟</Option>
                  <Option value={60}>1小时</Option>
                  <Option value={120}>2小时</Option>
                  <Option value={480}>8小时</Option>
                  <Option value={1440}>24小时</Option>
                </Select>
              </Form.Item>
            </Card>
          </Col>
        </Row>

        <Row style={{ marginTop: 24 }}>
          <Col>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存设置
              </Button>
              <Button onClick={() => form.resetFields()}>
                重置
              </Button>
            </Space>
          </Col>
        </Row>
      </Form>
    </div>
  );
};

export default Settings;