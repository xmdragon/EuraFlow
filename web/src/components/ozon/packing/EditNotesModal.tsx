/**
 * 编辑订单备注弹窗组件
 */
import React from 'react';
import { Modal, Form, Input } from 'antd';

interface EditNotesModalProps {
  visible: boolean;
  posting: unknown | null;
  onClose: () => void;
  onSave: () => Promise<void>;
  loading: boolean;
  onNotesChange: (notes: string) => void;
}

const EditNotesModal: React.FC<EditNotesModalProps> = ({
  visible,
  posting,
  onClose,
  onSave,
  loading,
  onNotesChange,
}) => {
  if (!posting) return null;

  return (
    <Modal
      title={`编辑备注 - ${posting.posting_number}`}
      open={visible}
      onCancel={onClose}
      onOk={onSave}
      confirmLoading={loading}
      okText="保存"
      cancelText="取消"
      width={600}
    >
      <Form layout="vertical">
        <Form.Item label="订单备注">
          <Input.TextArea
            value={posting.order_notes || ''}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="请输入订单备注"
            autoSize={{ minRows: 4, maxRows: 10 }}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EditNotesModal;
