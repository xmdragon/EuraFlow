import { CalculatorOutlined, DollarOutlined, TruckOutlined } from '@ant-design/icons';
import { Tabs, Typography } from 'antd';
import React from 'react';

import ProfitCalculatorV2 from './ProfitCalculatorV2';
import ShippingDetailCalculator from './ShippingDetailCalculator';

const { Title } = Typography;

const FinanceCalculator: React.FC = () => {
  const tabItems = [
    {
      key: 'profit',
      label: (
        <span>
          <DollarOutlined />
          利润计算
        </span>
      ),
      children: <ProfitCalculatorV2 />,
    },
    {
      key: 'shipping',
      label: (
        <span>
          <TruckOutlined />
          运费明细计算
        </span>
      ),
      children: <ShippingDetailCalculator />,
    },
  ];

  return (
    <div>
      <Title level={2}>
        <CalculatorOutlined /> 财务计算器
      </Title>

      <Tabs defaultActiveKey="profit" items={tabItems} />
    </div>
  );
};

export default FinanceCalculator;
