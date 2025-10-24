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

const SystemConfiguration: React.FC = () => {
  return (
    <div className={styles.container}>
      <PageTitle icon={<SettingOutlined />} title="系统配置" />

      <div className={styles.content}>
        <Tabs
          defaultActiveKey="ozon-shops"
          size="large"
          items={[
            {
              key: 'ozon-shops',
              label: '📦 OZON店铺',
              children: <OzonShopTab />,
            },
            {
              key: 'third-party',
              label: '🔌 第三方服务',
              children: <ThirdPartyServicesTab />,
            },
            {
              key: 'api-keys',
              label: '🔑 API密钥',
              children: <ApiKeysTab />,
            },
            {
              key: 'guide',
              label: 'ℹ️ 配置说明',
              children: <ConfigGuideTab />,
            },
          ]}
        />
      </div>
    </div>
  );
};

export default SystemConfiguration;
