import React, { useState, useEffect } from 'react';
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
import { 
  OZON_UNI_DATA, 
  calculateVolumeWeight, 
  calculateChargeableWeight,
  calculateShippingFee,
  checkServiceAvailable,
  type UNIService,
  type UNICategory
} from './ozonUniShippingData';

const { Title, Text } = Typography;
const { Option } = Select;

interface CalculationData {
  weight: number;          // 重量(克)
  length: number;          // 长(cm)
  width: number;           // 宽(cm)
  height: number;          // 高(cm)
  value: number;          // 货值(卢布)
  deliveryType: 'pickup' | 'delivery';  // 自提点/送货上门
}

const ShippingDetailCalculator: React.FC = () => {
  const [form] = Form.useForm();
  const [calculationData, setCalculationData] = useState<CalculationData>({
    weight: 530,
    length: 30,
    width: 30,
    height: 30,
    value: 1500,
    deliveryType: 'pickup'
  });
  
  const [volumeWeight, setVolumeWeight] = useState(0);
  const [chargeableWeight, setChargeableWeight] = useState(0);
  const [sumDimension, setSumDimension] = useState(0);
  const [maxDimension, setMaxDimension] = useState(0);
  const [activeKey, setActiveKey] = useState<string>('extra-small');

  // 根据重量自动选择合适的标签页
  const getActiveTabByWeight = (weight: number, value: number): string => {
    // UNI Extra Small: 1g-500g
    if (weight >= 1 && weight <= 500) {
      return 'extra-small';
    }
    // UNI Budget: 501g-25kg (只适用于501g以上，价值≤1500卢布)
    if (weight >= 501 && weight <= 25000 && value <= 1500) {
      return 'budget';
    }
    // UNI Small: 1g-2kg (价值1500-7000卢布)
    if (weight >= 1 && weight <= 2000 && value > 1500 && value <= 7000) {
      return 'small';
    }
    // UNI Big: 2.001kg-25kg (价值1501-7000卢布)
    if (weight >= 2001 && weight <= 25000 && value > 1500 && value <= 7000) {
      return 'big';
    }
    // UNI Premium Small: 1g-5kg (高客单价>7000)
    if (weight >= 1 && weight <= 5000 && value > 7000) {
      return 'premium-small';
    }
    // UNI Premium Big: 5.001kg-25kg (高客单价>7000)
    if (weight >= 5001 && weight <= 25000 && value > 7000) {
      return 'premium-big';
    }
    
    // 默认返回最合适的
    if (weight <= 500) return 'extra-small';
    if (weight <= 2000) return 'small';
    if (weight <= 5000) return value > 7000 ? 'premium-small' : 'big';
    return value > 7000 ? 'premium-big' : 'budget';
  };

  // 计算体积重量和尺寸
  useEffect(() => {
    const { weight, length, width, height, value } = calculationData;
    const volWeight = calculateVolumeWeight(length, width, height);
    const charWeight = calculateChargeableWeight(weight, volWeight);
    const sum = length + width + height;
    const max = Math.max(length, width, height);
    
    setVolumeWeight(volWeight);
    setChargeableWeight(charWeight);
    setSumDimension(sum);
    setMaxDimension(max);
    
    // 自动切换到合适的标签页
    const newActiveKey = getActiveTabByWeight(weight, value);
    setActiveKey(newActiveKey);
  }, [calculationData]);

  // 处理表单值变化
  const handleFormChange = (changedValues: any) => {
    setCalculationData(prev => ({
      ...prev,
      ...changedValues
    }));
  };

  // 渲染服务表格
  const renderServiceTable = (category: UNICategory) => {
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
            <Text>{record.minDays}-{record.maxDays}天</Text>
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
          return <Text strong style={{ color: '#52c41a' }}>¥{fee.toFixed(2)}</Text>;
        },
      },
      {
        title: '最大重量',
        dataIndex: 'maxWeight',
        key: 'maxWeight',
        width: 100,
        render: (weight: number) => weight ? `${weight}克` : '不限',
      },
      {
        title: '货值限制',
        dataIndex: 'maxValue',
        key: 'maxValue',
        width: 120,
        render: (value: number) => value ? `${value}卢布` : '不限',
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
                <Text key={index} style={{ fontSize: 12 }}>{limit}</Text>
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
      {/* 价格测算表 */}
      <Card title="价格测算表" style={{ marginBottom: 16 }}>
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
                      style={{ width: '100%' }} 
                      min={1} 
                      max={25000}
                      precision={0}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="货值(卢布)" name="value">
                    <InputNumber 
                      style={{ width: '100%' }} 
                      min={0}
                      precision={0}
                    />
                  </Form.Item>
                </Col>
              </Row>
              
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="长(cm)" name="length">
                    <InputNumber 
                      style={{ width: '100%' }} 
                      min={1} 
                      max={150}
                      precision={0}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="宽(cm)" name="width">
                    <InputNumber 
                      style={{ width: '100%' }} 
                      min={1} 
                      max={150}
                      precision={0}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="高(cm)" name="height">
                    <InputNumber 
                      style={{ width: '100%' }} 
                      min={1} 
                      max={150}
                      precision={0}
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
                <Space direction="vertical" style={{ width: '100%' }}>
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
                style={{ marginTop: 16 }}
              />
            </Col>
          </Row>
        </Form>
      </Card>

      {/* 6个标签页 */}
      <Card 
        styles={{
          body: { 
            padding: '16px'
          }
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
          items={OZON_UNI_DATA.map(category => ({
            key: category.id,
            label: (
              <Space>
                <Text strong>{category.nameEN}</Text>
                <Text type="secondary">({category.name})</Text>
                <Tag>{category.weightRange}</Tag>
              </Space>
            ),
            children: renderServiceTable(category)
          }))}
        />
      </Card>
    </div>
  );
};

export default ShippingDetailCalculator;