/**
 * OZON 选品助手 - 搜索表单组件
 *
 * 提供商品筛选和成本估算配置界面
 */

import React from 'react';
import {
  Form,
  Button,
  Select,
  InputNumber,
  Space,
  Row,
  Col,
  DatePicker,
  Checkbox,
  Card,
} from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';

import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';

import styles from '@/pages/ozon/ProductSelection.module.scss';

const { Option } = Select;

/**
 * 搜索表单组件 Props
 */
export interface ProductSearchFormProps {
  /** 表单实例 */
  form: FormInstance;
  /** 品牌列表 */
  brands: string[];
  /** 是否启用成本估算 */
  enableCostEstimation: boolean;
  /** 目标利润率（百分比） */
  targetProfitRate: number;
  /** 打包费（RMB） */
  packingFee: number;
  /** 是否记住选择 */
  rememberFilters: boolean;
  /** 成本估算开关变化 */
  onEnableCostChange: (val: boolean) => void;
  /** 利润率变化 */
  onProfitRateChange: (val: number) => void;
  /** 打包费变化 */
  onPackingFeeChange: (val: number) => void;
  /** 记住选择变化 */
  onRememberChange: (val: boolean) => void;
  /** 搜索提交 */
  onSearch: (values: unknown) => void;
  /** 重置表单 */
  onReset: () => void;
}

/**
 * 搜索表单组件
 */
export const ProductSearchForm: React.FC<ProductSearchFormProps> = ({
  form,
  brands,
  enableCostEstimation,
  targetProfitRate,
  packingFee,
  rememberFilters,
  onEnableCostChange,
  onProfitRateChange,
  onPackingFeeChange,
  onRememberChange,
  onSearch,
  onReset,
}) => {
  return (
    <Card className={styles.searchFormCard}>
      <Form
        form={form}
        layout="inline"
        onFinish={onSearch}
        initialValues={{ sort_by: 'source_order' }}
      >
        <Row wrap>
          {/* 品牌筛选 */}
          <Col flex="auto" style={{ minWidth: '150px' }}>
            <Form.Item label="品牌" name="brand">
              <Select
                placeholder="品牌"
                allowClear
                showSearch
                style={{ width: '100%' }}
                filterOption={(input, option) =>
                  String(option?.value ?? '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              >
                {brands.map((brand) => (
                  <Option key={brand} value={brand}>
                    {brand === 'без бренда' ? '无品牌' : brand}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>

          {/* 上架时间筛选 */}
          <Col>
            <Form.Item label="上架晚于" name="listing_date" style={{ marginBottom: 0 }}>
              <DatePicker
                style={{ width: '110px' }}
                format="YYYY-MM-DD"
                placeholder="选择日期"
              />
            </Form.Item>
          </Col>

          {/* 排序选项 */}
          <Col flex="auto" style={{ minWidth: '150px' }}>
            <Form.Item label="排序" name="sort_by">
              <Select placeholder="原始顺序" style={{ width: '100%' }}>
                <Option value="source_order">原始顺序</Option>
                <Option value="created_asc">最早导入</Option>
                <Option value="created_desc">最新导入</Option>
                <Option value="sales_desc">销量↓</Option>
                <Option value="sales_asc">销量↑</Option>
                <Option value="weight_asc">重量↑</Option>
                <Option value="price_asc">价格↑</Option>
                <Option value="price_desc">价格↓</Option>
              </Select>
            </Form.Item>
          </Col>

          {/* 月销量范围 */}
          <Col>
            <Form.Item label="月销量" style={{ marginBottom: 0 }}>
              <Space.Compact>
                <Form.Item name="monthly_sales_min" noStyle>
                  <InputNumber
                    min={0}
                    controls={false}
                    style={{ width: '70px' }}
                    placeholder="最小"
                  />
                </Form.Item>
                <Form.Item name="monthly_sales_max" noStyle>
                  <InputNumber
                    min={0}
                    controls={false}
                    style={{ width: '70px' }}
                    placeholder="最大"
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          </Col>

          {/* 重量上限 */}
          <Col>
            <Form.Item label="重量≤" name="weight_max" style={{ marginBottom: 0 }}>
              <InputNumber
                min={0}
                controls={false}
                style={{ width: '70px' }}
                placeholder="g"
                suffix="g"
              />
            </Form.Item>
          </Col>

          {/* 跟卖者数量范围 */}
          <Col>
            <Form.Item label="跟卖者数量" style={{ marginBottom: 0 }}>
              <Space.Compact>
                <Form.Item name="competitor_count_min" noStyle>
                  <InputNumber
                    min={0}
                    controls={false}
                    style={{ width: '70px' }}
                    placeholder="最小"
                  />
                </Form.Item>
                <Form.Item name="competitor_count_max" noStyle>
                  <InputNumber
                    min={0}
                    controls={false}
                    style={{ width: '70px' }}
                    placeholder="最大"
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          </Col>

          {/* 最低跟卖价范围 */}
          <Col>
            <Form.Item label="最低跟卖价" style={{ marginBottom: 0 }}>
              <Space.Compact>
                <Form.Item name="competitor_min_price_min" noStyle>
                  <InputNumber
                    min={0}
                    controls={false}
                    style={{ width: '70px' }}
                    placeholder="最小"
                  />
                </Form.Item>
                <Form.Item name="competitor_min_price_max" noStyle>
                  <InputNumber
                    min={0}
                    controls={false}
                    style={{ width: '70px' }}
                    placeholder="最大"
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          </Col>

          {/* 成本估算配置 */}
          <Col>
            <Space>
              <Checkbox checked={enableCostEstimation} onChange={(e) => onEnableCostChange(e.target.checked)}>
                成本估算
              </Checkbox>
              <Space.Compact>
                <InputNumber
                  value={targetProfitRate}
                  onChange={(val) => onProfitRateChange((val as number) || 20)}
                  min={0}
                  max={100}
                  formatter={getNumberFormatter(2)}
                  parser={getNumberParser()}
                  controls={false}
                  addonBefore="利润率"
                  addonAfter="%"
                  style={{ width: '150px' }}
                  disabled={!enableCostEstimation}
                />
              </Space.Compact>
            </Space>
          </Col>

          {/* 打包费配置 */}
          <Col>
            <Space.Compact>
              <InputNumber
                value={packingFee}
                onChange={(val) => onPackingFeeChange(typeof val === 'number' ? val : 0)}
                min={0}
                precision={1}
                controls={false}
                placeholder="0"
                formatter={getNumberFormatter(1)}
                parser={getNumberParser()}
                addonBefore="打包费"
                addonAfter="RMB"
                style={{ width: '150px' }}
                disabled={!enableCostEstimation}
              />
            </Space.Compact>
          </Col>

          {/* 操作按钮 */}
          <Col span={24}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                搜索
              </Button>
              <Button onClick={onReset} icon={<ReloadOutlined />}>
                重置
              </Button>
              <Checkbox checked={rememberFilters} onChange={(e) => onRememberChange(e.target.checked)}>
                记住我的选择
              </Checkbox>
            </Space>
          </Col>
        </Row>
      </Form>
    </Card>
  );
};
