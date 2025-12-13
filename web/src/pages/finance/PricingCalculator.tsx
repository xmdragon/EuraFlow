/**
 * 定价器组件
 * 根据商品成本、期望毛利等参数，反推建议售价
 */
import { CalculatorOutlined, QuestionCircleOutlined, DownOutlined, UpOutlined, CopyOutlined } from '@ant-design/icons';
import {
  Card,
  Form,
  InputNumber,
  Row,
  Col,
  Typography,
  Space,
  Select,
  Button,
  Divider,
  Tooltip,
  Cascader,
  Switch,
  Collapse,
} from 'antd';
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useExchangeRate } from '@/hooks/useExchangeRate';
import { useCopy } from '@/hooks/useCopy';
import { apiClient } from '@/services/ozon';

import styles from './PricingCalculator.module.scss';

const { Text, Title } = Typography;
const { Panel } = Collapse;

// API 响应类型
interface CategoryCommission {
  id: number;
  category_module: string;
  category_name: string;
  rfbs_tier1: number;
  rfbs_tier2: number;
  rfbs_tier3: number;
}

interface ShippingRateItem {
  id: number;
  size_group: string;
  service_level: string;
  logistics_provider: string;
  delivery_method: string;
  ozon_rating: number | null;
  transit_days: string | null;
  rate: string;
  battery_allowed: boolean;
  liquid_allowed: boolean;
  size_limit: string | null;
  weight_min_g: number | null;
  weight_max_g: number | null;
}

// 级联选择器选项类型
interface CascaderOption {
  value: string | number;
  label: string;
  children?: CascaderOption[];
  commission?: {
    tier1: number;
    tier2: number;
    tier3: number;
  };
}

// 计算结果类型
interface CalculationResult {
  priceRmb: number;
  priceRub: number;
  crossBorderShipping: number;
  platformCommission: number;
  adFee: number;
  withdrawFee: number;
  returnLoss: number;
  profit: number;
  profitRate: number;
}

// 解析费率公式
function parseRateFormula(rate: string): { base: number; perGram: number } {
  if (!rate) return { base: 0, perGram: 0 };
  const normalized = rate.replace(',', '.');
  const match = normalized.match(/¥?([\d.]+)\s*\+\s*¥?([\d.]+)\/1g/);
  if (match) {
    return { base: parseFloat(match[1]), perGram: parseFloat(match[2]) };
  }
  return { base: 0, perGram: 0 };
}

