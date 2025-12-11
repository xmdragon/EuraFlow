import { CalculatorOutlined, DollarOutlined, TruckOutlined, PlusOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { Tabs, Button } from 'antd';
import React from 'react';

import PageTitle from '@/components/PageTitle';
import { useQuickMenu } from '@/hooks/useQuickMenu';
import ProfitCalculatorV2 from './ProfitCalculatorV2';
import ShippingDetailCalculator from './ShippingDetailCalculator';

const FinanceCalculator: React.FC = () => {
  const { isInQuickMenu, addQuickMenu } = useQuickMenu();

  const createTabLabel = (key: string, icon: React.ReactNode, label: string) => {
    const menuKey = `calculator-${key}`;
    const isAdded = isInQuickMenu(menuKey);
    const path = `/dashboard/calculator?tab=${key}`;

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {icon}
        {label}
        <Button
          type="text"
          size="small"
          icon={isAdded ? <CheckCircleOutlined /> : <PlusOutlined />}
          style={{
            marginLeft: '4px',
            fontSize: '12px',
            color: isAdded ? '#52c41a' : '#1890ff',
            padding: '0 4px',
            height: '20px',
            lineHeight: '20px'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (!isAdded) {
              addQuickMenu({
                key: menuKey,
                label: label,
                path: path
              });
            }
          }}
        />
      </span>
    );
  };

  const tabItems = [
    {
      key: 'profit',
      label: createTabLabel('profit', <DollarOutlined />, '利润计算'),
      children: <ProfitCalculatorV2 />,
    },
    {
      key: 'shipping',
      label: createTabLabel('shipping', <TruckOutlined />, '运费明细'),
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
