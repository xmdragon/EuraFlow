import {
  TruckOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Table,
  Tag,
  Row,
  Col,
  Alert,
  Divider,
  Typography,
  message,
} from 'antd';
import React, { useState } from 'react';

import { financeService } from '@/services/finance';

const { Title, Text } = Typography;
const { Option } = Select;

interface ShippingResult {
  service_type: string;
  total_cost: number;
  delivery_days_min: number;
  delivery_days_max: number;
  actual_weight_kg: number;
  volume_weight_kg: number;
  chargeable_weight_kg: number;
  rejected: boolean;
  rejection_reason?: string;
}

const ShippingDetailCalculator: React.FC = () => {
  const [shippingForm] = Form.useForm();
  const [shippingResults, setShippingResults] = useState<ShippingResult[]>([]);
  const [loading, setLoading] = useState(false);

  // 计算运费
  const calculateShipping = async (values: Record<string, unknown>) => {
    setLoading(true);
    try {
      const results = await financeService.calculateMultipleShipping({
        platform: String(values.platform || 'OZON'),
        carrier_service: 'STANDARD',
        service_type: String(values.service_type || 'STANDARD'),
        weight_g: Number(values.weight_g || 0),
        dimensions: {
          length_cm: Number(values.length_cm || 0),
          width_cm: Number(values.width_cm || 0),
          height_cm: Number(values.height_cm || 0),
        },
        declared_value: Number(values.declared_value || 0),
        selling_price: Number(values.selling_price || 0),
        origin: String(values.origin || 'cn_mainland'),
        fulfillment_model: 'FBO',
      } as any);
      setShippingResults(results);
      message.success('运费计算完成');
    } catch (error) {
      message.error((error as Error).message || '计算失败');
    } finally {
      setLoading(false);
    }
  };

  const shippingColumns = [
    {
      title: '服务类型',
      dataIndex: 'service_type',
      key: 'service_type',
      render: (type: string) => {
        const typeMap: Record<string, { text: string; color: string }> = {
          STANDARD: { text: '标准服务', color: 'blue' },
          EXPRESS: { text: '快速服务', color: 'green' },
          ECONOMY: { text: '经济服务', color: 'orange' },
        };
        const config = typeMap[type] || { text: type, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '运费',
      dataIndex: 'total_cost',
      key: 'total_cost',
      render: (cost: number) => `¥${cost.toFixed(2)}`,
    },
    {
      title: '时效',
      key: 'delivery',
      render: (_: unknown, record: ShippingResult) =>
        `${record.delivery_days_min}-${record.delivery_days_max}天`,
    },
    {
      title: '计费重量(kg)',
      dataIndex: 'chargeable_weight_kg',
      key: 'chargeable_weight_kg',
      render: (weight: number) => weight.toFixed(3),
    },
    {
      title: '状态',
      dataIndex: 'rejected',
      key: 'rejected',
      render: (rejected: boolean, record: ShippingResult) =>
        rejected ? (
          <Tag color="error">{record.rejection_reason || '不可用'}</Tag>
        ) : (
          <Tag color="success">可用</Tag>
        ),
    },
  ];

  return (
    <Card>
      <Form
        form={shippingForm}
        layout="vertical"
        onFinish={calculateShipping}
        initialValues={{
          platform: 'OZON',
          service_type: 'STANDARD',
          battery: false,
          fragile: false,
          liquid: false,
          insurance: false,
        }}
      >
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="platform" label="平台" rules={[{ required: true }]}>
              <Select>
                <Option value="OZON">OZON</Option>
                <Option value="ALIEXPRESS">AliExpress</Option>
                <Option value="WILDBERRIES">Wildberries</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="service_type" label="服务类型" rules={[{ required: true }]}>
              <Select>
                <Option value="STANDARD">标准服务</Option>
                <Option value="EXPRESS">快速服务</Option>
                <Option value="ECONOMY">经济服务</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="origin" label="发货地">
              <Select>
                <Option value="cn_mainland">中国大陆</Option>
                <Option value="cn_hongkong">中国香港</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              name="weight_g"
              label="重量(克)"
              rules={[{ required: true, min: 1, max: 25000 }]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="declared_value"
              label="申报价值"
              rules={[{ required: true, min: 0 }]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="selling_price" label="售价" rules={[{ required: true, min: 0 }]}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Title level={5}>包裹尺寸</Title>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              name="length_cm"
              label="长度(cm)"
              rules={[{ required: true, min: 1, max: 150 }]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="width_cm"
              label="宽度(cm)"
              rules={[{ required: true, min: 1, max: 150 }]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="height_cm"
              label="高度(cm)"
              rules={[{ required: true, min: 1, max: 150 }]}
            >
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            计算运费
          </Button>
        </Form.Item>
      </Form>

      {shippingResults.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Divider />
          <Title level={4}>运费计算结果</Title>
          <Table
            columns={shippingColumns}
            dataSource={shippingResults}
            rowKey="service_type"
            pagination={false}
          />
        </div>
      )}
    </Card>
  );
};

export default ShippingDetailCalculator;