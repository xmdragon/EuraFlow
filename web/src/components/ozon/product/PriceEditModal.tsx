/* eslint-disable no-unused-vars */
/**
 * 价格编辑模态框组件
 * 支持单个商品或批量商品的价格更新
 */
import { CopyOutlined } from '@ant-design/icons';
import { Modal, InputNumber, Input, Button, Space, Avatar, List, Form, Alert, Tooltip } from 'antd';
import React, { useState, useEffect } from 'react';

import { useCopy } from '@/hooks/useCopy';
import { useCurrency } from '@/hooks/useCurrency';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

export interface Product {
  offer_id: string;
  ozon_sku?: number;
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
  const [productPrices, setProductPrices] = useState<Record<string, ProductPrice>>({});
  const [percentageChange, setPercentageChange] = useState<number | null>(null);
  const [reason, setReason] = useState<string>('');
  const { copyToClipboard } = useCopy();
  const { symbol: currencySymbol } = useCurrency();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedProduct, selectedRows]);

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

  // 更新单个商品旧价格
  const updateProductOldPrice = (offerId: string, oldPrice: number | undefined) => {
    setProductPrices((prev) => ({
      ...prev,
      [offerId]: {
        ...prev[offerId],
        oldPrice,
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
      title={
        selectedProduct
          ? `更新价格 - ${selectedProduct.offer_id}`
          : `批量更新价格 (${products.length} 个商品)`
      }
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
                    onChange={(value) => setPercentageChange(typeof value === 'number' ? value : 0)}
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
            涨价: <span style={{ color: '#f5222d' }}>{stats.increased}</span> 个 | 降价:{' '}
            <span style={{ color: '#52c41a' }}>{stats.decreased}</span> 个 | 不变: {stats.unchanged}{' '}
            个
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
                ? optimizeOzonImageUrl(product.images.primary, 80)
                : '';
              const largeImageUrl = product.images?.primary
                ? optimizeOzonImageUrl(product.images.primary, 160)
                : '';

              const priceChange = priceData.newPrice - priceData.currentPrice;
              const priceChangePercent =
                priceData.currentPrice > 0
                  ? ((priceChange / priceData.currentPrice) * 100).toFixed(1)
                  : '0.0';

              return (
                <List.Item key={product.offer_id}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                    {/* 左侧：图片和SKU */}
                    <Space>
                      <Tooltip
                        title={
                          <img
                            src={largeImageUrl}
                            alt="商品大图"
                            style={{
                              width: 160,
                              height: 160,
                              display: 'block',
                            }}
                          />
                        }
                        placement="right"
                        overlayInnerStyle={{
                          backgroundColor: '#fff',
                          padding: 8,
                        }}
                      >
                        <Avatar
                          src={imageUrl}
                          size={80}
                          shape="square"
                          style={{
                            border: '1px solid #f0f0f0',
                            cursor: 'pointer',
                          }}
                        />
                      </Tooltip>
                      <div>
                        <Space>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>
                            SKU: {product.ozon_sku}
                          </span>
                          <CopyOutlined
                            style={{ color: '#1890ff', cursor: 'pointer' }}
                            onClick={() =>
                              product.ozon_sku && copyToClipboard(product.ozon_sku, 'SKU')
                            }
                          />
                        </Space>
                      </div>
                    </Space>

                    {/* 右侧：价格信息 */}
                    <Space size="large" align="center">
                      {/* 当前价格 */}
                      <div style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#999',
                            marginBottom: 4,
                          }}
                        >
                          当前价格
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 500 }}>
                          {currencySymbol}
                          {priceData.currentPrice.toFixed(2)}
                        </div>
                      </div>

                      {/* 箭头 */}
                      <div style={{ fontSize: 20, color: '#999' }}>→</div>

                      {/* 新价格 */}
                      <div style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#999',
                            marginBottom: 4,
                          }}
                        >
                          新价格
                        </div>
                        <InputNumber
                          style={{ width: 80 }}
                          value={priceData.newPrice}
                          onChange={(value) =>
                            updateProductPrice(
                              product.offer_id,
                              typeof value === 'number' ? value : 0
                            )
                          }
                          min={0}
                          formatter={getNumberFormatter(2)}
                          parser={getNumberParser()}
                          prefix={currencySymbol}
                        />
                      </div>

                      {/* 旧价格（划线价） */}
                      <div style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#999',
                            marginBottom: 4,
                          }}
                        >
                          旧价格（划线价）
                        </div>
                        <InputNumber
                          style={{ width: 80 }}
                          value={priceData.oldPrice}
                          onChange={(value) =>
                            updateProductOldPrice(
                              product.offer_id,
                              typeof value === 'number' ? value : undefined
                            )
                          }
                          min={0}
                          formatter={getNumberFormatter(2)}
                          parser={getNumberParser()}
                          prefix={currencySymbol}
                          placeholder="可选"
                        />
                      </div>

                      {/* 价格变化 */}
                      <div style={{ textAlign: 'center', minWidth: 80 }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#999',
                            marginBottom: 4,
                          }}
                        >
                          变化
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color:
                              priceChange > 0 ? '#f5222d' : priceChange < 0 ? '#52c41a' : '#999',
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
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="输入调价原因（可选）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              allowClear
              style={{ flex: 1 }}
            />
          </Space.Compact>
          <div style={{ marginTop: 8 }}>
            <Space wrap size="small">
              <span style={{ fontSize: 12, color: '#999' }}>快捷选择：</span>
              {['促销活动', '成本调整', '市场竞争', '库存清理', '季节调价', '汇率变化'].map(
                (text) => (
                  <Button
                    key={text}
                    size="small"
                    type={reason === text ? 'primary' : 'default'}
                    onClick={() => setReason(text)}
                  >
                    {text}
                  </Button>
                )
              )}
            </Space>
          </div>
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
