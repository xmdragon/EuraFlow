import { CalculatorOutlined, DollarOutlined, TruckOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import React from 'react';

import PageTitle from '@/components/PageTitle';
import ProfitCalculatorV2 from './ProfitCalculatorV2';
import ShippingDetailCalculator from './ShippingDetailCalculator';

const FinanceCalculator: React.FC = () => {
  const tabItems = [
    {
      key: 'profit',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <DollarOutlined />
          利润计算
        </span>
      ),
      children: <ProfitCalculatorV2 />,
    },
    {
      key: 'shipping',
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <TruckOutlined />
          运费明细
        </span>
      ),
      children: <ShippingDetailCalculator />,
    },
  ];

  return (
    <div>
      <PageTitle icon={<CalculatorOutlined />} title="计算器" />

      <Tabs defaultActiveKey="profit" destroyInactiveTabPane items={tabItems} />
    </div>
  );
};

export default FinanceCalculator;
