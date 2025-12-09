import { KeyOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, Input, Button, Card, Space, Typography, Radio, Spin } from 'antd';
import React, { useState, useEffect } from 'react';

import styles from './Profile.module.scss';

import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;

interface ChangePasswordData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

interface UserSettings {
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
  };
  security: {
    two_factor_auth: boolean;
    session_timeout: number;
  };
}

const Profile: React.FC = () => {
  const { user, settings, isLoading } = useAuth();
  const [passwordForm] = Form.useForm();
  const [settingsForm] = Form.useForm();
  const [changingPassword, setChangingPassword] = useState(false);
  const queryClient = useQueryClient();

  // 更新用户设置（仍然调用 PUT /settings，但刷新 currentUser 缓存）
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: UserSettings) => {
      const response = await axios.put('/api/ef/v1/settings', data);
      return response.data;
    },
    onSuccess: () => {
      // 刷新 currentUser 缓存（/me 接口已合并返回 settings）
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      notifySuccess('保存成功', '显示设置已更新');
    },
    onError: () => {
      notifyError('保存失败', '保存显示设置失败');
    },
  });

  // 当设置加载完成后，更新表单
  useEffect(() => {
    if (settings) {
      settingsForm.setFieldsValue({
        shop_name_format: settings.display.shop_name_format,
      });
    }
  }, [settings, settingsForm]);

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
    } catch (error) {
      const errorMsg = error.response?.data?.detail?.message || '修改密码失败';
      notifyError('修改失败', errorMsg);
    } finally {
      setChangingPassword(false);
    }
  };

  // 保存显示设置
  const handleSaveSettings = (values: { shop_name_format: 'ru' | 'cn' | 'both' }) => {
    if (!settings) return;

    updateSettingsMutation.mutate({
      ...settings,
      display: {
        ...settings.display,
        shop_name_format: values.shop_name_format,
      },
    });
  };

  return (
    <div>
      <PageTitle icon={<UserOutlined />} title="个人资料" />

      <Space direction="vertical" size="large" className={styles.container}>
        <Card title="基本信息" bordered={false} className={styles.card}>
          <div className={styles.infoItem}>
            <div className={styles.label}>用户名</div>
            <div className={styles.value}>{user?.username}</div>
          </div>

          <div className={styles.infoItem}>
            <div className={styles.label}>角色</div>
            <div className={styles.value}>
              {user?.role === 'admin' ? '超级管理员' : user?.role === 'manager' ? '管理员' : '子账号'}
            </div>
          </div>

          <div className={styles.infoItem}>
            <div className={styles.label}>账号状态</div>
            <div className={styles.value}>
              <Text strong type={user?.is_active ? 'success' : 'danger'}>
                {user?.is_active ? '激活' : '未激活'}
              </Text>
            </div>
          </div>

          {user?.parent_user_id && (
            <div className={styles.infoItem}>
              <div className={styles.label}>账号类型</div>
              <div className={styles.value}>子账号</div>
            </div>
          )}

          <div className={styles.infoItem}>
            <div className={styles.label}>创建时间</div>
            <div className={styles.value}>
              {new Date(user?.created_at || '').toLocaleString('zh-CN')}
            </div>
          </div>
        </Card>

        <Card
          title={
            <Space>
              <SettingOutlined />
              <span>显示设置</span>
            </Space>
          }
          bordered={false}
          className={styles.card}
        >
          {isLoading ? (
            <Spin />
          ) : (
            <Form form={settingsForm} layout="vertical" onFinish={handleSaveSettings}>
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
          )}
        </Card>

        <Card title="修改密码" bordered={false} className={styles.card}>
          <Form form={passwordForm} layout="vertical" onFinish={handleChangePassword}>
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
      </Space>
    </div>
  );
};

export default Profile;
