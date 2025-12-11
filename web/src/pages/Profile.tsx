import { KeyOutlined, SettingOutlined, UserOutlined, RightOutlined, EditOutlined } from '@ant-design/icons';
import { Card, Space, Typography, Button, Modal, Input } from 'antd';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import styles from './user/UserPages.module.scss';

import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';
import authService from '@/services/authService';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;

const Profile: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [changingUsername, setChangingUsername] = useState(false);

  // 是否显示修改用户名按钮（手机号注册且未修改过）
  const canChangeUsername = user?.phone && !user?.username_changed;

  const handleChangeUsername = async () => {
    if (!newUsername.trim()) {
      notifyError('输入错误', '请输入新用户名');
      return;
    }

    if (newUsername.trim().length < 3 || newUsername.trim().length > 30) {
      notifyError('输入错误', '用户名需要3-30个字符');
      return;
    }

    // 检查是否为纯数字
    if (/^\d+$/.test(newUsername.trim())) {
      notifyError('输入错误', '用户名不能为纯数字');
      return;
    }

    setChangingUsername(true);
    try {
      await authService.changeUsername(newUsername.trim());
      notifySuccess('修改成功', '用户名修改成功');
      setIsUsernameModalOpen(false);
      setNewUsername('');
      await refreshUser();
    } catch (err: unknown) {
      const error = err as {
        response?: {
          data?: {
            error?: {
              detail?: { code?: string; message?: string };
            };
          };
        };
      };
      const errorDetail = error.response?.data?.error?.detail;
      if (errorDetail?.code === 'USERNAME_ALREADY_CHANGED') {
        notifyError('修改失败', '用户名只能修改一次');
      } else if (errorDetail?.code === 'USERNAME_EXISTS') {
        notifyError('修改失败', '该用户名已被使用');
      } else if (errorDetail?.code === 'INVALID_USERNAME') {
        notifyError('修改失败', errorDetail.message || '用户名格式不正确');
      } else {
        notifyError('修改失败', errorDetail?.message || '修改失败，请重试');
      }
    } finally {
      setChangingUsername(false);
    }
  };

  return (
    <div>
      <PageTitle icon={<UserOutlined />} title="个人资料" />

      <Space direction="vertical" size="large" className={styles.container}>
        {/* 基本信息 */}
        <Card title="基本信息" bordered={false} className={styles.card}>
          <div className={styles.infoRow}>
            <span className={styles.label}>用户名</span>
            <span className={styles.value}>
              {user?.username}
              {canChangeUsername && (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setIsUsernameModalOpen(true)}
                  style={{ marginLeft: 8 }}
                >
                  修改
                </Button>
              )}
            </span>
          </div>

          <div className={styles.infoRow}>
            <span className={styles.label}>手机号</span>
            <span className={styles.value}>{user?.phone || '未设置'}</span>
          </div>

          <div className={styles.infoRow}>
            <span className={styles.label}>角色</span>
            <span className={styles.value}>
              {user?.role === 'admin' ? '超级管理员' : user?.role === 'manager' ? '主账号' : '子账号'}
            </span>
          </div>

          <div className={styles.infoRow}>
            <span className={styles.label}>状态</span>
            <span className={styles.value}>
              <Text strong type={user?.is_active ? 'success' : 'danger'}>
                {user?.is_active ? '激活' : '未激活'}
              </Text>
            </span>
          </div>

          <div className={styles.infoRow}>
            <span className={styles.label}>过期时间</span>
            <span className={styles.value}>
              {user?.expires_at
                ? new Date(user.expires_at).toLocaleString('zh-CN')
                : '永久有效'}
            </span>
          </div>

          <div className={styles.infoRow}>
            <span className={styles.label}>创建时间</span>
            <span className={styles.value}>
              {new Date(user?.created_at || '').toLocaleString('zh-CN')}
            </span>
          </div>
        </Card>

        {/* 快捷链接 */}
        <Card
          className={styles.linkCard}
          bordered={false}
          onClick={() => navigate('/dashboard/profile/settings')}
        >
          <div className={styles.linkCardContent}>
            <SettingOutlined className={styles.linkCardIcon} />
            <div className={styles.linkCardText}>
              <div className={styles.linkCardTitle}>个人设置</div>
              <div className={styles.linkCardDesc}>显示设置、同步设置</div>
            </div>
            <RightOutlined className={styles.linkCardArrow} />
          </div>
        </Card>

        <Card
          className={styles.linkCard}
          bordered={false}
          onClick={() => navigate('/dashboard/profile/password')}
        >
          <div className={styles.linkCardContent}>
            <KeyOutlined className={styles.linkCardIcon} />
            <div className={styles.linkCardText}>
              <div className={styles.linkCardTitle}>修改密码</div>
              <div className={styles.linkCardDesc}>更改登录密码</div>
            </div>
            <RightOutlined className={styles.linkCardArrow} />
          </div>
        </Card>
      </Space>

      {/* 修改用户名弹窗 */}
      <Modal
        title="修改用户名"
        open={isUsernameModalOpen}
        onOk={handleChangeUsername}
        onCancel={() => {
          setIsUsernameModalOpen(false);
          setNewUsername('');
        }}
        confirmLoading={changingUsername}
        okText="确定"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="warning">注意：用户名只能修改一次，请谨慎操作</Text>
        </div>
        <Input
          placeholder="请输入新用户名（3-30个字符，不能为纯数字）"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          maxLength={30}
        />
      </Modal>
    </div>
  );
};

export default Profile;
