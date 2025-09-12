import React, { useState } from "react";
import {
  Card,
  Tabs,
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
  Statistic,
  Alert,
  Divider,
  Typography,
  message,
} from "antd";
import {
  CalculatorOutlined,
  DollarOutlined,
  TruckOutlined,
  PercentageOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { financeService } from "@/services/finance";

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

interface ProfitResult {
  sku: string;
  cost: number;
  selling_price: number;
  platform_fee: number;
  platform_fee_rate: number;
  selected_shipping_cost: number;
  profit_amount: number;
  profit_rate: number;
  recommended_shipping?: string;
  shipping_options?: Record<string, ShippingResult>;
  optimizations?: Array<{
    suggested_price: number;
    expected_profit: number;
    expected_profit_rate: number;
    optimization_reason: string;
  }>;
  warnings?: string[];
}

const FinanceCalculator: React.FC = () => {
  const [shippingForm] = Form.useForm();
  const [profitForm] = Form.useForm();
  const [shippingResults, setShippingResults] = useState<ShippingResult[]>([]);
  const [profitResult, setProfitResult] = useState<ProfitResult | null>(null);
  const [loading, setLoading] = useState(false);

  // 计算运费
  const calculateShipping = async (values: any) => {
    setLoading(true);
    try {
      const results = await financeService.calculateMultipleShipping({
        ...values,
        length_cm: values.length_cm,
        width_cm: values.width_cm,
        height_cm: values.height_cm,
      });
      setShippingResults(results);
      message.success("运费计算完成");
    } catch (error: any) {
      message.error(error.message || "计算失败");
    } finally {
      setLoading(false);
    }
  };

  // 计算利润
  const calculateProfit = async (values: any) => {
    setLoading(true);
    try {
      const result = await financeService.calculateProfit({
        ...values,
        compare_shipping: true,
      });
      setProfitResult(result);
      message.success("利润计算完成");
    } catch (error: any) {
      message.error(error.message || "计算失败");
    } finally {
      setLoading(false);
    }
  };

  // 运费表格列定义
  const shippingColumns = [
    {
      title: "服务类型",
      dataIndex: "service_type",
      key: "service_type",
      render: (text: string) => {
        const typeMap: Record<string, { color: string; label: string }> = {
          EXPRESS: { color: "red", label: "快速" },
          STANDARD: { color: "blue", label: "标准" },
          ECONOMY: { color: "green", label: "经济" },
        };
        const type = typeMap[text] || { color: "default", label: text };
        return <Tag color={type.color}>{type.label}</Tag>;
      },
    },
    {
      title: "运费 (RUB)",
      dataIndex: "total_cost",
      key: "total_cost",
      render: (cost: number) => <Text strong>¥{cost.toFixed(2)}</Text>,
    },
    {
      title: "时效",
      key: "delivery",
      render: (record: ShippingResult) =>
        `${record.delivery_days_min}-${record.delivery_days_max}天`,
    },
    {
      title: "实重/体积重/计费重 (kg)",
      key: "weight",
      render: (record: ShippingResult) => (
        <Space size="small">
          <Text>{record.actual_weight_kg.toFixed(2)}</Text>
          <Text>/</Text>
          <Text>{record.volume_weight_kg.toFixed(2)}</Text>
          <Text>/</Text>
          <Text strong>{record.chargeable_weight_kg.toFixed(2)}</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "rejected",
      key: "rejected",
      render: (rejected: boolean, record: ShippingResult) =>
        rejected ? (
          <Tag color="error">{record.rejection_reason || "被拒绝"}</Tag>
        ) : (
          <Tag color="success">可用</Tag>
        ),
    },
  ];

  return (
    <div>
      <Title level={2}>
        <CalculatorOutlined /> 财务计算器
      </Title>

      <Tabs defaultActiveKey="shipping">
        <Tabs.TabPane
          tab={
            <span>
              <TruckOutlined />
              运费计算
            </span>
          }
          key="shipping"
        >
          <Card>
            <Form
              form={shippingForm}
              layout="vertical"
              onFinish={calculateShipping}
              initialValues={{
                platform: "OZON",
                service_type: "STANDARD",
                battery: false,
                fragile: false,
                liquid: false,
                insurance: false,
              }}
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="platform"
                    label="平台"
                    rules={[{ required: true }]}
                  >
                    <Select>
                      <Option value="OZON">OZON</Option>
                      <Option value="WILDBERRIES">Wildberries</Option>
                      <Option value="YANDEX">Yandex</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="weight_g"
                    label="重量 (克)"
                    rules={[{ required: true, min: 1, max: 25000 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="selling_price"
                    label="售价 (RUB)"
                    rules={[{ required: true, min: 0 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="length_cm"
                    label="长度 (cm)"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="width_cm"
                    label="宽度 (cm)"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="height_cm"
                    label="高度 (cm)"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
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
        </Tabs.TabPane>

        <Tabs.TabPane
          tab={
            <span>
              <DollarOutlined />
              利润计算
            </span>
          }
          key="profit"
        >
          <Card>
            <Form
              form={profitForm}
              layout="vertical"
              onFinish={calculateProfit}
              initialValues={{
                platform: "OZON",
                fulfillment_model: "FBO",
              }}
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="sku"
                    label="SKU"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="platform"
                    label="平台"
                    rules={[{ required: true }]}
                  >
                    <Select>
                      <Option value="OZON">OZON</Option>
                      <Option value="WILDBERRIES">Wildberries</Option>
                      <Option value="YANDEX">Yandex</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="fulfillment_model"
                    label="履约模式"
                    rules={[{ required: true }]}
                  >
                    <Select>
                      <Option value="FBO">FBO</Option>
                      <Option value="FBS">FBS</Option>
                      <Option value="DBS">DBS</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="cost"
                    label="成本 (RUB)"
                    rules={[{ required: true, min: 0 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="selling_price"
                    label="售价 (RUB)"
                    rules={[{ required: true, min: 0 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="weight_g"
                    label="重量 (克)"
                    rules={[{ required: true, min: 1, max: 25000 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item
                    name="length_cm"
                    label="长度 (cm)"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="width_cm"
                    label="宽度 (cm)"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="height_cm"
                    label="高度 (cm)"
                    rules={[{ required: true, min: 1 }]}
                  >
                    <InputNumber style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  计算利润
                </Button>
              </Form.Item>
            </Form>

            {profitResult && (
              <div style={{ marginTop: 24 }}>
                <Divider />
                <Title level={4}>利润分析结果</Title>

                <Row gutter={16}>
                  <Col span={6}>
                    <Card>
                      <Statistic
                        title="利润额"
                        value={profitResult.profit_amount}
                        precision={2}
                        prefix="¥"
                        valueStyle={{
                          color:
                            profitResult.profit_amount > 0
                              ? "#3f8600"
                              : "#cf1322",
                        }}
                      />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card>
                      <Statistic
                        title="利润率"
                        value={profitResult.profit_rate * 100}
                        precision={2}
                        suffix="%"
                        valueStyle={{
                          color:
                            profitResult.profit_rate > 0.1
                              ? "#3f8600"
                              : "#cf1322",
                        }}
                      />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card>
                      <Statistic
                        title="平台费"
                        value={profitResult.platform_fee}
                        precision={2}
                        prefix="¥"
                      />
                    </Card>
                  </Col>
                  <Col span={6}>
                    <Card>
                      <Statistic
                        title="运费"
                        value={profitResult.selected_shipping_cost}
                        precision={2}
                        prefix="¥"
                      />
                    </Card>
                  </Col>
                </Row>

                {profitResult.warnings && profitResult.warnings.length > 0 && (
                  <Alert
                    style={{ marginTop: 16 }}
                    message="警告"
                    description={
                      <ul>
                        {profitResult.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    }
                    type="warning"
                    showIcon
                  />
                )}

                {profitResult.optimizations &&
                  profitResult.optimizations.length > 0 && (
                    <Card style={{ marginTop: 16 }} title="优化建议">
                      {profitResult.optimizations.map((opt, index) => (
                        <div key={index} style={{ marginBottom: 16 }}>
                          <Alert
                            message={opt.optimization_reason}
                            description={
                              <Space direction="vertical">
                                <Text>
                                  建议售价: ¥{opt.suggested_price.toFixed(2)}
                                </Text>
                                <Text>
                                  预期利润: ¥{opt.expected_profit.toFixed(2)} (
                                  {(opt.expected_profit_rate * 100).toFixed(1)}
                                  %)
                                </Text>
                              </Space>
                            }
                            type="info"
                            showIcon
                            icon={<InfoCircleOutlined />}
                          />
                        </div>
                      ))}
                    </Card>
                  )}
              </div>
            )}
          </Card>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default FinanceCalculator;
