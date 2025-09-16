import { CalculatorOutlined } from '@ant-design/icons';
import { Row, Col, Typography, Space } from 'antd';
import React from 'react';

import { SCENARIOS } from './constants';
import ScenarioCard from './ScenarioCard';

const { Title } = Typography;

const ProfitCalculatorV2: React.FC = () => {
  return (
    <div>
      <Space align="center" style={{ marginBottom: 24 }}>
        <CalculatorOutlined style={{ fontSize: 24, color: '#1890ff' }} />
        <Title level={3} style={{ margin: 0 }}>
          利润计算器
        </Title>
      </Space>

      <Row gutter={[16, 16]}>
        {SCENARIOS.map((scenario) => (
          <Col
            key={scenario.id}
            xs={24} // 手机：1列
            sm={12} // 平板：2列
            lg={8} // 桌面：3列
          >
            <ScenarioCard scenario={scenario} />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default ProfitCalculatorV2;
