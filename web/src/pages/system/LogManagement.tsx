/**
 * 日志管理页面
 * 统一管理 Webhook 通知日志和用户操作日志
 * 权限：仅管理员
 */
import { FileTextOutlined } from '@ant-design/icons';
import { Card, Tabs } from 'antd';
import React from 'react';

import PageTitle from '@/components/PageTitle';
import AuditLogsTable from './components/AuditLogsTable';
import WebhookLogsTable from './components/WebhookLogsTable';

import styles from './LogManagement.module.scss';

const LogManagement: React.FC = () => {
  const tabItems = [
    {
      key: 'webhook',
      label: '🔔 Webhook通知日志',
      children: <WebhookLogsTable />,
    },
    {
      key: 'audit',
      label: '👤 用户操作日志',
      children: <AuditLogsTable />,
    },
  ];

  return (
    <div>
      <PageTitle icon={<FileTextOutlined />} title="日志管理" />

      <Card className={styles.logCard}>
        <Tabs defaultActiveKey="webhook" size="large" items={tabItems} />
      </Card>
    </div>
  );
};

export default LogManagement;
