/**
 * 跨境巴士配置组件
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, Form, Input, Switch, Button, Space, Alert, Spin } from 'antd';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozon';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

interface Kuajing84FormValues {
  username?: string;
  password?: string;
  enabled?: boolean;
}

export const Kuajing84Configuration: React.FC = () => {
  const [configForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const {
    data: configData,
    refetch: refetchConfig,
    isLoading: configLoading,
  } = useQuery({
    queryKey: ['ozon', 'kuajing84-global-config'],
    queryFn: () => ozonApi.getKuajing84Config(),
    staleTime: 30 * 1000,
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (values: Kuajing84FormValues) => {
      return ozonApi.saveKuajing84Config({
        username: values.username,
        password: values.password,
        enabled: values.enabled || false,
      });
    },
    onSuccess: () => {
      notifySuccess('保存成功', '跨境巴士配置已保存');
      refetchConfig();
      configForm.setFieldsValue({ password: '' });
    },
    onError: (error: Error) => {
      notifyError('保存失败', `保存失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (configData?.data) {
      configForm.setFieldsValue({
        enabled: configData.data.enabled || false,
        username: configData.data.username || '',
        password: '',
      });
    }
  }, [configData, configForm]);

  const handleTestConnection = async () => {
    try {
      const values = configForm.getFieldsValue();
      if (!values.username || !values.password) {
        notifyError('测试失败', '请先填写用户名和密码');
        return;
      }

      setTestingConnection(true);
      await ozonApi.testKuajing84Connection();
      notifySuccess('测试成功', '跨境巴士连接测试成功');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '连接测试失败';
      notifyError('测试失败', `连接测试失败: ${errorMsg}`);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await configForm.validateFields();
      setLoading(true);
      saveConfigMutation.mutate(values);
    } catch (error) {
      logger.error('表单验证失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="跨境巴士配置" style={{ marginBottom: 16 }}>
      <Alert
        message="跨境巴士同步说明"
        description="启用后，打包发货页面可以将已填写国内物流单号的订单同步到跨境巴士平台"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Spin spinning={configLoading || loading}>
        <Form form={configForm} layout="vertical" onFinish={handleSave}>
          <Form.Item name="enabled" label="启用跨境巴士同步" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入跨境巴士用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入跨境巴士密码" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                保存配置
              </Button>
              <Button onClick={handleTestConnection} loading={testingConnection}>
                测试连接
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Spin>
    </Card>
  );
};

export default Kuajing84Configuration;