const PricingCalculator: React.FC = () => {
  const [form] = Form.useForm();
  const { cnyToRub: exchangeRate } = useExchangeRate();
  const { copyToClipboard } = useCopy();
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [selectedRate, setSelectedRate] = useState<ShippingRateItem | null>(null);

  // 获取物流费率列表
  const { data: shippingRatesData } = useQuery({
    queryKey: ['shipping-rates-list'],
    queryFn: async () => {
      const res = await apiClient.get<{ items: ShippingRateItem[]; total: number }>('/ozon/shipping-rates/list');
      return res.data.items || [];
    },
  });

  // 获取类目列表
  const { data: categoriesData } = useQuery({
    queryKey: ['category-commissions', 'all'],
    queryFn: async () => {
      const res = await apiClient.get<{ items: CategoryCommission[]; total: number }>(
        '/ozon/category-commissions',
        { params: { page_size: 1000 } }
      );
      return res.data?.items || [];
    },
  });


  // 构建类目级联选择器选项（3级：模块 → 类目 → 价格区间）
  const cascaderOptions = useMemo(() => {
    if (!categoriesData) return [];

    const moduleMap = new Map<string, CategoryCommission[]>();
    categoriesData.forEach((item: CategoryCommission) => {
      const list = moduleMap.get(item.category_module) || [];
      list.push(item);
      moduleMap.set(item.category_module, list);
    });

    const options: CascaderOption[] = [];
    moduleMap.forEach((categories, module) => {
      options.push({
        value: module,
        label: module,
        children: categories.map((cat: CategoryCommission) => ({
          value: cat.id,
          label: cat.category_name,
          children: [
            {
              value: `${cat.id}-tier1`,
              label: `≤1500₽: ${cat.rfbs_tier1}%`,
              commission: { tier1: cat.rfbs_tier1, tier2: cat.rfbs_tier2, tier3: cat.rfbs_tier3 },
            },
            {
              value: `${cat.id}-tier2`,
              label: `1501-5000₽: ${cat.rfbs_tier2}%`,
              commission: { tier1: cat.rfbs_tier1, tier2: cat.rfbs_tier2, tier3: cat.rfbs_tier3 },
            },
            {
              value: `${cat.id}-tier3`,
              label: `>5000₽: ${cat.rfbs_tier3}%`,
              commission: { tier1: cat.rfbs_tier1, tier2: cat.rfbs_tier2, tier3: cat.rfbs_tier3 },
            },
          ],
        })),
      });
    });

    options.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    return options;
  }, [categoriesData]);

  // 处理类目选择（3级）
  const handleCategoryChange = (value: (string | number)[], selectedOptions: CascaderOption[]) => {
    if (selectedOptions && selectedOptions.length === 3) {
      const thirdLevel = selectedOptions[2];
      const tierValue = String(value[2]);
      if (thirdLevel.commission) {
        // 根据选择的价格区间设置对应的佣金率
        let rate = thirdLevel.commission.tier1;
        if (tierValue.endsWith('-tier2')) {
          rate = thirdLevel.commission.tier2;
        } else if (tierValue.endsWith('-tier3')) {
          rate = thirdLevel.commission.tier3;
        }
        form.setFieldsValue({ commissionRate: rate });
      }
    }
  };

  // 计算售价
  const handleCalculate = () => {
    const values = form.getFieldsValue();
    const {
      purchaseCost = 0,
      weight = 0,
      profitRate = 20,
      frontDiscount = 0,
      joinPromotion = false,
      promotionDiscount = 0,
      domesticShipping = 0,
      adRate = 8,
      withdrawRate = 1.4,
      returnRate = 2,
      otherFee = 0,
      commissionRate = 14,
    } = values;

    // 计算跨境运费（从选中的物流费率获取）
    let crossBorderShipping = 0;
    if (selectedRate) {
      const { base, perGram } = parseRateFormula(selectedRate.rate);
      crossBorderShipping = base + perGram * weight;
    } else {
      // 默认费率: base=3, perGram=0.035
      crossBorderShipping = 3 + 0.035 * weight;
    }

    // 固定成本
    const fixedCost = purchaseCost + domesticShipping + otherFee + crossBorderShipping;

    // 比例费用总和（佣金 + 广告 + 提现 + 退货）
    const totalRatePercent = commissionRate + adRate + withdrawRate + returnRate;

    // 计算售价公式：P = fixedCost / (1 - totalRate - profitRate)
    const denominator = 1 - totalRatePercent / 100 - profitRate / 100;

    if (denominator <= 0) {
      // 无法盈利
      setResult(null);
      return;
    }

    const priceRmb = fixedCost / denominator;
    const priceRub = priceRmb * (exchangeRate || 13.5);

    // 计算各项费用
    const platformCommission = priceRmb * (commissionRate / 100);
    const adFee = priceRmb * (adRate / 100);
    const withdrawFee = priceRmb * (withdrawRate / 100);
    const returnLoss = priceRmb * (returnRate / 100);
    const profit = priceRmb * (profitRate / 100);

    setResult({
      priceRmb,
      priceRub,
      crossBorderShipping,
      platformCommission,
      adFee,
      withdrawFee,
      returnLoss,
      profit,
      profitRate,
    });
  };

  // 监听表单变化自动计算
  const handleValuesChange = () => {
    handleCalculate();
  };

  // 监听选中费率变化自动计算
  useEffect(() => {
    if (selectedRate) {
      handleCalculate();
    }
  }, [selectedRate]);

  return (
    <div className={styles.container}>
      <Row gutter={24}>
        {/* 左侧：输入区域 */}
        <Col span={12}>
          <Card title="基本参数" className={styles.inputCard}>
            <Form
              form={form}
              layout="horizontal"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
              initialValues={{
                profitRate: 20,
                frontDiscount: 0,
                joinPromotion: false,
                promotionDiscount: 0,
                domesticShipping: 5,
                adRate: 8,
                withdrawRate: 1.4,
                returnRate: 2,
                otherFee: 4,
                commissionRate: 14,
              }}
              onValuesChange={handleValuesChange}
            >
              {/* 商品类目 */}
              <Form.Item
                label={
                  <Space>
                    商品类目
                    <Tooltip title="选择类目后自动填充佣金率">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
                name="category"
              >
                <Cascader
                  options={cascaderOptions}
                  onChange={handleCategoryChange}
                  placeholder="选择一级类目 / 二级类目"
                  showSearch={{
                    filter: (inputValue, path) =>
                      path.some((option) =>
                        String(option.label).toLowerCase().includes(inputValue.toLowerCase())
                      ),
                  }}
                  expandTrigger="hover"
                />
              </Form.Item>

              {/* 采购成本 */}
              <Form.Item
                label={
                  <Space>
                    采购成本
                    <Tooltip title="商品采购价格">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
                name="purchaseCost"
                rules={[{ required: true, message: '请输入采购成本' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  addonAfter="¥"
                />
              </Form.Item>

              {/* 包裹重量 */}
              <Form.Item
                label={
                  <Space>
                    包裹重量
                    <Tooltip title="商品包装后的重量">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
                name="weight"
                rules={[{ required: true, message: '请输入包裹重量' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={30000}
                  precision={0}
                  addonAfter="g"
                />
              </Form.Item>

              {/* 期望毛利 */}
              <Form.Item
                label={
                  <Space>
                    期望毛利
                    <Tooltip title="期望的利润率">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="profitType" noStyle initialValue="rate">
                    <Select style={{ width: 100 }} aria-label="毛利类型">
                      <Select.Option value="rate">毛利率</Select.Option>
                      <Select.Option value="amount">毛利额</Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name="profitRate" noStyle>
                    <InputNumber style={{ width: 'calc(100% - 100px)' }} min={0} max={100} aria-label="期望毛利数值" />
                  </Form.Item>
                  <span className={styles.addonAfter}>%</span>
                </Space.Compact>
              </Form.Item>

              {/* 前台折扣 */}
              <Form.Item
                label={
                  <Space>
                    前台折扣
                    <Tooltip title="商品前台显示的折扣">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
                name="frontDiscount"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={100}
                  precision={2}
                  addonAfter="%"
                />
              </Form.Item>

              {/* 是否参加营销活动 */}
              <Form.Item
                label={
                  <Space>
                    是否参加营销活动
                    <Tooltip title="参加平台营销活动的折扣">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="joinPromotion" noStyle valuePropName="checked">
                    <Select style={{ width: 80 }} aria-label="是否参加营销活动">
                      <Select.Option value={false}>否</Select.Option>
                      <Select.Option value={true}>是</Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name="promotionDiscount" noStyle>
                    <InputNumber style={{ width: 'calc(100% - 80px)' }} min={0} max={100} precision={2} aria-label="营销活动折扣比例" />
                  </Form.Item>
                  <span className={styles.addonAfter}>%</span>
                </Space.Compact>
              </Form.Item>

              {/* 跨境物流 */}
              <Form.Item
                label={
                  <Space>
                    跨境物流
                    <Tooltip title="选择物流配送方式，费率将自动计算">
                      <QuestionCircleOutlined aria-hidden="true" />
                    </Tooltip>
                  </Space>
                }
                name="shippingRateId"
              >
                <Select
                  showSearch
                  placeholder="选择配送方式"
                  optionFilterProp="label"
                  onChange={(value: number) => {
                    const rate = shippingRatesData?.find((r) => r.id === value);
                    setSelectedRate(rate || null);
                  }}
                  options={shippingRatesData?.map((rate) => ({
                    value: rate.id,
                    label: rate.delivery_method,
                  }))}
                />
              </Form.Item>
              {selectedRate && (
                <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4, fontSize: 12 }}>
                  <Space direction="vertical" size={2}>
                    <Text type="secondary">
                      费率: {selectedRate.rate} | 尺寸组: {selectedRate.size_group} | 服务等级: {selectedRate.service_level}
                    </Text>
                    <Text type="secondary">
                      带电: {selectedRate.battery_allowed ? '✓' : '✗'} | 液体: {selectedRate.liquid_allowed ? '✓' : '✗'} |
                      重量: {selectedRate.weight_min_g || 0}g - {selectedRate.weight_max_g || 30000}g
                    </Text>
                  </Space>
                </div>
              )}

              <Divider style={{ margin: '12px 0' }} />

              {/* 其他参数 - 可折叠 */}
              <Collapse ghost defaultActiveKey={['other']}>
                <Panel header="其他参数" key="other">
                  {/* 境内段运费 */}
                  <Form.Item
                    label={
                      <Space>
                        境内段运费
                        <Tooltip title="国内发货到仓库的运费">
                          <QuestionCircleOutlined aria-hidden="true" />
                        </Tooltip>
                      </Space>
                    }
                    name="domesticShipping"
                  >
                    <InputNumber style={{ width: '100%' }} min={0} precision={2} addonAfter="¥" />
                  </Form.Item>

                  {/* 广告费比例 */}
                  <Form.Item
                    label={
                      <Space>
                        广告费比例
                        <Tooltip title="预估广告费占销售额的比例">
                          <QuestionCircleOutlined aria-hidden="true" />
                        </Tooltip>
                      </Space>
                    }
                    name="adRate"
                  >
                    <InputNumber style={{ width: '100%' }} min={0} max={100} precision={1} addonAfter="%" />
                  </Form.Item>

                  {/* 提现手续费率 */}
                  <Form.Item
                    label={
                      <Space>
                        提现手续费率
                        <Tooltip title="平台提现手续费比例">
                          <QuestionCircleOutlined aria-hidden="true" />
                        </Tooltip>
                      </Space>
                    }
                    name="withdrawRate"
                  >
                    <InputNumber style={{ width: '100%' }} min={0} max={100} precision={2} addonAfter="%" />
                  </Form.Item>

                  {/* 退货率 */}
                  <Form.Item
                    label={
                      <Space>
                        退货率
                        <Tooltip title="预估退货率">
                          <QuestionCircleOutlined aria-hidden="true" />
                        </Tooltip>
                      </Space>
                    }
                    name="returnRate"
                  >
                    <InputNumber style={{ width: '100%' }} min={0} max={100} precision={1} addonAfter="%" />
                  </Form.Item>

                  {/* 其他费用 */}
                  <Form.Item
                    label={
                      <Space>
                        其他费用
                        <Tooltip title="其他杂项费用">
                          <QuestionCircleOutlined aria-hidden="true" />
                        </Tooltip>
                      </Space>
                    }
                    name="otherFee"
                  >
                    <InputNumber style={{ width: '100%' }} min={0} precision={2} addonAfter="¥" />
                  </Form.Item>

                  {/* 佣金率 */}
                  <Form.Item
                    label={
                      <Space>
                        平台佣金率
                        <Tooltip title="平台收取的佣金比例（根据类目自动填充）">
                          <QuestionCircleOutlined aria-hidden="true" />
                        </Tooltip>
                      </Space>
                    }
                    name="commissionRate"
                  >
                    <InputNumber style={{ width: '100%' }} min={0} max={100} precision={1} addonAfter="%" />
                  </Form.Item>
                </Panel>
              </Collapse>

              <Form.Item style={{ marginTop: 16 }}>
                <Button type="primary" block size="large" onClick={handleCalculate}>
                  开始计算
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* 右侧：计算结果 */}
        <Col span={12}>
          <Card title="计算结果" className={styles.resultCard}>
            {result ? (
              <>
                {/* 售价展示 */}
                <div className={styles.priceSection}>
                  <Row gutter={24}>
                    <Col span={12}>
                      <div className={styles.priceBox}>
                        <Text type="secondary">
                          售价
                          <Tooltip title="计算得出的建议售价">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </Text>
                        <div className={styles.mainPrice}>
                          <Text className={styles.priceValue}>¥{result.priceRmb.toFixed(2)}</Text>
                          <CopyOutlined
                            className={styles.copyIcon}
                            onClick={() => copyToClipboard(result.priceRmb.toFixed(2), '售价')}
                            role="button"
                            aria-label="复制售价"
                            tabIndex={0}
                          />
                        </div>
                        <div className={styles.subPrice}>
                          <Text type="secondary">₽ {result.priceRub.toFixed(2)}</Text>
                        </div>
                      </div>
                    </Col>
                    <Col span={12}>
                      <div className={styles.priceBox}>
                        <Text type="secondary">
                          划线价
                          <Tooltip title="原价（可用于设置折扣）">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </Text>
                        <div className={styles.mainPrice}>
                          <Text className={styles.priceValueStrike}>¥{result.priceRmb.toFixed(2)}</Text>
                          <CopyOutlined
                            className={styles.copyIcon}
                            onClick={() => copyToClipboard(result.priceRmb.toFixed(2), '划线价')}
                            role="button"
                            aria-label="复制划线价"
                            tabIndex={0}
                          />
                        </div>
                        <div className={styles.subPrice}>
                          <Text type="secondary">₽ {result.priceRub.toFixed(2)}</Text>
                        </div>
                      </div>
                    </Col>
                  </Row>
                  <div className={styles.rateInfo}>
                    <Text type="secondary">
                      ¥: 人民币(CNY)，₽: 卢布(RUB)
                    </Text>
                    <br />
                    <Text type="secondary">
                      ¥1 ≈ ₽ {exchangeRate?.toFixed(4) || '-'}
                    </Text>
                  </div>
                </div>

                <Divider />

                {/* 计算明细 */}
                <div className={styles.detailSection}>
                  <Title level={5}>计算明细</Title>
                  <table className={styles.detailTable}>
                    <tbody>
                      <tr>
                        <td rowSpan={2} className={styles.category}>商品利润</td>
                        <td>
                          利润（毛利）
                          <Tooltip title="预期获得的利润">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="success">¥ {result.profit.toFixed(2)}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          利润率（毛利率）
                          <Tooltip title="利润占售价的比例">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="success">{result.profitRate} %</Text>
                        </td>
                      </tr>
                      <tr>
                        <td rowSpan={3} className={styles.category}>商品成本</td>
                        <td>
                          采购成本
                          <Tooltip title="商品采购价格">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {form.getFieldValue('purchaseCost') || 0}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          境内段运费
                          <Tooltip title="国内发货到仓库的运费">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {form.getFieldValue('domesticShipping') || 0}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          其他费用
                          <Tooltip title="其他杂项费用">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {form.getFieldValue('otherFee') || 0}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.category}></td>
                        <td>
                          跨境运费
                          <Tooltip title="跨境物流费用">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {result.crossBorderShipping.toFixed(2)}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td rowSpan={4} className={styles.category}>平台费用</td>
                        <td>
                          平台佣金
                          <Tooltip title="平台收取的佣金">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {result.platformCommission.toFixed(2)}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          广告费
                          <Tooltip title="预估广告支出">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {result.adFee.toFixed(2)}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          提现手续费
                          <Tooltip title="平台提现手续费">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {result.withdrawFee.toFixed(2)}</Text>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          退货损失
                          <Tooltip title="预估退货造成的损失">
                            <QuestionCircleOutlined style={{ marginLeft: 4 }} aria-hidden="true" />
                          </Tooltip>
                        </td>
                        <td className={styles.valueCell}>
                          <Text type="danger">¥ {result.returnLoss.toFixed(2)}</Text>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className={styles.emptyResult}>
                <Text type="secondary">请输入参数后点击"开始计算"</Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default PricingCalculator;
