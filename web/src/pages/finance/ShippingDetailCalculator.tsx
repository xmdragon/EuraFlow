import {
  Card,
  Form,
  InputNumber,
  Select,
  Tabs,
  Table,
  Tag,
  Row,
  Col,
  Space,
  Typography,
  Divider,
  Radio,
  Alert,
} from 'antd';
import React, { useState, useEffect } from 'react';

import {
  OZON_UNI_DATA,
  calculateVolumeWeight,
  calculateChargeableWeight,
  calculateShippingFee,
  checkServiceAvailable,
  type UNIService,
  type UNICategory,
} from './ozonUniShippingData';
import styles from './ShippingDetailCalculator.module.scss';

const { Title, Text } = Typography;
const { Option } = Select;

interface CalculationData {
  weight?: number; // 重量(克)
  length?: number; // 长(cm)
  width?: number; // 宽(cm)
  height?: number; // 高(cm)
  value?: number; // 货值(RMB)
  deliveryType: 'pickup' | 'delivery'; // 自提点/送货上门
}

const ShippingDetailCalculator: React.FC = () => {
  const [form] = Form.useForm();
  const [calculationData, setCalculationData] = useState<CalculationData>({
    weight: undefined,
    length: undefined,
    width: undefined,
    height: undefined,
    value: undefined,
    deliveryType: 'pickup',
  });

  const [volumeWeight, setVolumeWeight] = useState(0);
  const [chargeableWeight, setChargeableWeight] = useState(0);
  const [sumDimension, setSumDimension] = useState(0);
  const [maxDimension, setMaxDimension] = useState(0);
  const [activeKey, setActiveKey] = useState<string>('extra-small');

  // 获取可用的标签页列表
  const getAvailableTabs = (
    weight: number,
    value: number,
    sumDim: number,
    maxDim: number
  ): string[] => {
    return OZON_UNI_DATA.filter((category) => {
      return category.services.some((service) => {
        const availability = checkServiceAvailable(service, weight, value, sumDim, maxDim);
        return availability.available;
      });
    }).map((category) => category.id);
  };

  // 根据重量自动选择合适的标签页（从可用标签页中选择）
  const getActiveTabByWeight = (
    weight: number,
    value: number,
    sumDim: number,
    maxDim: number
  ): string => {
    const availableTabs = getAvailableTabs(weight, value, sumDim, maxDim);

    if (availableTabs.length === 0) {
      return 'extra-small'; // 默认返回第一个
    }

    // 按优先级尝试选择最合适的可用标签页
    const priorities = [
      // UNI Extra Small: 1g-500g
      weight >= 1 && weight <= 500 ? 'extra-small' : null,
      // UNI Budget: 501g-25kg (只适用于501g以上，价值≤1500卢布)
      weight >= 501 && weight <= 25000 && value <= 1500 ? 'budget' : null,
      // UNI Small: 1g-2kg (价值1500-7000卢布)
      weight >= 1 && weight <= 2000 && value > 1500 && value <= 7000 ? 'small' : null,
      // UNI Big: 2.001kg-25kg (价值1501-7000卢布)
      weight >= 2001 && weight <= 25000 && value > 1500 && value <= 7000 ? 'big' : null,
      // UNI Premium Small: 1g-5kg (高客单价>7000)
      weight >= 1 && weight <= 5000 && value > 7000 ? 'premium-small' : null,
      // UNI Premium Big: 5.001kg-25kg (高客单价>7000)
      weight >= 5001 && weight <= 25000 && value > 7000 ? 'premium-big' : null,
    ].filter(Boolean);

    // 从优先级列表中找到第一个可用的标签页
    for (const priority of priorities) {
      if (priority && availableTabs.includes(priority)) {
        return priority;
      }
    }

    // 如果没有匹配的优先级，返回第一个可用的标签页
    return availableTabs[0];
  };

  // 计算体积重量和尺寸
  useEffect(() => {
    const { weight = 0, length = 0, width = 0, height = 0, value = 0 } = calculationData;
    const volWeight = calculateVolumeWeight(length, width, height);
    const charWeight = calculateChargeableWeight(weight, volWeight);
    const sum = length + width + height;
    const max = Math.max(length, width, height);

    setVolumeWeight(volWeight);
    setChargeableWeight(charWeight);
    setSumDimension(sum);
    setMaxDimension(max);

    // 获取可用的标签页
    const availableTabs = getAvailableTabs(weight, value, sum, max);

    // 只有在有可用标签页时才自动切换
    if (availableTabs.length > 0) {
      const newActiveKey = getActiveTabByWeight(weight, value, sum, max);
      // 如果当前标签页不可用，切换到推荐的标签页
      if (!availableTabs.includes(activeKey)) {
        setActiveKey(newActiveKey);
      }
    }
  }, [calculationData]);

  // 处理表单值变化
  const handleFormChange = (changedValues: any) => {
    setCalculationData((prev) => ({
      ...prev,
      ...changedValues,
    }));
  };

  // 渲染服务表格
  const renderServiceTable = (category: UNICategory) => {
    // 检查该类别是否有可用服务
    const hasAvailableService = category.services.some((service) => {
      const availability = checkServiceAvailable(
        service,
        chargeableWeight,
        calculationData.value,
        sumDimension,
        maxDimension
      );
      return availability.available;
    });

    // 如果没有可用服务，显示提示信息
    if (!hasAvailableService) {
      return (
        <Alert
          message="当前条件不适用于该运输类别"
          description={
            <div>
              <p>该运输类别不适用于当前的输入条件：</p>
              <ul style={{ marginTop: 8 }}>
                <li>重量: {calculationData.weight || 0} 克</li>
                <li>货值: {calculationData.value || 0} RMB</li>
                <li>三边之和: {sumDimension} cm</li>
                <li>最长边: {maxDimension} cm</li>
              </ul>
            </div>
          }
          type="warning"
          showIcon
        />
      );
    }
    const columns = [
      {
        title: '渠道名称',
        dataIndex: 'name',
        key: 'name',
        width: 200,
      },
      {
        title: '代码',
        dataIndex: 'code',
        key: 'code',
        width: 60,
        render: (code: string) => <Tag color="blue">{code}</Tag>,
      },
      {
        title: '时效(天)',
        key: 'timeRange',
        width: 100,
        render: (record: UNIService) => (
          <Space direction="vertical" size={0}>
            <Text>
              {record.minDays}-{record.maxDays}天
            </Text>
            {record.avgDays > 0 && <Text type="secondary">{record.avgDays}天</Text>}
          </Space>
        ),
      },
      {
        title: 'UNI费用公式',
        dataIndex: 'formula',
        key: 'formula',
        width: 150,
        render: (formula: string, record: UNIService) => (
          <Space direction="vertical" size={0}>
            <Text>{formula}</Text>
            {record.additionalFee && calculationData.deliveryType === 'delivery' && (
              <Text type="secondary">送货: {record.additionalFee}</Text>
            )}
          </Space>
        ),
      },
      {
        title: '运费计算结果',
        key: 'fee',
        width: 120,
        render: (record: UNIService) => {
          const availability = checkServiceAvailable(
            record,
            chargeableWeight,
            calculationData.value,
            sumDimension,
            maxDimension
          );

          if (!availability.available) {
            return <Text type="secondary">--</Text>;
          }

          const fee = calculateShippingFee(
            record,
            chargeableWeight,
            calculationData.deliveryType === 'delivery'
          );
          return (
            <Text strong style={{ color: '#52c41a' }}>
              ¥{fee.toFixed(2)} RMB
            </Text>
          );
        },
      },
      {
        title: '最大重量',
        dataIndex: 'maxWeight',
        key: 'maxWeight',
        width: 100,
        render: (weight: number) => (weight ? `${weight}克` : '不限'),
      },
      {
        title: '货值限制',
        dataIndex: 'maxValue',
        key: 'maxValue',
        width: 120,
        render: (value: number) => (value ? `${value} RMB` : '不限'),
      },
      {
        title: '尺寸限制',
        key: 'dimension',
        width: 150,
        render: (record: UNIService) => {
          const { sumLimit, maxSide } = record.dimensionLimit;
          if (!sumLimit && !maxSide) return '不限';

          const limits = [];
          if (sumLimit) limits.push(`三边≤${sumLimit}cm`);
          if (maxSide) limits.push(`最长边≤${maxSide}cm`);
          return (
            <Space direction="vertical" size={0}>
              {limits.map((limit, index) => (
                <Text key={index} style={{ fontSize: 12 }}>
                  {limit}
                </Text>
              ))}
            </Space>
          );
        },
      },
      {
        title: '注意事项',
        key: 'notes',
        width: 150,
        render: (record: UNIService) => {
          const availability = checkServiceAvailable(
            record,
            chargeableWeight,
            calculationData.value,
            sumDimension,
            maxDimension
          );

          if (!availability.available) {
            return <Tag color="error">{availability.reason}</Tag>;
          }

          if (record.msds) {
            return <Tag color="orange">需要MSDS</Tag>;
          }

          return record.notes?.join(', ') || '--';
        },
      },
    ];

    return (
      <Table
        columns={columns}
        dataSource={category.services}
        rowKey="code"
        pagination={false}
        size="small"
        scroll={{ x: 1200 }}
        rowClassName={(record) => {
          const availability = checkServiceAvailable(
            record,
            chargeableWeight,
            calculationData.value,
            sumDimension,
            maxDimension
          );
          return !availability.available ? 'disabled-row' : '';
        }}
      />
    );
  };

  return (
    <div>
      <div className={styles.contentContainer}>
        {/* 价格测算表 */}
        <Card title="价格测算表" className={styles.cardMargin}>
          <Form
            form={form}
            layout="horizontal"
            initialValues={calculationData}
            onValuesChange={handleFormChange}
          >
            <Row gutter={24}>
              <Col span={12}>
                <Row gutter={16}>
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
                    <Form.Item label="货值(RMB)" name="value">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        precision={0}
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="长(cm)" name="length">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        max={150}
                        precision={0}
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="宽(cm)" name="width">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        max={150}
                        precision={0}
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="高(cm)" name="height">
                      <InputNumber
                        className={styles.fullWidthInput}
                        min={0}
                        max={150}
                        precision={0}
                        controls={false}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item label="配送方式" name="deliveryType">
                  <Radio.Group>
                    <Radio value="pickup">自提点</Radio>
                    <Radio value="delivery">送货上门</Radio>
                  </Radio.Group>
                </Form.Item>
              </Col>

              <Col span={12}>
                <Card size="small" title="体积重量" type="inner">
                  <Space direction="vertical" className={styles.fullWidthSpace}>
                    <Row justify="space-between">
                      <Col>
                        <Text>体积重量：</Text>
                      </Col>
                      <Col>
                        <Text strong>{volumeWeight.toFixed(2)} 克</Text>
                      </Col>
                    </Row>
                    <Row justify="space-between">
                      <Col>
                        <Text>实际重量：</Text>
                      </Col>
                      <Col>
                        <Text strong>{calculationData.weight} 克</Text>
                      </Col>
                    </Row>
                    <Divider style={{ margin: '8px 0' }} />
                    <Row justify="space-between">
                      <Col>
                        <Text>计费重量：</Text>
                      </Col>
                      <Col>
                        <Text strong style={{ color: '#1890ff' }}>
                          {chargeableWeight.toFixed(2)} 克
                        </Text>
                      </Col>
                    </Row>
                    <Row justify="space-between">
                      <Col>
                        <Text>三边之和：</Text>
                      </Col>
                      <Col>
                        <Text strong>{sumDimension} cm</Text>
                      </Col>
                    </Row>
                    <Row justify="space-between">
                      <Col>
                        <Text>最长边：</Text>
                      </Col>
                      <Col>
                        <Text strong>{maxDimension} cm</Text>
                      </Col>
                    </Row>
                  </Space>
                </Card>

                <Alert
                  message="体积重量 = (长×宽×高) / 5000"
                  type="info"
                  showIcon
                  className={styles.alertMargin}
                />
              </Col>
            </Row>
          </Form>
        </Card>

        {/* 6个标签页 */}
        <Card
          styles={{
            body: {
              padding: '16px',
            },
          }}
        >
          <style>{`
          .disabled-row {
            opacity: 0.5;
            background-color: #f5f5f5;
          }
          .ant-table-thead > tr > th {
            background-color: #e6f4ff;
            color: #1890ff;
            font-weight: 600;
          }
        `}</style>
          <Tabs
            activeKey={activeKey}
            onChange={setActiveKey}
            items={OZON_UNI_DATA.map((category) => ({
              key: category.id,
              label: (
                <Space>
                  <Text strong>{category.nameEN}</Text>
                  <Text type="secondary">({category.name})</Text>
                  <Tag>{category.weightRange}</Tag>
                </Space>
              ),
              children: renderServiceTable(category),
            }))}
          />
        </Card>
      </div>
    </div>
  );
};

export default ShippingDetailCalculator;
