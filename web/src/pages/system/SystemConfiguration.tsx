/**
 * 系统配置统一管理页面
 * 集中管理：OZON店铺、第三方服务、API密钥等配置
 */
import { SettingOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import React from 'react';

import styles from './SystemConfiguration.module.scss';

import ApiKeysTab from './components/ApiKeysTab';
import ConfigGuideTab from './components/ConfigGuideTab';
import OzonShopTab from './components/OzonShopTab';
import ThirdPartyServicesTab from './components/ThirdPartyServicesTab';
import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';

const SystemConfiguration: React.FC = () => {
  const { user } = useAuth();
  const isOperator = user?.role === 'operator';

  // 根据角色过滤标签
  const tabItems = [
    {
      key: 'ozon-shops',
      label: '📦 OZON店铺',
      children: <OzonShopTab />,
      visible: true, // 所有角色可见（操作员只能看到绑定的店铺）
    },
    {
      key: 'third-party',
      label: '🔌 第三方服务',
      children: <ThirdPartyServicesTab />,
      visible: !isOperator, // 操作员不可见
    },
    {
      key: 'api-keys',
      label: '🔑 API密钥',
      children: <ApiKeysTab />,
      visible: true, // 所有角色可见
    },
    {
      key: 'guide',
      label: 'ℹ️ 配置说明',
      children: <ConfigGuideTab />,
      visible: true, // 所有角色可见（操作员只能看到部分内容）
    },
  ]
    .filter(item => item.visible)
    .map(({ key, label, children }) => ({ key, label, children }));

  return (
    <div className={styles.container}>
      <PageTitle icon={<SettingOutlined />} title="系统配置" />

      <div className={styles.content}>
        <Tabs
          defaultActiveKey={isOperator ? 'api-keys' : 'ozon-shops'}
          size="large"
          items={tabItems}
        />
      </div>
    </div>
  );
};

export default SystemConfiguration;
