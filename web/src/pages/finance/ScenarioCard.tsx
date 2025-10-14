import { CalculatorOutlined } from '@ant-design/icons';
import { Card, InputNumber, Space, Typography, Tooltip, Button, Tag, Alert, Row, Col, Divider } from 'antd';
import React, { useState, useEffect, useMemo } from 'react';

import { ScenarioConfig } from './constants';
import {
  calculateDefaultShipping,
  formatPercentage,
  formatMoney,
} from './utils';

const { Text } = Typography;

interface SharedInputData {
  cost?: number;
  price?: number;
  weight?: number;
  packingFee?: number;
}

interface ScenarioCardProps {
  scenario: ScenarioConfig;
  sharedInputData?: SharedInputData;
  exchangeRate: number | null;
  isMatched: boolean;
}

const ScenarioCard: React.FC<ScenarioCardProps> = ({
  scenario,
  sharedInputData,
  exchangeRate,
  isMatched
}) => {
  // 场景特定的费用（可以在当前场景调整）
  const [platformRate, setPlatformRate] = useState(scenario.defaultPlatformRate);
  const [packingFee, setPackingFee] = useState<number | undefined>(sharedInputData?.packingFee || scenario.packingFee);
  const [shipping, setShipping] = useState<number | undefined>(undefined);

  // 同步打包费到共享输入数据
  useEffect(() => {
    if (sharedInputData?.packingFee !== undefined) {
      setPackingFee(sharedInputData.packingFee);
    }
  }, [sharedInputData?.packingFee]);

  // 当重量变化时，自动计算运费
  useEffect(() => {
    if (sharedInputData?.weight) {
      const defaultShipping = calculateDefaultShipping(sharedInputData.weight, scenario);
      if (defaultShipping !== undefined) {
        setShipping(defaultShipping);
      }
    } else {
      setShipping(undefined);
    }
  }, [sharedInputData?.weight, scenario]);

  // 计算利润
  const profit = useMemo(() => {
    const { cost, price } = sharedInputData || {};
    if (cost === undefined || price === undefined || shipping === undefined || packingFee === undefined) {
      return undefined;
    }

    const platformFee = price * platformRate;
    return price - cost - shipping - platformFee - packingFee;
  }, [sharedInputData?.cost, sharedInputData?.price, shipping, packingFee, platformRate]);

  // 计算利润率
  const profitRate = useMemo(() => {
    if (profit === undefined || sharedInputData?.price === undefined || sharedInputData.price === 0) {
      return undefined;
    }
    return (profit / sharedInputData.price) * 100;
  }, [profit, sharedInputData?.price]);

  const profitColor = profit !== undefined ? (profit > 0 ? '#52c41a' : '#ff4d4f') : undefined;

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

  // 手动重算运费
  const handleCalculateShipping = () => {
    if (sharedInputData?.weight) {
      const defaultShipping = calculateDefaultShipping(sharedInputData.weight, scenario);
      if (defaultShipping !== undefined) {
        setShipping(defaultShipping);
      }
    }
  };

  // 重置场景特定参数
  const handleReset = () => {
    setPlatformRate(scenario.defaultPlatformRate);
    setPackingFee(sharedInputData?.packingFee || scenario.packingFee);
    if (sharedInputData?.weight) {
      const defaultShipping = calculateDefaultShipping(sharedInputData.weight, scenario);
      if (defaultShipping !== undefined) {
        setShipping(defaultShipping);
      }
    }
  };

  // 是否显示不匹配警告
  const showMismatchWarning = !isMatched && sharedInputData?.price && sharedInputData?.weight;

  return (
    <div>
      {/* 场景不匹配警告 */}
      {showMismatchWarning && (
        <Alert
          message="当前输入不符合此场景条件"
          description={
            <div>
              <p>您的输入条件更适合其他场景，但您仍可在此场景下查看计算结果作为参考。</p>
              <Space>
                <Text type="secondary">当前场景条件：</Text>
                <Tag color="blue">{scenario.weightRange}</Tag>
                <Tag color="green">{getPriceRangeDisplay()}</Tag>
              </Space>
            </div>
          }
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 场景信息 */}
      <Card
        size="small"
        title="场景条件"
        style={{ marginBottom: 16 }}
      >
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Row justify="space-between">
            <Col><Text>重量范围：</Text></Col>
            <Col><Tag color="blue">{scenario.weightRange}</Tag></Col>
          </Row>
          <Row justify="space-between">
            <Col><Text>价格范围：</Text></Col>
            <Col><Tag color="green">{getPriceRangeDisplay()}</Tag></Col>
          </Row>
          <Row justify="space-between">
            <Col><Text>尺寸限制：</Text></Col>
            <Col><Text type="secondary" style={{ fontSize: 12 }}>{scenario.dimensionLimit.description}</Text></Col>
          </Row>
        </Space>
      </Card>

      {/* 费用调整区域 */}
      <Card
        size="small"
        title={
          <Space>
            <Text>费用参数</Text>
            <Button size="small" type="link" onClick={handleReset}>
              恢复默认
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>平台扣点:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="%"
              value={platformRate ? platformRate * 100 : undefined}
              onChange={(value) => setPlatformRate(value ? value / 100 : scenario.defaultPlatformRate)}
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
                  disabled={!sharedInputData?.weight}
                />
              </Tooltip>
            </Space>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="RMB"
              value={shipping}
              onChange={(value) => setShipping(value ?? undefined)}
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
              value={packingFee}
              onChange={(value) => setPackingFee(value ?? undefined)}
              min={0}
              precision={2}
            />
          </div>
        </Space>
      </Card>

      {/* 计算结果 */}
      <Card
        size="small"
        title="利润计算结果"
        style={{
          background: profit !== undefined ? (profit > 0 ? '#f6ffed' : '#fff1f0') : '#fafafa',
          borderColor: profit !== undefined ? (profit > 0 ? '#b7eb8f' : '#ffccc7') : '#d9d9d9',
        }}
      >
        {sharedInputData?.cost !== undefined && sharedInputData?.price !== undefined ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* 成本明细 */}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>成本明细：</Text>
              <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size="small">
                <Row justify="space-between">
                  <Col><Text style={{ fontSize: 12 }}>采购成本：</Text></Col>
                  <Col><Text style={{ fontSize: 12 }}>¥{sharedInputData.cost.toFixed(2)}</Text></Col>
                </Row>
                <Row justify="space-between">
                  <Col><Text style={{ fontSize: 12 }}>运费：</Text></Col>
                  <Col><Text style={{ fontSize: 12 }}>¥{shipping !== undefined ? shipping.toFixed(2) : '--'}</Text></Col>
                </Row>
                <Row justify="space-between">
                  <Col><Text style={{ fontSize: 12 }}>平台扣点：</Text></Col>
                  <Col><Text style={{ fontSize: 12 }}>¥{((sharedInputData.price * platformRate)).toFixed(2)}</Text></Col>
                </Row>
                <Row justify="space-between">
                  <Col><Text style={{ fontSize: 12 }}>打包费：</Text></Col>
                  <Col><Text style={{ fontSize: 12 }}>¥{packingFee !== undefined ? packingFee.toFixed(2) : '--'}</Text></Col>
                </Row>
              </Space>
            </div>

            <Divider style={{ margin: 0 }} />

            {/* 利润结果 */}
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Row justify="space-between" align="middle">
                <Col><Text strong style={{ fontSize: 14 }}>💰 利润率:</Text></Col>
                <Col>
                  <Text strong style={{ color: profitColor, fontSize: 18 }}>
                    {formatPercentage(profitRate)}
                  </Text>
                </Col>
              </Row>
              <Row justify="space-between" align="middle">
                <Col><Text strong style={{ fontSize: 14 }}>💵 利润:</Text></Col>
                <Col>
                  <Text strong style={{ color: profitColor, fontSize: 18 }}>
                    {formatMoney(profit)} RMB
                  </Text>
                </Col>
              </Row>
            </Space>
          </Space>
        ) : (
          <Alert
            message="请在顶部输入商品信息"
            description="输入成本、售价、重量等信息后，系统将自动计算利润"
            type="info"
            showIcon
          />
        )}
      </Card>
    </div>
  );
};

export default ScenarioCard;
