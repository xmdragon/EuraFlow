import { CalculatorOutlined } from '@ant-design/icons';
import { Card, Form, InputNumber, Row, Col, Typography, Space, Tabs, Alert, Divider, Tag } from 'antd';
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { SCENARIOS } from './constants';
import ScenarioCard from './ScenarioCard';
import { matchScenario } from '../ozon/profitCalculator';
import { getExchangeRate } from '@/services/exchangeRateApi';

const { Title, Text } = Typography;

interface CalculationInputData {
  cost?: number;       // 成本 (RMB)
  price?: number;      // 售价 (RMB)
  weight?: number;     // 重量 (克)
  packingFee?: number; // 打包费 (RMB)
}

const ProfitCalculatorV2: React.FC = () => {
  const [form] = Form.useForm();
  const [inputData, setInputData] = useState<CalculationInputData>({
    cost: undefined,
    price: undefined,
    weight: undefined,
    packingFee: 2, // 默认2 RMB
  });
  const [activeKey, setActiveKey] = useState<string>('super-light');

  // 查询汇率（CNY → RUB），用于场景匹配
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchangeRate', 'CNY', 'RUB'],
    queryFn: () => getExchangeRate('CNY', 'RUB', false),
    staleTime: 30 * 60 * 1000, // 30分钟
    gcTime: 60 * 60 * 1000, // 1小时
  });
  const exchangeRate = exchangeRateData ? parseFloat((exchangeRateData as any).rate) : null;

  // 自动匹配场景
  const matchedScenario = useMemo(() => {
    if (!inputData.price || !inputData.weight || !exchangeRate) {
      return null;
    }
    return matchScenario(inputData.weight, inputData.price, exchangeRate);
  }, [inputData.price, inputData.weight, exchangeRate]);

  // 当匹配的场景发生变化时，自动切换标签页
  useEffect(() => {
    if (matchedScenario) {
      setActiveKey(matchedScenario.id);
    }
  }, [matchedScenario]);

  // 处理表单值变化
  const handleFormChange = (changedValues: any) => {
    setInputData((prev) => ({
      ...prev,
      ...changedValues,
    }));
  };

  return (
    <div>
      <Space align="center" style={{ marginBottom: 24 }}>
        <CalculatorOutlined style={{ fontSize: 24, color: '#1890ff' }} />
        <Title level={3} style={{ margin: 0 }}>
          利润计算器
        </Title>
      </Space>

      {/* 统一输入区域 */}
      <Card title="商品信息" style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="horizontal"
          initialValues={inputData}
          onValuesChange={handleFormChange}
        >
          <Row gutter={24}>
            <Col span={12}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="成本(RMB)" name="cost">
                    <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="请输入" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="售价(RMB)" name="price">
                    <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="请输入" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="重量(克)" name="weight">
                    <InputNumber style={{ width: '100%' }} min={0} max={25000} precision={0} placeholder="请输入" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="打包费(RMB)" name="packingFee">
                    <InputNumber style={{ width: '100%' }} min={0} precision={1} placeholder="默认2.0" />
                  </Form.Item>
                </Col>
              </Row>
            </Col>

            <Col span={12}>
              <Card size="small" title="场景匹配信息" type="inner">
                <Space direction="vertical" style={{ width: '100%' }}>
                  {matchedScenario ? (
                    <>
                      <Row justify="space-between">
                        <Col>
                          <Text>匹配场景：</Text>
                        </Col>
                        <Col>
                          <Text strong style={{ color: '#52c41a' }}>
                            {matchedScenario.icon} {matchedScenario.title}
                          </Text>
                        </Col>
                      </Row>
                      <Row justify="space-between">
                        <Col>
                          <Text>重量范围：</Text>
                        </Col>
                        <Col>
                          <Tag color="blue">{matchedScenario.weightRange}</Tag>
                        </Col>
                      </Row>
                      <Row justify="space-between">
                        <Col>
                          <Text>价格范围：</Text>
                        </Col>
                        <Col>
                          <Tag color="green">{matchedScenario.priceRange}</Tag>
                        </Col>
                      </Row>
                      <Divider style={{ margin: '8px 0' }} />
                      <Row justify="space-between">
                        <Col>
                          <Text>平台扣点：</Text>
                        </Col>
                        <Col>
                          <Text strong>{(matchedScenario.defaultPlatformRate * 100).toFixed(1)}%</Text>
                        </Col>
                      </Row>
                      <Row justify="space-between">
                        <Col>
                          <Text>运费公式：</Text>
                        </Col>
                        <Col>
                          <Text code style={{ fontSize: 11 }}>{matchedScenario.shipping.formula}</Text>
                        </Col>
                      </Row>
                    </>
                  ) : (
                    <Alert
                      message="请输入售价和重量"
                      description="系统将根据输入自动匹配适合的场景"
                      type="info"
                      showIcon
                    />
                  )}
                </Space>
              </Card>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* 场景详细计算 */}
      <Card>
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          items={SCENARIOS.map((scenario) => ({
            key: scenario.id,
            label: (
              <Space>
                <span style={{ fontSize: '18px' }}>{scenario.icon}</span>
                <Text strong>{scenario.title}</Text>
                <Tag color="blue">{scenario.weightRange}</Tag>
                {matchedScenario?.id === scenario.id && (
                  <Tag color="success">当前匹配</Tag>
                )}
              </Space>
            ),
            children: (
              <ScenarioCard
                scenario={scenario}
                sharedInputData={inputData}
                exchangeRate={exchangeRate}
                isMatched={matchedScenario?.id === scenario.id}
              />
            ),
          }))}
        />
      </Card>
    </div>
  );
};

export default ProfitCalculatorV2;
