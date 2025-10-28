/**
 * 国内物流单号弹窗组件（支持多单号）
 * 用于"已分配"状态，填写国内物流单号并同步到跨境巴士
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Form, Input, message, Select, Checkbox } from 'antd';
import axios from 'axios';
import React from 'react';

import * as ozonApi from '@/services/ozonApi';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

const { TextArea } = Input;

interface DomesticTrackingModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  onSuccess?: () => void; // 操作成功后的回调
}

const DomesticTrackingModal: React.FC<DomesticTrackingModalProps> = ({
  visible,
  onCancel,
  postingNumber,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 提交国内物流单号 mutation
  const submitTrackingMutation = useMutation({
    mutationFn: (data: ozonApi.SubmitDomesticTrackingRequest) => {
      return ozonApi.submitDomesticTracking(postingNumber, data);
    },
    onSuccess: (response, variables) => {
      // 提交成功，根据是否同步到跨境巴士显示不同提示
      if (variables.sync_to_kuajing84) {
        notifySuccess('国内单号已保存', '正在后台同步到跨境巴士，稍后将收到通知');
      } else {
        notifySuccess('国内单号已保存', '国内单号已成功保存');
      }
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 调用父组件回调（用于从列表中移除）
      if (onSuccess) {
        onSuccess();
      }
      // 立即关闭弹窗，等待 WebSocket 推送结果通知
      handleClose();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? (error.response?.data?.message || error.message || '提交失败')
        : (error instanceof Error ? error.message : '提交失败');
      notifyError('国内单号提交失败', errorMsg);
    },
  });

  const handleClose = () => {
    form.resetFields();
    onCancel();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      // 获取单号列表并清理
      const trackingNumbers = values.domestic_tracking_numbers || [];
      const cleanedNumbers = trackingNumbers
        .map((n: string) => n.trim())
        .filter((n: string) => n.length > 0);

      if (cleanedNumbers.length === 0) {
        message.error('请至少输入一个国内物流单号');
        return;
      }

      const data: ozonApi.SubmitDomesticTrackingRequest = {
        domestic_tracking_numbers: cleanedNumbers,
        order_notes: values.order_notes,
        sync_to_kuajing84: values.sync_to_kuajing84 === true, // 默认为false
      };
      submitTrackingMutation.mutate(data);
    } catch (error) {
      logger.error('Form validation failed:', error);
    }
  };

  return (
    <Modal
      title="填写国内物流单号"
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={submitTrackingMutation.isPending}
      okText="提交"
      cancelText="取消"
      width={600}
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          name="domestic_tracking_numbers"
          label="国内物流单号"
          rules={[
            { required: true, message: '请至少输入一个国内物流单号' },
            {
              validator: (_, value) => {
                if (!value || value.length === 0) {
                  return Promise.reject('请至少输入一个国内物流单号');
                }
                if (value.length > 10) {
                  return Promise.reject('最多支持10个单号');
                }
                // 检查每个单号的长度
                const invalidNumbers = value.filter((n: string) => n.trim().length < 5);
                if (invalidNumbers.length > 0) {
                  return Promise.reject('单号长度至少5个字符');
                }
                return Promise.resolve();
              },
            },
          ]}
          tooltip="支持输入多个国内物流单号（按回车或逗号分隔）"
          extra={`已添加 ${form.getFieldValue('domestic_tracking_numbers')?.length || 0} 个单号`}
        >
          <Select
            mode="tags"
            placeholder="输入单号后按回车添加（支持多个，逗号/空格/换行分隔）"
            maxTagCount={10}
            tokenSeparators={[',', '\n', ' ', '，']} // 支持中英文逗号、换行、空格
            maxLength={200}
          />
        </Form.Item>

        <Form.Item name="order_notes" label="订单备注" tooltip="订单相关的备注信息（可选）">
          <TextArea
            placeholder="请输入订单备注"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={500}
            showCount
          />
        </Form.Item>

        <Form.Item name="sync_to_kuajing84" valuePropName="checked" initialValue={false}>
          <Checkbox>同步到跨境巴士</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default DomesticTrackingModal;
