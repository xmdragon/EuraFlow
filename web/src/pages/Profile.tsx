import React, { useState } from 'react';
import { Form, Input, Button, Card, Space, Typography } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Title, Text } = Typography;

interface ChangePasswordData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const Profile: React.FC = () => {
  const { user } = useAuth();
  const [passwordForm] = Form.useForm();
  const [changingPassword, setChangingPassword] = useState(false);

  // 修改密码
  const handleChangePassword = async (values: ChangePasswordData) => {
    if (values.new_password !== values.confirm_password) {
      notifyError('操作失败', '两次输入的密码不一致');
      return;
    }

    setChangingPassword(true);
    try {
      await axios.put('/api/ef/v1/auth/me/password', {
        current_password: values.current_password,
        new_password: values.new_password,
      });
      notifySuccess('修改成功', '密码已修改成功');
      passwordForm.resetFields();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail?.message || '修改密码失败';
      notifyError('修改失败', errorMsg);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div>
      <Title level={3} style={{ marginBottom: 16 }}>个人资料</Title>

      <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 600 }}>
        <Card title="基本信息" bordered={false}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Text type="secondary">用户名：</Text>
              <Text strong style={{ marginLeft: 8 }}>{user?.username}</Text>
            </div>

            <div>
              <Text type="secondary">角色：</Text>
              <Text strong style={{ marginLeft: 8 }}>
                {user?.role === 'admin' ? '管理员' :
                 user?.role === 'operator' ? '操作员' : '查看员'}
              </Text>
            </div>

            <div>
              <Text type="secondary">账号状态：</Text>
              <Text strong style={{ marginLeft: 8, color: user?.is_active ? '#52c41a' : '#ff4d4f' }}>
                {user?.is_active ? '激活' : '未激活'}
              </Text>
            </div>

            {user?.parent_user_id && (
              <div>
                <Text type="secondary">账号类型：</Text>
                <Text strong style={{ marginLeft: 8 }}>子账号</Text>
              </div>
            )}

            <div>
              <Text type="secondary">创建时间：</Text>
              <Text style={{ marginLeft: 8 }}>{new Date(user?.created_at || '').toLocaleString('zh-CN')}</Text>
            </div>
          </Space>
        </Card>

        <Card title="修改密码" bordered={false}>
          <Form
            form={passwordForm}
            layout="vertical"
            onFinish={handleChangePassword}
          >
            <Form.Item
              label="当前密码"
              name="current_password"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password
                prefix={<KeyOutlined />}
                placeholder="请输入当前密码"
                style={{ width: 200 }}
              />
            </Form.Item>

            <Form.Item
              label="新密码"
              name="new_password"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '密码至少8个字符' },
              ]}
            >
              <Input.Password
                prefix={<KeyOutlined />}
                placeholder="请输入新密码"
                style={{ width: 200 }}
              />
            </Form.Item>

            <Form.Item
              label="确认新密码"
              name="confirm_password"
              dependencies={['new_password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<KeyOutlined />}
                placeholder="请再次输入新密码"
                style={{ width: 200 }}
              />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={changingPassword}>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </div>
  );
};

export default Profile;