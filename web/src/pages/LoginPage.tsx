import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { Form, Input, Button, Alert, Typography, Space } from 'antd';
import React, { useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import type { LoginRequest } from '@/types/auth';

const { Title } = Typography;

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (values: LoginRequest) => {
    setLoading(true);
    setError(null);

    try {
      await login(values);
    } catch (err: unknown) {
      const error = err as {
        response?: { data?: { detail?: { message?: string } } };
        message?: string;
      };
      setError(error.response?.data?.detail?.message || error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-form">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ color: '#1890ff', marginBottom: 8 }}>
              EuraFlow
            </Title>
            <Typography.Text type="secondary">跨境电商管理平台</Typography.Text>
          </div>

          {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

          <Form name="login" onFinish={handleLogin} size="large" autoComplete="off">
            <Form.Item
              name="username"
              rules={[
                {
                  required: true,
                  message: '请输入用户名!',
                },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                {
                  required: true,
                  message: '请输入密码!',
                },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} style={{ width: '100%' }}>
                登录
              </Button>
            </Form.Item>
          </Form>

        </Space>
      </div>
    </div>
  );
};

export default LoginPage;
