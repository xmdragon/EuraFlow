 
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
  Tag,
} from 'antd';
import React, { useState, useEffect, useMemo } from 'react';

import { matchAllScenarios } from '../ozon/profitCalculator';

import { SCENARIOS } from './constants';
import styles from './ProfitCalculatorV2.module.scss';
import ScenarioCard from './ScenarioCard';
import { calculateDefaultShipping, formatPercentage, formatMoney } from './utils';

import { formatNumber } from '@/utils/formatNumber';

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
    packingFee: undefined,
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
  const { profit, profitRate, platformFee } = useMemo(() => {
    const { cost, price, packingFee } = inputData;
    if (
      cost === undefined ||
      price === undefined ||
      shipping === undefined ||
      !primaryScenario
    ) {
      return { profit: undefined, profitRate: undefined, platformFee: undefined };
    }

    const actualPackingFee = packingFee ?? 0; // 打包费不填默认0
    const calculatedPlatformFee = price * primaryScenario.defaultPlatformRate;
    const calculatedProfit = price - cost - shipping - calculatedPlatformFee - actualPackingFee;
    const calculatedProfitRate = price > 0 ? calculatedProfit / price : undefined;

    return { profit: calculatedProfit, profitRate: calculatedProfitRate, platformFee: calculatedPlatformFee };
  }, [inputData, shipping, primaryScenario]);

  const profitColor = profit !== undefined ? (profit > 0 ? '#52c41a' : '#ff4d4f') : undefined;

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
            {/* 输入区域 */}
            <Row gutter={16} style={{ maxWidth: 700 }}>
              <Col span={12}>
                <Form.Item label="成本(RMB)" name="cost">
                  <InputNumber
                    className={styles.fullWidthInput}
                    min={0}
                    controls={false}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="售价(RMB)" name="price">
                  <InputNumber
                    className={styles.fullWidthInput}
                    min={0}
                    controls={false}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="重量(克)" name="weight">
                  <InputNumber
                    className={styles.fullWidthInput}
                    min={0}
                    max={25000}
                    precision={0}
                    controls={false}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="打包费(RMB)" name="packingFee">
                  <InputNumber
                    className={styles.fullWidthInput}
                    min={0}
                    controls={false}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* 利润计算结果 */}
            <Card
                size="small"
                title="利润计算结果"
                style={{
                  maxWidth: 700,
                  background: profit !== undefined ? (profit > 0 ? '#f6ffed' : '#fff1f0') : '#fafafa',
                  borderColor: profit !== undefined ? (profit > 0 ? '#b7eb8f' : '#ffccc7') : '#d9d9d9',
                }}
              >
                <Row gutter={24}>
                  <Col span={12}>
                    <Text type="secondary" style={{ fontSize: 12 }}>成本明细：</Text>
                    <div style={{ marginTop: 8 }}>
                      <Row justify="space-between">
                        <Col><Text style={{ fontSize: 12 }}>采购成本：</Text></Col>
                        <Col><Text style={{ fontSize: 12 }}>{inputData.cost !== undefined ? `¥${formatNumber(inputData.cost)}` : '---'}</Text></Col>
                      </Row>
                      <Row justify="space-between">
                        <Col><Text style={{ fontSize: 12 }}>运费：</Text></Col>
                        <Col><Text style={{ fontSize: 12 }}>{shipping !== undefined ? `¥${formatNumber(shipping)}` : '---'}</Text></Col>
                      </Row>
                      <Row justify="space-between">
                        <Col><Text style={{ fontSize: 12 }}>平台扣点：</Text></Col>
                        <Col><Text style={{ fontSize: 12 }}>{platformFee !== undefined ? `¥${formatNumber(platformFee)}` : '---'}</Text></Col>
                      </Row>
                      <Row justify="space-between">
                        <Col><Text style={{ fontSize: 12 }}>打包费：</Text></Col>
                        <Col><Text style={{ fontSize: 12 }}>{profit !== undefined ? `¥${formatNumber(inputData.packingFee ?? 0)}` : '---'}</Text></Col>
                      </Row>
                    </div>
                  </Col>
                  <Col span={12}>
                    <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
                      <Col><Text strong style={{ fontSize: 14 }}>利润率:</Text></Col>
                      <Col>
                        <Text strong style={{ color: profitColor, fontSize: 20 }}>
                          {profitRate !== undefined ? formatPercentage(profitRate) : '---'}
                        </Text>
                      </Col>
                    </Row>
                    <Row justify="space-between" align="middle">
                      <Col><Text strong style={{ fontSize: 14 }}>利润:</Text></Col>
                      <Col>
                        <Text strong style={{ color: profitColor, fontSize: 20 }}>
                          {profit !== undefined ? `${formatMoney(profit)} RMB` : '---'}
                        </Text>
                      </Col>
                    </Row>
                  </Col>
                </Row>
              </Card>
          </Form>
        </Card>

        {/* 场景详细计算 */}
        <Card>
          <div style={{ maxWidth: 700 }}>
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

              // 解析标题：把（陆空）或（陆运）等放第二行
              const titleMatch = scenario.title.match(/^(.+?)（(.+?)）$/);
              const mainTitle = titleMatch ? titleMatch[1] : scenario.title;
              const subTitle = titleMatch ? `（${titleMatch[2]}）` : '';

              return {
                key: scenario.id,
                label: (
                  <div
                    className={styles.tabLabel}
                    style={{
                      backgroundColor: scenario.color.background,
                      borderColor: scenario.color.primary,
                    }}
                  >
                    <div className={styles.tabLabelTitle}>
                      <Text strong>{mainTitle}</Text>
                      {isMatched && <Tag color="success" className={styles.tabLabelTag}>匹配</Tag>}
                      {hasMultipleMatches && scenario.id === sameGroupMatched[0].id && (
                        <Tag color="orange" className={styles.tabLabelTag}>多方案</Tag>
                      )}
                    </div>
                    {subTitle && <div className={styles.tabLabelSub}>{subTitle}</div>}
                    <div className={styles.tabLabelWeight} style={{ color: scenario.color.primary }}>
                      {scenario.weightRange}
                    </div>
                  </div>
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
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ProfitCalculatorV2;
