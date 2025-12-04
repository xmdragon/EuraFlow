import { CalculatorOutlined } from '@ant-design/icons';
import {
  Card,
  InputNumber,
  Space,
  Typography,
  Tooltip,
  Button,
  Tag,
  Alert,
  Row,
  Col,
} from 'antd';
import React, { useState, useEffect, useMemo } from 'react';

import { ScenarioConfig } from './constants';
import { calculateDefaultShipping, formatPercentage, formatMoney } from './utils';

import { formatNumber } from '@/utils/formatNumber';

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
  isMatched,
}) => {
  // 场景特定的费用（可以在当前场景调整）
  const [platformRate, setPlatformRate] = useState(scenario.defaultPlatformRate);
  const [packingFee, setPackingFee] = useState<number | undefined>(
    sharedInputData?.packingFee || scenario.packingFee
  );
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
    if (
      cost === undefined ||
      price === undefined ||
      shipping === undefined ||
      packingFee === undefined
    ) {
      return undefined;
    }

    const platformFee = price * platformRate;
    return price - cost - shipping - platformFee - packingFee;
  }, [sharedInputData, shipping, packingFee, platformRate]);

  // 计算利润率（小数形式，如0.22表示22%）
  const profitRate = useMemo(() => {
    if (
      profit === undefined ||
      sharedInputData?.price === undefined ||
      sharedInputData.price === 0
    ) {
      return undefined;
    }
    return profit / sharedInputData.price;
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
    <div style={{ maxWidth: 700 }}>
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text>平台扣点:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="%"
              value={platformRate ? platformRate * 100 : undefined}
              onChange={(value) =>
                setPlatformRate(value ? value / 100 : scenario.defaultPlatformRate)
              }
              min={0}
              max={100}
              precision={1}
              controls={false}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
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
              controls={false}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text>打包费:</Text>
            <InputNumber
              size="small"
              style={{ width: 120 }}
              suffix="RMB"
              value={packingFee}
              onChange={(value) => setPackingFee(value ?? undefined)}
              min={0}
              precision={2}
              controls={false}
            />
          </div>
        </Space>
      </Card>

      {/* 场景信息 */}
      <Card size="small" title="场景条件" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          {scenario.transportMode && (
            <Row justify="space-between">
              <Col>
                <Text>运输方式：</Text>
              </Col>
              <Col>
                <Tag color={scenario.transportMode === 'land' ? 'green' : 'blue'}>
                  {scenario.transportMode === 'land' ? '陆运/纯陆' : '陆空'}
                </Tag>
              </Col>
            </Row>
          )}
          <Row justify="space-between">
            <Col>
              <Text>重量范围：</Text>
            </Col>
            <Col>
              <Tag color="blue">{scenario.weightRange}</Tag>
            </Col>
          </Row>
          <Row justify="space-between">
            <Col>
              <Text>价格范围：</Text>
            </Col>
            <Col>
              <Tag color="green">{getPriceRangeDisplay()}</Tag>
            </Col>
          </Row>
          <Row justify="space-between">
            <Col>
              <Text>尺寸限制：</Text>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {scenario.dimensionLimit.description}
              </Text>
            </Col>
          </Row>
        </Space>
      </Card>

    </div>
  );
};

export default ScenarioCard;
