/**
 * 系统配置统一管理页面
 * 集中管理：第三方服务、API密钥等配置
 * 注意：OZON店铺配置已移至独立的"店铺管理"页面
 */
import { SettingOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import React from 'react';

import styles from './SystemConfiguration.module.scss';

import ConfigGuideTab from './components/ConfigGuideTab';
import GlobalSettingsTab from './components/GlobalSettingsTab';
import ThirdPartyServicesTab from './components/ThirdPartyServicesTab';
import PageTitle from '@/components/PageTitle';

const SystemConfiguration: React.FC = () => {
  // 配置标签
  const allTabs = [
    {
      key: 'global-settings',
      label: '🌐 全局设置',
      children: <GlobalSettingsTab />,
      visible: true,
    },
    {
      key: 'third-party',
      label: '🔌 第三方服务',
      children: <ThirdPartyServicesTab />,
      visible: true,
    },
    {
      key: 'guide',
      label: 'ℹ️ 配置说明',
      children: <ConfigGuideTab />,
      visible: true,
    },
  ];

  const tabItems = allTabs
    .filter((item) => item.visible)
    .map(({ key, label, children }) => ({ key, label, children }));

  // 确定默认选中的标签
  const defaultActiveKey = tabItems.length > 0 ? tabItems[0].key : 'global-settings';

  return (
    <div className={styles.container}>
      <PageTitle icon={<SettingOutlined />} title="系统配置" />

      <div className={styles.content}>
        {tabItems.length > 0 ? (
          <Tabs
            defaultActiveKey={defaultActiveKey}
            destroyInactiveTabPane
            items={tabItems}
          />
        ) : (
          <div style={{ padding: '20px', color: 'red' }}>没有可用的配置选项</div>
        )}
      </div>
    </div>
  );
};

export default SystemConfiguration;
