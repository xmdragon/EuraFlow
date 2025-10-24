/**
 * 库存编辑模态框组件
 * 支持单个商品或批量商品的库存更新
 */
import { Modal, Form, InputNumber, Select, Button, Space } from 'antd';
import React from 'react';

const { Option } = Select;

export interface Product {
  sku: string;
  [key: string]: any;
}

export interface StockEditModalProps {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (_data: any[]) => void;
  selectedProduct?: Product | null;
  selectedRows?: Product[];
  loading?: boolean;
}

export const StockEditModal: React.FC<StockEditModalProps> = ({
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

  return (
    <Modal
      title={selectedProduct ? `更新库存 - ${selectedProduct.sku}` : '批量更新库存'}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={500}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          name="stock"
          label="库存数量"
          rules={[{ required: true, message: '请输入库存数量' }]}
        >
          <InputNumber style={{ width: '100%' }} min={0} placeholder="请输入库存数量" />
        </Form.Item>
        <Form.Item name="warehouse_id" label="仓库">
          <Select placeholder="选择仓库">
            <Option value={1}>主仓库</Option>
            <Option value={2}>备用仓库</Option>
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
    </Modal>
  );
};

export default StockEditModal;
