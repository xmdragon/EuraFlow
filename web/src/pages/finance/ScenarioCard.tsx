import { CalculatorOutlined, ReloadOutlined } from '@ant-design/icons';
import { Card, InputNumber, Space, Typography, Tooltip, Button, Tag } from 'antd';
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ScenarioConfig } from './constants';
import {
  CalculationData,
  calculateDefaultShipping,
  calculateProfit,
  formatPercentage,
  formatMoney,
  validateInput,
} from './utils';
import { getExchangeRate } from '@/services/exchangeRateApi';

const { Text, Title } = Typography;

interface ScenarioCardProps {
  scenario: ScenarioConfig;
}

const ScenarioCard: React.FC<ScenarioCardProps> = ({ scenario }) => {
  const [data, setData] = useState<CalculationData>({
    platformRate: scenario.defaultPlatformRate,
    packingFee: scenario.packingFee,
  });

  const [warnings, setWarnings] = useState<string[]>([]);

  // 查询汇率（CNY → RUB），用于显示价格范围
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchangeRate', 'CNY', 'RUB'],
    queryFn: () => getExchangeRate('CNY', 'RUB', false),
    staleTime: 30 * 60 * 1000, // 30分钟
    cacheTime: 60 * 60 * 1000, // 1小时
  });
  const exchangeRate = exchangeRateData ? parseFloat(exchangeRateData.rate) : null;

  // 当重量变化时，自动计算运费
  useEffect(() => {
    if (data.weight) {
      const defaultShipping = calculateDefaultShipping(data.weight, scenario);
      if (defaultShipping !== undefined) {
        setData((prev) => ({ ...prev, shipping: defaultShipping }));
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
  }, [
    data.cost,
    data.price,
    data.weight,
    data.platformRate,
    data.shipping,
    data.packingFee,
    scenario,
  ]);

  const handleInputChange = (field: keyof CalculationData, value: number | null) => {
    setData((prev) => ({
      ...prev,
      [field]: value ?? undefined,
    }));
  };

  const handleCalculateShipping = () => {
    const defaultShipping = calculateDefaultShipping(data.weight, scenario);
    if (defaultShipping !== undefined) {
      setData((prev) => ({ ...prev, shipping: defaultShipping }));
    }
  };

  const handleReset = () => {
    setData({
      platformRate: scenario.defaultPlatformRate,
      packingFee: scenario.packingFee,
    });
    setWarnings([]);
  };

  const profitColor =
    data.profit !== undefined ? (data.profit > 0 ? '#52c41a' : '#ff4d4f') : undefined;

  // 生成带RMB换算的价格范围显示文本
  const getPriceRangeDisplay = (): string => {
    if (!exchangeRate) {
      return scenario.priceRange;
    }

    const { conditions } = scenario;
    const minRMB = conditions.minPrice ? Math.round(conditions.minPrice / exchangeRate) : null;
    const maxRMB = conditions.maxPrice ? Math.round(conditions.maxPrice / exchangeRate) : null;

    // 根据原始priceRange格式生成对应的RMB范围
    if (minRMB && maxRMB) {
      return `${conditions.minPrice}-${conditions.maxPrice} RUB (${minRMB}-${maxRMB} RMB)`;
    } else if (maxRMB) {
      return `<${conditions.maxPrice} RUB (<${maxRMB} RMB)`;
    } else if (minRMB) {
      return `>${conditions.minPrice} RUB (>${minRMB} RMB)`;
    }

    return scenario.priceRange;
  };

  return (
    <Card
      size="small"
      style={{ height: '100%', borderColor: scenario.color.primary }}
      styles={{
        header: {
          background: `linear-gradient(135deg, ${scenario.color.background} 0%, white 100%)`,
          borderBottom: `2px solid ${scenario.color.primary}`,
        },
      }}
      title={
        <Space>
          <span style={{ fontSize: '20px' }}>{scenario.icon}</span>
          <Title level={5} style={{ margin: 0 }}>
            {scenario.title}
          </Title>
        </Space>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>
          重置
        </Button>
      }
    >
      {/* 条件说明 */}
      <div style={{ marginBottom: 12 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space size="small" wrap>
            <Tag color="blue">{scenario.weightRange}</Tag>
            <Tag color="green">{getPriceRangeDisplay()}</Tag>
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
              suffix="RMB"
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
              suffix="RMB"
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
              suffix="RMB"
              value={data.shipping}
              onChange={(value) => handleInputChange('shipping', value)}
              min={0}
              precision={2}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>打包费:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="RMB"
              value={data.packingFee}
              onChange={(value) => handleInputChange('packingFee', value)}
              min={0}
              precision={2}
            />
          </div>
        </Space>
      </div>

      {/* 结果区域 */}
      <div
        style={{
          background:
            data.profit !== undefined ? (data.profit > 0 ? '#e8f5e9' : '#ffebee') : '#fafafa',
          padding: 8,
          borderRadius: 4,
          border: '1px solid #e0e0e0',
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
              {formatMoney(data.profit)} RMB
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
