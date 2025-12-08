/**
 * API KEY 管理页面
 * 从用户菜单进入，每个用户都可以管理自己的 API KEY
 */
import { KeyOutlined } from '@ant-design/icons';
import React from 'react';

import PageTitle from '@/components/PageTitle';
import ApiKeysTab from '@/pages/system/components/ApiKeysTab';

const ApiKeys: React.FC = () => {
  return (
    <div style={{ padding: '24px 8px' }}>
      <PageTitle icon={<KeyOutlined />} title="API KEY 管理" />
      <ApiKeysTab />
    </div>
  );
};

export default ApiKeys;
