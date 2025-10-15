/**
 * 国内物流单号弹窗组件
 * 用于"已分配"状态，填写国内物流单号并同步到跨境巴士
 */
import React from 'react';
import { Modal, Form, Input, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ozonApi from '@/services/ozonApi';

const { TextArea } = Input;

interface DomesticTrackingModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
}

const DomesticTrackingModal: React.FC<DomesticTrackingModalProps> = ({
  visible,
  onCancel,
  postingNumber,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 提交国内物流单号 mutation
  const submitTrackingMutation = useMutation({
    mutationFn: (data: ozonApi.SubmitDomesticTrackingRequest) => {
      return ozonApi.submitDomesticTracking(postingNumber, data);
    },
    onSuccess: (response) => {
      // 检查跨境巴士同步结果
      const syncResult = response.data?.kuajing84_sync;
      if (syncResult && !syncResult.success) {
        message.warning(`国内单号提交成功，但跨境巴士同步失败：${syncResult.message}`);
      } else {
        message.success('国内单号提交成功' + (syncResult?.success ? '，已同步到跨境巴士' : ''));
      }
      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      // 关闭弹窗并重置表单
      handleClose();
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || error.message || '提交失败';
      message.error(errorMsg);
    },
  });

  const handleClose = () => {
    form.resetFields();
    onCancel();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const data: ozonApi.SubmitDomesticTrackingRequest = {
        domestic_tracking_number: values.domestic_tracking_number.trim(),
        order_notes: values.order_notes,
      };
      submitTrackingMutation.mutate(data);
    } catch (error) {
      console.error('Form validation failed:', error);
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
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
      >
        <Form.Item
          name="domestic_tracking_number"
          label="国内物流单号"
          rules={[
            { required: true, message: '请输入国内物流单号' },
            { whitespace: true, message: '单号不能为空格' },
            { min: 5, message: '单号长度至少5个字符' },
          ]}
          tooltip="国内物流配送的跟踪单号"
        >
          <Input
            placeholder="请输入国内物流单号"
            maxLength={100}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="order_notes"
          label="订单备注"
          tooltip="订单相关的备注信息（可选）"
        >
          <TextArea
            placeholder="请输入订单备注"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>

      <div style={{ marginTop: 16, padding: 12, background: '#f0f2f5', borderRadius: 4 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(0, 0, 0, 0.65)' }}>
          <strong>说明：</strong>提交国内单号将同步到跨境巴士，并将操作状态更新为"单号确认"。
        </p>
      </div>
    </Modal>
  );
};

export default DomesticTrackingModal;
