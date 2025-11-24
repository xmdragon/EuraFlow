/**
 * 发货弹窗组件
 * 填写物流信息并确认发货
 */
import React from 'react';
import { Modal, Form, Input, Select, Alert, Button, Space } from 'antd';
import type { FormInstance } from 'antd';

import styles from '../../../pages/ozon/PackingShipment.module.scss';

const { Option } = Select;

interface ShipOrderModalProps {
  visible: boolean;
  form: FormInstance;
  order: unknown | null;
  posting: unknown | null;
  onClose: () => void;
  onSubmit: (values: { tracking_number: string; carrier_code: string }) => void;
  loading: boolean;
}

const ShipOrderModal: React.FC<ShipOrderModalProps> = ({
  visible,
  form,
  order,
  posting,
  onClose,
  onSubmit,
  loading,
}) => {
  const handleClose = () => {
    onClose();
    form.resetFields();
  };

  return (
    <Modal
      title={`发货 - ${order?.order_id}`}
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={600}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Alert
          message="发货信息"
          description={`Posting号: ${posting?.posting_number}`}
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
            <Button onClick={handleClose}>取消</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ShipOrderModal;
