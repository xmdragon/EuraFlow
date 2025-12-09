/**
 * 废弃订单确认弹窗组件
 * 用于废弃订单时进行二次确认
 */
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Alert, Space } from 'antd';
import axios from 'axios';
import React from 'react';

import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError } from '@/utils/notification';

interface DiscardOrderModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  onSuccess?: () => void; // 操作成功后的回调
}

const DiscardOrderModal: React.FC<DiscardOrderModalProps> = ({
  visible,
  onCancel,
  postingNumber,
  onSuccess,
}) => {
  const queryClient = useQueryClient();

  // 废弃订单 mutation
  const discardOrderMutation = useMutation({
    mutationFn: () => {
      return ozonApi.discardOrder(postingNumber, {});
    },
    onSuccess: () => {
      notifySuccess('订单已废弃', '订单已成功废弃');
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
      // 调用父组件回调（用于从列表中移除）
      if (onSuccess) {
        onSuccess();
      }
      // 关闭弹窗
      onCancel();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? (error.response?.data?.message || error.message || '废弃失败')
        : (error instanceof Error ? error.message : '废弃失败');
      notifyError('废弃订单失败', errorMsg);
    },
  });

  const handleSubmit = () => {
    discardOrderMutation.mutate();
  };

  return (
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          <span>确认废弃订单</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={discardOrderMutation.isPending}
      okText="确认废弃"
      okType="danger"
      cancelText="取消"
      width={500}
    >
      <Alert
        message="警告"
        description={
          <div>
            <p style={{ marginBottom: 8 }}>货件号: <strong>{postingNumber}</strong></p>
            <p style={{ marginBottom: 0 }}>废弃后订单将无法恢复，请确认是否继续操作。</p>
          </div>
        }
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
    </Modal>
  );
};

export default DiscardOrderModal;
