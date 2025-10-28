/**
 * 废弃订单确认弹窗组件
 * 用于废弃订单时确认是否同步到跨境巴士
 */
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Form, Checkbox, Alert, Space } from 'antd';
import axios from 'axios';
import React from 'react';

import * as ozonApi from '@/services/ozonApi';
import { logger } from '@/utils/logger';
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
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 废弃订单 mutation
  const discardOrderMutation = useMutation({
    mutationFn: (data: ozonApi.DiscardOrderRequest) => {
      return ozonApi.discardOrder(postingNumber, data);
    },
    onSuccess: (response, variables) => {
      // 提交成功，根据是否同步到跨境巴士显示不同提示
      if (variables.sync_to_kuajing84) {
        notifySuccess('废弃请求已提交', '正在后台同步到跨境巴士，稍后将收到通知');
      } else {
        notifySuccess('订单已废弃', '订单已废弃（未同步到跨境巴士）');
      }
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
      // 调用父组件回调（用于从列表中移除）
      if (onSuccess) {
        onSuccess();
      }
      // 关闭弹窗
      handleClose();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? (error.response?.data?.message || error.message || '废弃失败')
        : (error instanceof Error ? error.message : '废弃失败');
      notifyError('废弃订单失败', errorMsg);
    },
  });

  const handleClose = () => {
    form.resetFields();
    onCancel();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      const data: ozonApi.DiscardOrderRequest = {
        sync_to_kuajing84: values.sync_to_kuajing84 === true, // 默认为false
      };
      discardOrderMutation.mutate(data);
    } catch (error) {
      logger.error('Form validation failed:', error);
    }
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
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={discardOrderMutation.isPending}
      okText="确认废弃"
      okType="danger"
      cancelText="取消"
      width={500}
    >
      <Form form={form} layout="vertical" autoComplete="off">
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

        <Form.Item
          name="sync_to_kuajing84"
          valuePropName="checked"
          initialValue={false}
        >
          <Checkbox>同步到跨境巴士</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default DiscardOrderModal;
