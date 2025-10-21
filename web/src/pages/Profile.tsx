import React, { useState } from 'react';
import { Form, Input, Button, Card, Row, Col, Divider, Space, Typography } from 'antd';
import { UserOutlined, MailOutlined, KeyOutlined } from '@ant-design/icons';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Title, Text } = Typography;

interface UpdateProfileData {
  username?: string;
  email?: string;
}

interface ChangePasswordData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const Profile: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // 更新个人资料
  const handleUpdateProfile = async (values: UpdateProfileData) => {
    setUpdatingProfile(true);
    try {
      const response = await axios.put('/api/ef/v1/auth/me', values);
      if (response.data) {
        notifySuccess('更新成功', '个人资料已更新');
        await refreshUser();
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail?.message || '更新失败';
      notifyError('更新失败', errorMsg);
    } finally {
      setUpdatingProfile(false);
    }
  };

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

      <Row gutter={8}>
        <Col xs={24} lg={12}>
          <Card title="基本信息" bordered={false}>
            <Form
              form={profileForm}
              layout="vertical"
              initialValues={{
                username: user?.username || '',
                email: user?.email || '',
              }}
              onFinish={handleUpdateProfile}
            >
              <Form.Item
                label="用户名"
                name="username"
                tooltip="用户名创建后不可修改"
              >
                <Input prefix={<UserOutlined />} placeholder="请输入用户名" disabled />
              </Form.Item>

              <Form.Item
                label="邮箱"
                name="email"
                rules={[
                  { type: 'email', message: '请输入有效的邮箱地址' },
                ]}
              >
                <Input prefix={<MailOutlined />} placeholder="请输入邮箱（可选）" />
              </Form.Item>

              <Form.Item>
                <Space>
                  <Text type="secondary">角色：</Text>
                  <Text strong>
                    {user?.role === 'admin' ? '管理员' :
                     user?.role === 'operator' ? '操作员' : '查看员'}
                  </Text>
                </Space>
              </Form.Item>

              <Form.Item>
                <Space>
                  <Text type="secondary">账号状态：</Text>
                  <Text strong style={{ color: user?.is_active ? '#52c41a' : '#ff4d4f' }}>
                    {user?.is_active ? '激活' : '未激活'}
                  </Text>
                </Space>
              </Form.Item>

              {user?.parent_user_id && (
                <Form.Item>
                  <Space>
                    <Text type="secondary">账号类型：</Text>
                    <Text strong>子账号</Text>
                  </Space>
                </Form.Item>
              )}

              <Form.Item>
                <Space>
                  <Text type="secondary">创建时间：</Text>
                  <Text>{new Date(user?.created_at || '').toLocaleString('zh-CN')}</Text>
                </Space>
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={updatingProfile}>
                  保存修改
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
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
                <Input.Password prefix={<KeyOutlined />} placeholder="请输入当前密码" />
              </Form.Item>

              <Form.Item
                label="新密码"
                name="new_password"
                rules={[
                  { required: true, message: '请输入新密码' },
                  { min: 8, message: '密码至少8个字符' },
                ]}
              >
                <Input.Password prefix={<KeyOutlined />} placeholder="请输入新密码" />
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
                <Input.Password prefix={<KeyOutlined />} placeholder="请再次输入新密码" />
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={changingPassword}>
                  修改密码
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Profile;