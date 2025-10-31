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
import GlobalSettingsTab from './components/GlobalSettingsTab';
import OzonShopTab from './components/OzonShopTab';
import ThirdPartyServicesTab from './components/ThirdPartyServicesTab';
import PageTitle from '@/components/PageTitle';
import { useAuth } from '@/hooks/useAuth';

const SystemConfiguration: React.FC = () => {
  const { user } = useAuth();
  const isOperator = user?.role === 'operator';

  // 根据角色过滤标签
  const allTabs = [
    {
      key: 'global-settings',
      label: '🌐 全局设置',
      children: <GlobalSettingsTab />,
      visible: true, // 所有角色可见（管理员可编辑，操作员只读）
    },
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
  ];

  const tabItems = allTabs
    .filter((item) => item.visible)
    .map(({ key, label, children }) => ({ key, label, children }));

  // 确定默认选中的标签
  const defaultActiveKey = tabItems.length > 0 ? tabItems[0].key : 'ozon-shops';

  return (
    <div className={styles.container}>
      <PageTitle icon={<SettingOutlined />} title="系统配置" />

      <div className={styles.content}>
        {tabItems.length > 0 ? (
          <Tabs
            defaultActiveKey={defaultActiveKey}
            size="large"
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
