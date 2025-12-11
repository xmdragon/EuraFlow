import { KeyOutlined } from '@ant-design/icons';
import { Form, Input, Button, Card, Space } from 'antd';
import React, { useState } from 'react';

import styles from './UserPages.module.scss';

import PageTitle from '@/components/PageTitle';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

interface ChangePasswordData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const ChangePassword: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: ChangePasswordData) => {
    if (values.new_password !== values.confirm_password) {
      notifyError('操作失败', '两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      await axios.put('/api/ef/v1/auth/me/password', {
        current_password: values.current_password,
        new_password: values.new_password,
      });
      notifySuccess('修改成功', '密码已修改成功');
      form.resetFields();
    } catch (error) {
      const errorMsg = error.response?.data?.detail?.message || '修改密码失败';
      notifyError('修改失败', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageTitle icon={<KeyOutlined />} title="修改密码" />

      <Space direction="vertical" size="large" className={styles.container}>
        <Card bordered={false} className={styles.card}>
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
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
              <Button type="primary" htmlType="submit" loading={loading}>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Space>
    </div>
  );
};

export default ChangePassword;
