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

  console.log('[SystemConfiguration] User:', user);
  console.log('[SystemConfiguration] isOperator:', isOperator);

  // 根据角色过滤标签
  const allTabs = [
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

  console.log('[SystemConfiguration] tabItems:', tabItems);
  console.log('[SystemConfiguration] tabItems.length:', tabItems.length);

  // 确定默认选中的标签
  const defaultActiveKey = tabItems.length > 0 ? tabItems[0].key : 'ozon-shops';

  console.log('[SystemConfiguration] defaultActiveKey:', defaultActiveKey);

  return (
    <div className={styles.container}>
      <PageTitle icon={<SettingOutlined />} title="系统配置" />

      <div className={styles.content}>
        <div style={{ padding: '20px', background: '#f0f0f0', marginBottom: '20px' }}>
          <p>调试信息：</p>
          <p>用户角色: {user?.role || '未知'}</p>
          <p>是否操作员: {isOperator ? '是' : '否'}</p>
          <p>标签数量: {tabItems.length}</p>
          <p>默认标签: {defaultActiveKey}</p>
        </div>

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
