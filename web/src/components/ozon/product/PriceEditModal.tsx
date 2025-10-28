/* eslint-disable no-unused-vars */
/**
 * 价格编辑模态框组件
 * 支持单个商品或批量商品的价格更新
 */
import { Modal, InputNumber, Input, Button, Space, Avatar, List, Form, Select, Alert } from 'antd';
import React, { useState, useEffect } from 'react';

import { getCurrencySymbol } from '@/utils/currency';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

export interface Product {
  offer_id: string;
  title?: string;
  price?: number;
  old_price?: number;
  currency_code?: string;
  images?: {
    primary?: string;
  };
  [key: string]: unknown;
}

export interface PriceEditModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (_data: unknown[]) => void;
  selectedProduct?: Product | null;
  selectedRows?: Product[];
  loading?: boolean;
}

interface ProductPrice {
  offer_id: string;
  currentPrice: number;
  newPrice: number;
  oldPrice?: number;
}

export const PriceEditModal: React.FC<PriceEditModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  selectedProduct = null,
  selectedRows = [],
  loading = false,
}) => {
  const [form] = Form.useForm();
  const [productPrices, setProductPrices] = useState<Record<string, ProductPrice>>({});
  const [percentageChange, setPercentageChange] = useState<number | null>(null);
  const [reason, setReason] = useState<string>('');

  // 获取要编辑的商品列表
  const products = selectedProduct ? [selectedProduct] : selectedRows;

  // 初始化商品价格
  useEffect(() => {
    if (visible && products.length > 0) {
      const initialPrices: Record<string, ProductPrice> = {};
      products.forEach((product) => {
        const currentPrice = Number(product.price || 0);
        initialPrices[product.offer_id] = {
          offer_id: product.offer_id,
          currentPrice,
          newPrice: currentPrice,
          oldPrice: product.old_price ? Number(product.old_price) : undefined,
        };
      });
      setProductPrices(initialPrices);
      setPercentageChange(null);
      setReason('');
    }
  }, [visible, products]);

  // 获取货币符号
  const getCurrencyPrefix = () => {
    if (products.length > 0) {
      return getCurrencySymbol(products[0].currency_code);
    }
    return '¥';
  };

  // 应用百分比调价
  const applyPercentageChange = (percentage: number | null) => {
    if (percentage === null) return;

    const newPrices = { ...productPrices };
    Object.keys(newPrices).forEach((offerId) => {
      const { currentPrice } = newPrices[offerId];
      const newPrice = currentPrice * (1 + percentage / 100);
      newPrices[offerId].newPrice = Math.max(0, Number(newPrice.toFixed(2)));
    });
    setProductPrices(newPrices);
  };

  // 更新单个商品价格
  const updateProductPrice = (offerId: string, newPrice: number) => {
    setProductPrices((prev) => ({
      ...prev,
      [offerId]: {
        ...prev[offerId],
        newPrice,
      },
    }));
  };

  // 提交
  const handleSubmit = () => {
    const updates = Object.values(productPrices).map((priceData) => ({
      offer_id: priceData.offer_id,
      price: priceData.newPrice.toString(),
      old_price: priceData.oldPrice ? priceData.oldPrice.toString() : undefined,
      reason: reason || undefined,
    }));
    onSubmit(updates);
  };

  // 计算价格变化统计
  const getPriceChangeStats = () => {
    const stats = {
      increased: 0,
      decreased: 0,
      unchanged: 0,
    };
    Object.values(productPrices).forEach(({ currentPrice, newPrice }) => {
      if (newPrice > currentPrice) stats.increased++;
      else if (newPrice < currentPrice) stats.decreased++;
      else stats.unchanged++;
    });
    return stats;
  };

  const stats = getPriceChangeStats();

  return (
    <Modal
      title={selectedProduct ? `更新价格 - ${selectedProduct.offer_id}` : `批量更新价格 (${products.length} 个商品)`}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={900}
      style={{ top: 20 }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 批量百分比调价 */}
        {products.length > 1 && (
          <Alert
            message={
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ fontWeight: 500 }}>批量百分比调价</div>
                <Space>
                  <InputNumber
                    style={{ width: 200 }}
                    placeholder="输入百分比 (正数加价，负数降价)"
                    value={percentageChange}
                    onChange={setPercentageChange}
                    formatter={(value) => `${value}%`}
                    parser={(value) => value?.replace('%', '') as unknown as number}
                    step={5}
                  />
                  <Button
                    type="primary"
                    onClick={() => applyPercentageChange(percentageChange)}
                    disabled={percentageChange === null}
                  >
                    应用
                  </Button>
                  <span style={{ color: '#666', fontSize: 12 }}>
                    例如：输入 10 表示加价10%，输入 -10 表示降价10%
                  </span>
                </Space>
              </Space>
            }
            type="info"
          />
        )}

        {/* 价格变化统计 */}
        {products.length > 1 && (
          <div style={{ fontSize: 12, color: '#666' }}>
            涨价: <span style={{ color: '#f5222d' }}>{stats.increased}</span> 个 |
            降价: <span style={{ color: '#52c41a' }}>{stats.decreased}</span> 个 |
            不变: {stats.unchanged} 个
          </div>
        )}

        {/* 商品列表 */}
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <List
            dataSource={products}
            renderItem={(product) => {
              const priceData = productPrices[product.offer_id];
              if (!priceData) return null;

              const imageUrl = product.images?.primary
                ? optimizeOzonImageUrl(product.images.primary, 60)
                : '';

              const priceChange = priceData.newPrice - priceData.currentPrice;
              const priceChangePercent =
                priceData.currentPrice > 0
                  ? ((priceChange / priceData.currentPrice) * 100).toFixed(1)
                  : '0.0';

              return (
                <List.Item key={product.offer_id}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                    {/* 左侧：图片和商品信息 */}
                    <Space>
                      <Avatar
                        src={imageUrl}
                        size={60}
                        shape="square"
                        style={{ border: '1px solid #f0f0f0' }}
                      />
                      <div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            maxWidth: 300,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {product.title || product.offer_id}
                        </div>
                        <div style={{ fontSize: 12, color: '#999' }}>货号: {product.offer_id}</div>
                      </div>
                    </Space>

                    {/* 右侧：价格信息 */}
                    <Space size="large" align="center">
                      {/* 当前价格 */}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>当前价格</div>
                        <div style={{ fontSize: 16, fontWeight: 500 }}>
                          {getCurrencyPrefix()}{priceData.currentPrice.toFixed(2)}
                        </div>
                      </div>

                      {/* 箭头 */}
                      <div style={{ fontSize: 20, color: '#999' }}>→</div>

                      {/* 新价格 */}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>新价格</div>
                        <InputNumber
                          style={{ width: 140 }}
                          value={priceData.newPrice}
                          onChange={(value) => updateProductPrice(product.offer_id, value || 0)}
                          min={0}
                          formatter={getNumberFormatter(2)}
                          parser={getNumberParser()}
                          prefix={getCurrencyPrefix()}
                        />
                      </div>

                      {/* 价格变化 */}
                      <div style={{ textAlign: 'center', minWidth: 80 }}>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>变化</div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: priceChange > 0 ? '#f5222d' : priceChange < 0 ? '#52c41a' : '#999',
                          }}
                        >
                          {priceChange > 0 ? '+' : ''}
                          {priceChange.toFixed(2)}
                          <br />
                          <span style={{ fontSize: 12 }}>
                            ({priceChange > 0 ? '+' : ''}
                            {priceChangePercent}%)
                          </span>
                        </div>
                      </div>
                    </Space>
                  </Space>
                </List.Item>
              );
            }}
          />
        </div>

        {/* 调价原因（可选） */}
        <Form.Item label="调价原因（可选）" style={{ marginBottom: 0 }}>
          <Select
            placeholder="选择或输入调价原因"
            value={reason}
            onChange={setReason}
            allowClear
            showSearch
            mode="tags"
            maxCount={1}
            style={{ width: '100%' }}
            options={[
              { value: '促销活动', label: '促销活动' },
              { value: '成本调整', label: '成本调整' },
              { value: '市场竞争', label: '市场竞争' },
              { value: '库存清理', label: '库存清理' },
              { value: '季节调价', label: '季节调价' },
              { value: '汇率变化', label: '汇率变化' },
            ]}
          />
        </Form.Item>

        {/* 底部按钮 */}
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" onClick={handleSubmit} loading={loading}>
              确认更新 ({products.length} 个商品)
            </Button>
          </Space>
        </div>
      </Space>
    </Modal>
  );
};

export default PriceEditModal;
