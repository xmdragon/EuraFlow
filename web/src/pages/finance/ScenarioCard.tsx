import React, { useState, useEffect } from 'react';
import { Card, InputNumber, Space, Typography, Tooltip, Button, Tag } from 'antd';
import { CalculatorOutlined, ReloadOutlined } from '@ant-design/icons';
import { ScenarioConfig } from './constants';
import { 
  CalculationData, 
  calculateDefaultShipping, 
  calculateProfit, 
  formatPercentage, 
  formatMoney,
  validateInput 
} from './utils';

const { Text, Title } = Typography;

interface ScenarioCardProps {
  scenario: ScenarioConfig;
}

const ScenarioCard: React.FC<ScenarioCardProps> = ({ scenario }) => {
  const [data, setData] = useState<CalculationData>({
    platformRate: scenario.defaultPlatformRate,
  });

  const [warnings, setWarnings] = useState<string[]>([]);

  // 当重量变化时，自动计算运费
  useEffect(() => {
    if (data.weight) {
      const defaultShipping = calculateDefaultShipping(data.weight, scenario);
      if (defaultShipping !== undefined) {
        setData(prev => ({ ...prev, shipping: defaultShipping }));
      }
    }
  }, [data.weight, scenario]);

  // 实时计算利润
  useEffect(() => {
    const calculated = calculateProfit(data);
    if (calculated.profit !== data.profit || calculated.profitRate !== data.profitRate) {
      setData(calculated);
    }

    // 验证输入
    const validation = validateInput(data, scenario);
    setWarnings(validation.warnings);
  }, [data.cost, data.price, data.weight, data.platformRate, data.shipping, scenario]);

  const handleInputChange = (field: keyof CalculationData, value: number | null) => {
    setData(prev => ({
      ...prev,
      [field]: value ?? undefined
    }));
  };

  const handleCalculateShipping = () => {
    const defaultShipping = calculateDefaultShipping(data.weight, scenario);
    if (defaultShipping !== undefined) {
      setData(prev => ({ ...prev, shipping: defaultShipping }));
    }
  };

  const handleReset = () => {
    setData({
      platformRate: scenario.defaultPlatformRate,
    });
    setWarnings([]);
  };

  const profitColor = data.profit !== undefined 
    ? data.profit > 0 ? '#52c41a' : '#ff4d4f'
    : undefined;

  return (
    <Card
      size="small"
      style={{ height: '100%', borderColor: scenario.color.primary }}
      styles={{
        header: {
          background: `linear-gradient(135deg, ${scenario.color.background} 0%, white 100%)`,
          borderBottom: `2px solid ${scenario.color.primary}`,
        }
      }}
      title={
        <Space>
          <span style={{ fontSize: '20px' }}>{scenario.icon}</span>
          <Title level={5} style={{ margin: 0 }}>{scenario.title}</Title>
        </Space>
      }
      extra={
        <Button 
          size="small" 
          icon={<ReloadOutlined />} 
          onClick={handleReset}
        >
          重置
        </Button>
      }
    >
      {/* 条件说明 */}
      <div style={{ marginBottom: 12 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space size="small">
            <Tag color="blue">{scenario.weightRange}</Tag>
            <Tag color="green">{scenario.priceRange}</Tag>
          </Space>
          <div style={{ width: '100%' }}>
            <Tag color="orange" style={{ width: '100%', textAlign: 'center' }}>
              📏 {scenario.dimensionLimit.description}
            </Tag>
          </div>
        </Space>
      </div>

      {/* 输入区域 */}
      <div style={{ background: '#fff', padding: 8, borderRadius: 4, marginBottom: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>成本:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              placeholder="请输入"
              suffix="卢布"
              value={data.cost}
              onChange={(value) => handleInputChange('cost', value)}
              min={0}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>售价:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              placeholder="请输入"
              suffix="卢布"
              value={data.price}
              onChange={(value) => handleInputChange('price', value)}
              min={0}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>重量:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              placeholder="请输入"
              suffix="克"
              value={data.weight}
              onChange={(value) => handleInputChange('weight', value)}
              min={0}
            />
          </div>
        </Space>
      </div>

      {/* 费用区域 */}
      <div style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, marginBottom: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>平台扣点:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="%"
              value={data.platformRate ? data.platformRate * 100 : undefined}
              onChange={(value) => handleInputChange('platformRate', value ? value / 100 : null)}
              min={0}
              max={100}
              precision={1}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space size={4}>
              <Text>运费:</Text>
              <Tooltip title={`公式: ${scenario.shipping.formula}`}>
                <Button
                  size="small"
                  type="text"
                  icon={<CalculatorOutlined />}
                  onClick={handleCalculateShipping}
                  disabled={!data.weight}
                />
              </Tooltip>
            </Space>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="卢布"
              value={data.shipping}
              onChange={(value) => handleInputChange('shipping', value)}
              min={0}
              precision={2}
            />
          </div>
        </Space>
      </div>

      {/* 结果区域 */}
      <div 
        style={{ 
          background: data.profit !== undefined 
            ? (data.profit > 0 ? '#e8f5e9' : '#ffebee')
            : '#fafafa',
          padding: 8, 
          borderRadius: 4,
          border: '1px solid #e0e0e0'
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>💰 利润率:</Text>
            <Text strong style={{ color: profitColor, fontSize: 16 }}>
              {formatPercentage(data.profitRate)}
            </Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>💵 利润:</Text>
            <Text strong style={{ color: profitColor, fontSize: 16 }}>
              {formatMoney(data.profit)} 卢布
            </Text>
          </div>
        </Space>
      </div>

      {/* 警告信息 */}
      {warnings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {warnings.map((warning, index) => (
            <Text key={index} type="warning" style={{ display: 'block', fontSize: 12 }}>
              ⚠️ {warning}
            </Text>
          ))}
        </div>
      )}
    </Card>
  );
};

export default ScenarioCard;