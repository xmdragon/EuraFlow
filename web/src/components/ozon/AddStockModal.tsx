/**
 * 添加库存弹窗
 * 两步流程：1. 输入SKU查询商品 2. 填写库存数量
 */
import { SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Alert,
  Card,
  Typography,
  Spin,
} from 'antd';
import React, { useState } from 'react';

import { useCurrency } from '@/hooks/useCurrency';
import * as ozonApi from '@/services/ozonApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;

interface AddStockModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddStockModal: React.FC<AddStockModalProps> = ({ visible, onClose, onSuccess }) => {
  const [form] = Form.useForm();
  const { symbol: currencySymbol } = useCurrency();

  // 状态管理
  const [step, setStep] = useState<'search' | 'input'>('search');
  const [skuInput, setSkuInput] = useState('');
  const [product, setProduct] = useState<ozonApi.Product | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matchedShopId, setMatchedShopId] = useState<number | null>(null);

  // 查询商品（全店铺搜索）
  const handleSearchProduct = async () => {
    if (!skuInput.trim()) {
      notifyError('请输入SKU', '请输入商品SKU后查询');
      return;
    }

    setSearching(true);
    setSearchError(null);

    try {
      // 全店铺搜索商品
      const response = await ozonApi.getProducts(1, 50, {
        search: skuInput,
      });

      // 查找匹配的商品（精确匹配 offer_id 或 sku，统一转为字符串比较）
      const searchSku = skuInput.trim();
      const products = response.data || [];

      loggers.stock.info(`SKU搜索结果: 输入="${searchSku}", 返回${products.length}个商品`);

      if (products.length > 0) {
        loggers.stock.debug('返回的商品列表:', products.map((p: ozonApi.Product) => ({
          offer_id: p.offer_id,
          sku: p.sku,
          ozon_sku: p.ozon_sku,
          title: p.title
        })));
      }

      // 只匹配 ozon_sku 字段
      const matchedProduct = products.find(
        (p: ozonApi.Product) => p.ozon_sku && String(p.ozon_sku) === searchSku
      );

      if (!matchedProduct && products.length > 0) {
        loggers.stock.warn('未找到精确匹配！', {
          searchSku,
          firstProduct: {
            offer_id: products[0].offer_id,
            sku: products[0].sku,
            ozon_sku: products[0].ozon_sku,
            offer_id_string: String(products[0].offer_id),
            sku_string: products[0].sku ? String(products[0].sku) : null,
            ozon_sku_string: products[0].ozon_sku ? String(products[0].ozon_sku) : null
          }
        });
      }

      if (matchedProduct) {
        setProduct(matchedProduct);
        setMatchedShopId(matchedProduct.shop_id);
        setStep('input');
        form.setFieldsValue({
          shop_id: matchedProduct.shop_id,
          sku: searchSku,  // 传用户输入的 SKU（ozon_sku）
        });
      } else {
        setSearchError('所有店铺没有该商品，请核对SKU');
        setProduct(null);
        setMatchedShopId(null);
      }
    } catch (error: any) {
      loggers.stock.error('查询商品失败', error);
      setSearchError(error?.response?.data?.detail || '查询商品失败，请稍后重试');
      setProduct(null);
      setMatchedShopId(null);
    } finally {
      setSearching(false);
    }
  };

  // 添加库存 Mutation
  const addMutation = useMutation({
    mutationFn: (data: ozonApi.AddStockRequest) => ozonApi.addStock(data),
    onSuccess: () => {
      notifySuccess('添加成功', '库存已添加');
      handleClose();
      onSuccess();
    },
    onError: (error: any) => {
      loggers.stock.error('添加库存失败', error);
      notifyError('添加失败', error?.response?.data?.detail || '请稍后重试');
    },
  });

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      addMutation.mutate(values);
    } catch (error) {
      loggers.stock.error('表单验证失败', error);
    }
  };

  // 关闭弹窗（重置状态）
  const handleClose = () => {
    setStep('search');
    setSkuInput('');
    setProduct(null);
    setMatchedShopId(null);
    setSearchError(null);
    form.resetFields();
    onClose();
  };

  // 返回第一步
  const handleBack = () => {
    setStep('search');
    setProduct(null);
    setMatchedShopId(null);
    setSearchError(null);
  };

  return (
    <Modal
      title="添加库存"
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      {/* 第一步：查询商品 */}
      {step === 'search' && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* SKU 输入 */}
          <div>
            <Text strong>输入商品SKU（全店铺搜索）</Text>
            <Space.Compact style={{ width: '100%', marginTop: 8 }}>
              <Input
                placeholder="请输入商品SKU"
                value={skuInput}
                onChange={(e) => setSkuInput(e.target.value)}
                onPressEnter={handleSearchProduct}
              />
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleSearchProduct}
                loading={searching}
              >
                查询
              </Button>
            </Space.Compact>
          </div>

          {/* 查询错误提示 */}
          {searchError && (
            <Alert message={searchError} type="error" showIcon closable onClose={() => setSearchError(null)} />
          )}

          {/* 查询中 */}
          {searching && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Spin tip="查询商品中..." />
            </div>
          )}
        </Space>
      )}

      {/* 第二步：填写库存信息 */}
      {step === 'input' && product && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 商品信息卡片 */}
          <Card size="small">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 16 }}>
                {/* 商品图片 */}
                {product.images?.primary ? (
                  <img
                    src={product.images.primary}
                    alt={product.title}
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: 'cover',
                      borderRadius: 4,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      background: '#f0f0f0',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    无图片
                  </div>
                )}

                {/* 商品信息 */}
                <div style={{ flex: 1 }}>
                  <Text strong>{product.title_cn || product.title}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    SKU: {product.ozon_sku}
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    价格: {currencySymbol}
                    {product.price ? parseFloat(product.price).toFixed(2) : '0.00'}
                  </Text>
                </div>
              </div>
            </Space>
          </Card>

          {/* 库存表单 */}
          <Form form={form} layout="vertical">
            <Form.Item name="shop_id" hidden>
              <Input />
            </Form.Item>

            <Form.Item name="sku" hidden>
              <Input />
            </Form.Item>

            <Form.Item
              label="库存数量"
              name="quantity"
              rules={[
                { required: true, message: '请输入库存数量' },
                { type: 'number', min: 1, message: '库存数量必须大于0' },
              ]}
            >
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                placeholder="请输入库存数量"
                autoFocus
              />
            </Form.Item>

            <Form.Item label="备注" name="notes">
              <Input.TextArea
                placeholder="可选，填写备注信息"
                rows={3}
                maxLength={500}
                showCount
              />
            </Form.Item>
          </Form>

          {/* 操作按钮 */}
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={handleBack}>返回</Button>
            <Button type="primary" onClick={handleSubmit} loading={addMutation.isPending}>
              保存
            </Button>
          </Space>
        </Space>
      )}
    </Modal>
  );
};

export default AddStockModal;
