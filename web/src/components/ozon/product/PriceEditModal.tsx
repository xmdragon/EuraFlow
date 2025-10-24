/* eslint-disable no-unused-vars */
/**
 * 价格编辑模态框组件
 * 支持单个商品或批量商品的价格更新
 */
import { Modal, Form, InputNumber, Input, Button, Space } from 'antd';
import React from 'react';

import { getCurrencySymbol } from '@/utils/currency';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';

export interface Product {
  sku: string;
  currency_code?: string;
  [key: string]: any;
}

export interface PriceEditModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (_data: any[]) => void;
  selectedProduct?: Product | null;
  selectedRows?: Product[];
  loading?: boolean;
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

  const handleFinish = (values: any) => {
    const updates = selectedProduct
      ? [
          {
            sku: selectedProduct.sku,
            ...values,
          },
        ]
      : selectedRows.map((row) => ({
          sku: row.sku,
          ...values,
        }));
    onSubmit(updates);
  };

  // 获取货币符号
  const getCurrencyPrefix = () => {
    if (selectedProduct) {
      return getCurrencySymbol(selectedProduct.currency_code);
    }
    if (selectedRows.length > 0) {
      return getCurrencySymbol(selectedRows[0].currency_code);
    }
    return '¥';
  };

  return (
    <Modal
      title={selectedProduct ? `更新价格 - ${selectedProduct.sku}` : '批量更新价格'}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={600}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item name="price" label="售价" rules={[{ required: true, message: '请输入售价' }]}>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            formatter={getNumberFormatter(2)}
            parser={getNumberParser()}
            prefix={getCurrencyPrefix()}
            placeholder="请输入售价"
          />
        </Form.Item>
        <Form.Item name="old_price" label="原价">
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            formatter={getNumberFormatter(2)}
            parser={getNumberParser()}
            prefix={getCurrencyPrefix()}
            placeholder="可选，用于显示折扣"
          />
        </Form.Item>
        <Form.Item name="reason" label="调价原因">
          <Input.TextArea rows={2} placeholder="请输入调价原因" />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              确认更新
            </Button>
            <Button onClick={onCancel}>取消</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default PriceEditModal;
