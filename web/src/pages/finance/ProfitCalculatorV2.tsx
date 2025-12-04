 
import { CalculatorOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Form,
  InputNumber,
  Row,
  Col,
  Typography,
  Space,
  Tabs,
  Alert,
  Divider,
  Tag,
} from 'antd';
import React, { useState, useEffect, useMemo } from 'react';

import { matchAllScenarios } from '../ozon/profitCalculator';

import { SCENARIOS } from './constants';
import styles from './ProfitCalculatorV2.module.scss';
import ScenarioCard from './ScenarioCard';
import { calculateDefaultShipping, formatPercentage, formatMoney } from './utils';

import { getExchangeRate } from '@/services/exchangeRateApi';

import type { FormValues } from '@/types/common';

const { Text } = Typography;

interface CalculationInputData {
  cost?: number; // 成本 (RMB)
  price?: number; // 售价 (RMB)
  weight?: number; // 重量 (克)
  packingFee?: number; // 打包费 (RMB)
}

const ProfitCalculatorV2: React.FC = () => {
  const [form] = Form.useForm();
  const [inputData, setInputData] = useState<CalculationInputData>({
    cost: undefined,
    price: undefined,
    weight: undefined,
    packingFee: 0, // 默认0 RMB
  });
  const [activeKey, setActiveKey] = useState<string>('super-light');

  // 查询汇率（CNY → RUB），用于场景匹配
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchangeRate', 'CNY', 'RUB'],
    queryFn: () => getExchangeRate('CNY', 'RUB', false),
    staleTime: 30 * 60 * 1000, // 30分钟
    gcTime: 60 * 60 * 1000, // 1小时
  });
  const exchangeRate = exchangeRateData ? parseFloat((exchangeRateData as { rate: string }).rate) : null;

  // 自动匹配所有符合条件的场景
  const matchedScenarios = useMemo(() => {
    if (!inputData.price || !inputData.weight || !exchangeRate) {
      return [];
    }
    return matchAllScenarios(inputData.weight, inputData.price, exchangeRate);
  }, [inputData.price, inputData.weight, exchangeRate]);

  // 主要匹配场景（运费最低的那个）
  const primaryScenario = matchedScenarios.length > 0 ? matchedScenarios[0] : null;

  // 计算运费（基于主要匹配场景）
  const shipping = useMemo(() => {
    if (!inputData.weight || !primaryScenario) return undefined;
    return calculateDefaultShipping(inputData.weight, primaryScenario);
  }, [inputData.weight, primaryScenario]);

  // 计算利润和利润率
  const { profit, profitRate } = useMemo(() => {
    const { cost, price, packingFee } = inputData;
    if (
      cost === undefined ||
      price === undefined ||
      shipping === undefined ||
      packingFee === undefined ||
      !primaryScenario
    ) {
      return { profit: undefined, profitRate: undefined };
    }

    const platformFee = price * primaryScenario.defaultPlatformRate;
    const calculatedProfit = price - cost - shipping - platformFee - packingFee;
    const calculatedProfitRate = price > 0 ? calculatedProfit / price : undefined;

    return { profit: calculatedProfit, profitRate: calculatedProfitRate };
  }, [inputData, shipping, primaryScenario]);

  // 当匹配的场景发生变化时，自动切换标签页
  useEffect(() => {
    if (primaryScenario) {
      setActiveKey(primaryScenario.id);
    }
  }, [primaryScenario]);

  // 处理表单值变化
  const handleFormChange = (changedValues: Partial<FormValues>) => {
    setInputData((prev) => ({
      ...prev,
      ...changedValues,
    }));
  };

  return (
    <div>
      <div className={styles.contentContainer}>
        {/* 统一输入区域 */}
        <Card
          title={
            <Space align="center">
              <CalculatorOutlined />
              利润计算器
            </Space>
          }
          className={styles.infoCard}
        >
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
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        precision={2}
                        placeholder="请输入"
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="售价(RMB)" name="price">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        precision={2}
                        placeholder="请输入"
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="重量(克)" name="weight">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        max={25000}
                        precision={0}
                        placeholder="请输入"
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="打包费(RMB)" name="packingFee">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        precision={1}
                        placeholder="默认0.0"
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                {/* 利润计算结果 */}
                {profit !== undefined && (
                  <div
                    style={{
                      width: 600,
                      padding: '12px 16px',
                      background: profit > 0 ? '#f6ffed' : '#fff1f0',
                      borderRadius: 6,
                      border: `1px solid ${profit > 0 ? '#b7eb8f' : '#ffccc7'}`,
                    }}
                  >
                    <Row gutter={24}>
                      <Col span={12}>
                        <Space>
                          <Text>💰 利润率:</Text>
                          <Text
                            strong
                            style={{
                              color: profit > 0 ? '#52c41a' : '#ff4d4f',
                              fontSize: 16,
                            }}
                          >
                            {formatPercentage(profitRate)}
                          </Text>
                        </Space>
                      </Col>
                      <Col span={12}>
                        <Space>
                          <Text>💵 利润:</Text>
                          <Text
                            strong
                            style={{
                              color: profit > 0 ? '#52c41a' : '#ff4d4f',
                              fontSize: 16,
                            }}
                          >
                            {formatMoney(profit)} RMB
                          </Text>
                        </Space>
                      </Col>
                    </Row>
                  </div>
                )}
              </Col>

              <Col span={12}>
                <Card size="small" title="场景匹配信息" type="inner">
                  <Space direction="vertical" className={styles.fullWidthSpace}>
                    {primaryScenario ? (
                      <>
                        <Row justify="space-between">
                          <Col>
                            <Text>匹配场景：</Text>
                          </Col>
                          <Col>
                            <Text strong className={styles.profitText}>
                              {primaryScenario.icon} {primaryScenario.title}
                            </Text>
                          </Col>
                        </Row>
                        {matchedScenarios.length > 1 && (
                          <Row justify="space-between">
                            <Col>
                              <Text>其他方案：</Text>
                            </Col>
                            <Col>
                              <Tag color="orange">{matchedScenarios.length}个方案可选</Tag>
                            </Col>
                          </Row>
                        )}
                        <Row justify="space-between">
                          <Col>
                            <Text>重量范围：</Text>
                          </Col>
                          <Col>
                            <Tag color="blue">{primaryScenario.weightRange}</Tag>
                          </Col>
                        </Row>
                        <Row justify="space-between">
                          <Col>
                            <Text>价格范围：</Text>
                          </Col>
                          <Col>
                            <Tag color="green">{primaryScenario.priceRange}</Tag>
                          </Col>
                        </Row>
                        <Divider className={styles.divider} />
                        <Row justify="space-between">
                          <Col>
                            <Text>平台扣点：</Text>
                          </Col>
                          <Col>
                            <Text strong>
                              {(primaryScenario.defaultPlatformRate * 100).toFixed(1)}%
                            </Text>
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
            items={SCENARIOS.map((scenario) => {
              // 检查是否有同组的多个场景匹配
              const sameGroupMatched = matchedScenarios.filter(
                (s) => s.matchGroup === scenario.matchGroup && s.matchGroup !== undefined
              );
              const isMatched = matchedScenarios.some((m) => m.id === scenario.id);
              const hasMultipleMatches = sameGroupMatched.length > 1;

              return {
                key: scenario.id,
                label: (
                  <Space>
                    <span className={styles.scenarioIcon}>{scenario.icon}</span>
                    <Text strong>{scenario.title}</Text>
                    <Tag color="blue">{scenario.weightRange}</Tag>
                    {isMatched && <Tag color="success">当前匹配</Tag>}
                    {hasMultipleMatches && scenario.id === sameGroupMatched[0].id && (
                      <Tag color="orange">多方案</Tag>
                    )}
                  </Space>
                ),
                children: (() => {
                  // 如果有同组的多个场景匹配，且当前是该组第一个场景，则并排显示
                  if (hasMultipleMatches && scenario.id === sameGroupMatched[0].id) {
                    return (
                      <Row gutter={16}>
                        {sameGroupMatched.map((s) => (
                          <Col span={12} key={s.id}>
                            <Card
                              size="small"
                              title={
                                <Space>
                                  <span>{s.icon}</span>
                                  <Text strong>{s.title}</Text>
                                </Space>
                              }
                              className={styles.scenarioCard}
                            >
                              <ScenarioCard
                                scenario={s}
                                sharedInputData={inputData}
                                exchangeRate={exchangeRate}
                                isMatched={matchedScenarios.some((m) => m.id === s.id)}
                              />
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    );
                  }

                  // 单独显示
                  return (
                    <ScenarioCard
                      scenario={scenario}
                      sharedInputData={inputData}
                      exchangeRate={exchangeRate}
                      isMatched={isMatched}
                    />
                  );
                })(),
              };
            })}
          />
        </Card>
      </div>
    </div>
  );
};

export default ProfitCalculatorV2;
