 
/**
 * 库存编辑模态框组件
 * 支持单个商品或批量商品的库存更新
 */
import { Modal, Form, InputNumber, Select, Button, Space, Spin } from 'antd';
import React, { useEffect, useState, useCallback } from 'react';

import type { FormValues } from '@/types/common';
import * as ozonApi from '@/services/ozon';

const { Option } = Select;

export interface WarehouseStock {
  warehouse_id: number;
  present: number;
  reserved: number;
}

export interface Product {
  offer_id: string;
  warehouse_stocks?: WarehouseStock[];
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
  const [warehouses, setWarehouses] = useState<unknown[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);
  const [currentStock, setCurrentStock] = useState<number | null>(null);

  // 处理仓库变化
  const handleWarehouseChange = useCallback((warehouseId: number) => {
    // 仅在单个商品时显示原有库存
    if (selectedProduct && selectedProduct.warehouse_stocks) {
      const warehouseStock = selectedProduct.warehouse_stocks.find(
        (ws) => ws.warehouse_id === warehouseId
      );
      setCurrentStock(warehouseStock?.present ?? null);
    } else {
      setCurrentStock(null);
    }
  }, [selectedProduct]);

  // 加载仓库列表
  useEffect(() => {
    const loadWarehouses = async () => {
      if (!visible || !shopId) return;

      setLoadingWarehouses(true);
      try {
        const response = await ozonApi.getWarehouses(shopId);
        if (response.success && response.data) {
          setWarehouses(response.data);
          // 如果只有一个仓库，自动选中并显示库存
          if (response.data.length === 1) {
            const warehouseId = response.data[0].warehouse_id;
            form.setFieldsValue({ warehouse_id: warehouseId });
            handleWarehouseChange(warehouseId);
          }
        }
      } catch (error) {
        console.error('加载仓库列表失败:', error);
      } finally {
        setLoadingWarehouses(false);
      }
    };

    loadWarehouses();
  }, [visible, shopId, form, handleWarehouseChange]);

  const handleFinish = (values: FormValues) => {
    // 如果既没有选中单个商品，也没有选中批量商品，表示对全部商品操作
    if (!selectedProduct && selectedRows.length === 0) {
      onSubmit([
        {
          apply_to_all: true,
          ...values,
        },
      ] as unknown);
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
            name="warehouse_id"
            label="仓库"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select
              placeholder="选择仓库"
              loading={loadingWarehouses}
              onChange={handleWarehouseChange}
            >
              {warehouses.map((wh) => (
                <Option key={wh.warehouse_id} value={wh.warehouse_id}>
                  {wh.name} ({wh.is_rfbs ? 'rFBS' : 'FBS'})
                </Option>
              ))}
            </Select>
          </Form.Item>
          {selectedProduct && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ color: '#666' }}>
                原有库存：{currentStock ?? 0}
              </span>
            </div>
          )}
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
