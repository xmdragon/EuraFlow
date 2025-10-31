/* eslint-disable no-unused-vars */
/**
 * 库存编辑模态框组件
 * 支持单个商品或批量商品的库存更新
 */
import { Modal, Form, InputNumber, Select, Button, Space, Spin } from 'antd';
import React, { useEffect, useState } from 'react';

import type { FormValues } from '@/types/common';
import * as ozonApi from '@/services/ozonApi';

const { Option } = Select;

export interface Product {
  offer_id: string;
  [key: string]: unknown;
}

export interface StockEditModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (_data: unknown[]) => void;
  selectedProduct?: Product | null;
  selectedRows?: Product[];
  loading?: boolean;
  shopId: number | null;
}

export const StockEditModal: React.FC<StockEditModalProps> = ({
  visible,
  onCancel,
  onSubmit,
  selectedProduct = null,
  selectedRows = [],
  loading = false,
  shopId,
}) => {
  const [form] = Form.useForm();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);

  // 加载仓库列表
  useEffect(() => {
    const loadWarehouses = async () => {
      if (!visible || !shopId) return;

      setLoadingWarehouses(true);
      try {
        const response = await ozonApi.getWarehouses(shopId);
        if (response.success && response.data) {
          setWarehouses(response.data);
          // 如果只有一个仓库，自动选中
          if (response.data.length === 1) {
            form.setFieldsValue({ warehouse_id: response.data[0].warehouse_id });
          }
        }
      } catch (error) {
        console.error('加载仓库列表失败:', error);
      } finally {
        setLoadingWarehouses(false);
      }
    };

    loadWarehouses();
  }, [visible, shopId, form]);

  const handleFinish = (values: FormValues) => {
    // 如果既没有选中单个商品，也没有选中批量商品，表示对全部商品操作
    if (!selectedProduct && selectedRows.length === 0) {
      onSubmit([
        {
          apply_to_all: true,
          ...values,
        },
      ] as any);
      return;
    }

    const updates = selectedProduct
      ? [
          {
            offer_id: selectedProduct.offer_id,
            ...values,
          },
        ]
      : selectedRows.map((row) => ({
          offer_id: row.offer_id,
          ...values,
        }));
    onSubmit(updates);
  };

  return (
    <Modal
      title={selectedProduct ? `更新库存 - ${selectedProduct.offer_id}` : '批量更新库存'}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={500}
    >
      <Spin spinning={loadingWarehouses}>
        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.Item
            name="stock"
            label="库存数量"
            rules={[
              { required: true, message: '请输入库存数量' },
              {
                validator: (_, value) => {
                  if (value === undefined || value === null) {
                    return Promise.reject(new Error('请输入库存数量'));
                  }
                  if (value < 0) {
                    return Promise.reject(new Error('库存数量不能为负数'));
                  }
                  // 明确允许0值
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} min={0} placeholder="请输入库存数量（可以为0）" />
          </Form.Item>
          <Form.Item
            name="warehouse_id"
            label="仓库"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select placeholder="选择仓库" loading={loadingWarehouses}>
              {warehouses.map((wh) => (
                <Option key={wh.warehouse_id} value={wh.warehouse_id}>
                  {wh.name} ({wh.is_rfbs ? 'rFBS' : 'FBS'})
                </Option>
              ))}
            </Select>
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
      </Spin>
    </Modal>
  );
};

export default StockEditModal;
