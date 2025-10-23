/**
 * 订单发货Modal
 * 用于填写物流单号和选择物流公司
 */
import React from 'react';
import { Modal, Form, Input, Select, Button, Space, Alert, FormInstance } from 'antd';
import * as ozonApi from '@/services/ozonApi';
import styles from '../../../pages/ozon/OrderList.module.scss';

const { Option } = Select;

export interface ShipModalProps {
  /** Modal是否可见 */
  visible: boolean;
  /** Form实例 */
  form: FormInstance;
  /** 选中的订单 */
  selectedOrder: ozonApi.Order | null;
  /** 选中的货件 */
  selectedPosting: ozonApi.Posting | null;
  /** 发货loading状态 */
  loading: boolean;
  /** 发货提交回调 */
  onSubmit: (values: { tracking_number: string; carrier_code: string }) => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 订单发货Modal
 */
export const ShipModal: React.FC<ShipModalProps> = ({
  visible,
  form,
  selectedOrder,
  selectedPosting,
  loading,
  onSubmit,
  onCancel,
}) => {
  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={`发货 - ${selectedOrder?.order_id}`}
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
      >
        <Alert
          message="发货信息"
          description={`Posting号: ${selectedPosting?.posting_number}`}
          type="info"
          className={styles.alertMargin}
        />

        <Form.Item
          name="tracking_number"
          label="物流单号"
          rules={[{ required: true, message: '请输入物流单号' }]}
        >
          <Input placeholder="请输入物流单号" />
        </Form.Item>

        <Form.Item
          name="carrier_code"
          label="物流公司"
          rules={[{ required: true, message: '请选择物流公司' }]}
        >
          <Select placeholder="请选择物流公司">
            <Option value="CDEK">CDEK</Option>
            <Option value="BOXBERRY">Boxberry</Option>
            <Option value="POCHTA">俄罗斯邮政</Option>
            <Option value="DPD">DPD</Option>
            <Option value="OZON">Ozon物流</Option>
          </Select>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              确认发货
            </Button>
            <Button onClick={handleCancel}>取消</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ShipModal;
