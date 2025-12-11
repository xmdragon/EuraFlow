import { SettingOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, Button, Card, Space, Radio, Spin, Checkbox, Divider, Typography } from 'antd';
import React, { useEffect } from 'react';

import styles from './UserPages.module.scss';

import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;

interface UserSettingsData {
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
    shop_name_format: 'ru' | 'cn' | 'both';
  };
  sync: {
    auto_sync: boolean;
    sync_interval: number;
    sync_on_login: boolean;
    promotions: boolean;
    finance_transactions: boolean;
    balance: boolean;
  };
  security: {
    two_factor_auth: boolean;
    session_timeout: number;
  };
}

const UserSettings: React.FC = () => {
  const { settings, isLoading } = useAuth();
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 更新用户设置
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: UserSettingsData) => {
      const response = await axios.put('/api/ef/v1/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      notifySuccess('保存成功', '设置已更新');
    },
    onError: () => {
      notifyError('保存失败', '保存设置失败');
    },
  });

  // 当设置加载完成后，更新表单
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        shop_name_format: settings.display.shop_name_format,
        sync_promotions: settings.sync.promotions,
        sync_finance_transactions: settings.sync.finance_transactions,
        sync_balance: settings.sync.balance,
      });
    }
  }, [settings, form]);

  // 保存设置
  const handleSaveSettings = (values: {
    shop_name_format: 'ru' | 'cn' | 'both';
    sync_promotions: boolean;
    sync_finance_transactions: boolean;
    sync_balance: boolean;
  }) => {
    if (!settings) return;

    updateSettingsMutation.mutate({
      ...settings,
      display: {
        ...settings.display,
        shop_name_format: values.shop_name_format,
      },
      sync: {
        ...settings.sync,
        promotions: values.sync_promotions,
        finance_transactions: values.sync_finance_transactions,
        balance: values.sync_balance,
      },
    });
  };

  if (isLoading) {
    return (
      <div>
        <PageTitle icon={<SettingOutlined />} title="个人设置" />
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <PageTitle icon={<SettingOutlined />} title="个人设置" />

      <Space direction="vertical" size="large" className={styles.container}>
        <Form form={form} layout="vertical" onFinish={handleSaveSettings}>
          {/* 显示设置 */}
          <Card title="显示设置" bordered={false} className={styles.card}>
            <Form.Item
              label="店铺名称显示格式"
              name="shop_name_format"
              extra="选择店铺名称在系统中的显示方式"
            >
              <Radio.Group>
                <Space direction="vertical">
                  <Radio value="ru">仅显示俄文名称</Radio>
                  <Radio value="cn">仅显示中文名称</Radio>
                  <Radio value="both">显示俄文【中文】</Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
          </Card>

          {/* 同步设置 */}
          <Card title="同步设置" bordered={false} className={styles.card}>
            <Form.Item name="sync_promotions" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Checkbox>
                <span style={{ fontWeight: 500 }}>自动同步促销活动</span>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  每天把 OZON 自动添加促销的商品拉出
                </Text>
              </Checkbox>
            </Form.Item>

            <Form.Item name="sync_finance_transactions" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Checkbox>
                <span style={{ fontWeight: 500 }}>自动同步财务账单</span>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  定时从 OZON 拉取财务交易记录
                </Text>
              </Checkbox>
            </Form.Item>

            <Form.Item name="sync_balance" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>
                <span style={{ fontWeight: 500 }}>自动同步余额</span>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  定时从 OZON 拉取店铺余额信息
                </Text>
              </Checkbox>
            </Form.Item>
          </Card>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={updateSettingsMutation.isPending}
            >
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </div>
  );
};

export default UserSettings;
