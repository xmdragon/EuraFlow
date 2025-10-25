/* eslint-disable no-unused-vars */
/**
 * 商品过滤栏组件
 * 包含店铺选择、搜索、状态过滤等功能
 */
import { SearchOutlined, PlusOutlined, DollarOutlined } from '@ant-design/icons';
import { Card, Form, Input, Select, Button, Space, FormInstance } from 'antd';
import React from 'react';

import styles from '../../../pages/ozon/ProductList.module.scss';

import ProductStatusTabs, { ProductStats } from './ProductStatusTabs';

import ShopSelector from '@/components/ozon/ShopSelector';

const { Option } = Select;

export interface FilterValues {
  search?: string;
  status?: string;
}

export interface ProductFilterBarProps {
  /** Form 实例 */
  form: FormInstance;
  /** 当前选中的店铺ID */
  selectedShop: number | null;
  /** 店铺改变时的回调 */
  onShopChange: (_value: number | null) => void;
  /** 过滤值 */
  filterValues: FilterValues;
  /** 过滤提交处理 */
  onFilter: (_filters: FilterValues) => void;
  /** 重置处理 */
  onReset: () => void;
  /** 状态改变回调 */
  onStatusChange: (_newStatus: string) => void;
  /** 新建商品回调 */
  onCreateProduct: () => void;
  /** 促销商品回调 */
  onPromotions?: () => void;
  /** 全局统计数据 */
  stats?: ProductStats | null;
}

/**
 * 商品过滤栏组件
 */
export const ProductFilterBar: React.FC<ProductFilterBarProps> = ({
  form,
  selectedShop,
  onShopChange,
  filterValues,
  onFilter,
  onReset,
  onStatusChange,
  onCreateProduct,
  onPromotions,
  stats,
}) => {
  return (
    <Card className={styles.filterCard}>
      <Form form={form} layout="inline" onFinish={onFilter}>
        <Form.Item label="选择店铺">
          <ShopSelector
            value={selectedShop}
            onChange={onShopChange}
            showAllOption={false}
            className={styles.shopSelector}
          />
        </Form.Item>
        <Form.Item name="search">
          <Input
            placeholder="搜索 (SKU/标题/条码/产品ID)"
            prefix={<SearchOutlined />}
            style={{ width: 250 }}
          />
        </Form.Item>
        <Form.Item name="status">
          <Select placeholder="状态" style={{ width: 120 }} allowClear>
            <Option value="on_sale">销售中</Option>
            <Option value="ready_to_sell">准备销售</Option>
            <Option value="error">错误</Option>
            <Option value="pending_modification">待修改</Option>
            <Option value="inactive">下架</Option>
            <Option value="archived">已归档</Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
            <Button onClick={onReset}>重置</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreateProduct}>
              新建商品
            </Button>
            {onPromotions && (
              <Button icon={<DollarOutlined />} onClick={onPromotions}>
                促销商品
              </Button>
            )}
          </Space>
        </Form.Item>
      </Form>

      {/* 商品状态标签 */}
      <ProductStatusTabs
        stats={stats}
        activeStatus={filterValues.status || 'on_sale'}
        onStatusChange={onStatusChange}
      />
    </Card>
  );
};

export default ProductFilterBar;
