/**
 * 国内物流单号弹窗组件（支持多单号）
 * 用于"已分配"状态，填写国内物流单号
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Form, Input, Select } from 'antd';
import axios from 'axios';
import React from 'react';

import * as ozonApi from '@/services/ozon';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

const { TextArea } = Input;

interface DomesticTrackingModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  onSuccess?: () => void; // 操作成功后的回调
  initialTrackingNumbers?: string[]; // 已有的国内单号列表
  initialOrderNotes?: string; // 已有的订单备注
}

const DomesticTrackingModal: React.FC<DomesticTrackingModalProps> = ({
  visible,
  onCancel,
  postingNumber,
  onSuccess,
  initialTrackingNumbers,
  initialOrderNotes,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 当 Modal 打开时，加载已有的国内单号和备注
  React.useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        domestic_tracking_numbers: initialTrackingNumbers || [],
        order_notes: initialOrderNotes || '',
      });
    }
  }, [visible, initialTrackingNumbers, initialOrderNotes, form]);

  // 提交国内物流单号 mutation（用于新增单号或有单号时提交）
  const submitTrackingMutation = useMutation({
    mutationFn: (data: ozonApi.SubmitDomesticTrackingRequest) => {
      return ozonApi.submitDomesticTracking(postingNumber, data);
    },
    onSuccess: () => {
      notifySuccess('国内单号已保存', '国内单号已成功保存');
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 刷新订单列表查询（确保切换标签页时数据正确）
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
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

  // 更新国内物流单号 mutation（用于修改或清空单号）
  const updateTrackingMutation = useMutation({
    mutationFn: (data: ozonApi.UpdateDomesticTrackingRequest) => {
      return ozonApi.updateDomesticTracking(postingNumber, data);
    },
    onSuccess: () => {
      notifySuccess('国内单号已更新', '国内单号已成功更新');
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 刷新订单列表查询（确保切换标签页时数据正确）
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      // 调用父组件回调（用于从列表中移除或更新）
      if (onSuccess) {
        onSuccess();
      }
      handleClose();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? (error.response?.data?.message || error.message || '更新失败')
        : (error instanceof Error ? error.message : '更新失败');
      notifyError('国内单号更新失败', errorMsg);
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

      // 判断是更新还是新增
      const hasInitialNumbers = initialTrackingNumbers && initialTrackingNumbers.length > 0;

      if (hasInitialNumbers) {
        // 已有单号，使用更新接口（支持清空）
        const updateData: ozonApi.UpdateDomesticTrackingRequest = {
          domestic_tracking_numbers: cleanedNumbers,
        };
        updateTrackingMutation.mutate(updateData);
      } else {
        // 没有单号，使用提交接口（不允许空）
        if (cleanedNumbers.length === 0) {
          notifyError('提交失败', '请至少输入一个国内物流单号');
          return;
        }

        const submitData: ozonApi.SubmitDomesticTrackingRequest = {
          domestic_tracking_numbers: cleanedNumbers,
          order_notes: values.order_notes,
        };
        submitTrackingMutation.mutate(submitData);
      }
    } catch (error) {
      logger.error('Form validation failed:', error);
    }
  };

  return (
    <Modal
      title={initialTrackingNumbers && initialTrackingNumbers.length > 0 ? "编辑国内物流单号" : "填写国内物流单号"}
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={submitTrackingMutation.isPending || updateTrackingMutation.isPending}
      okText="提交"
      cancelText="取消"
      width={600}
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          name="domestic_tracking_numbers"
          label="国内物流单号"
          rules={[
            {
              validator: (_, value) => {
                // 允许空数组（用于清空单号）
                if (!value || value.length === 0) {
                  return Promise.resolve();
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
          tooltip="支持输入多个国内物流单号（按回车或逗号分隔），清空所有单号可删除国内单号"
          extra={`已添加 ${form.getFieldValue('domestic_tracking_numbers')?.length || 0} 个单号${initialTrackingNumbers && initialTrackingNumbers.length > 0 ? '（清空后提交可删除所有单号）' : ''}`}
        >
          <Select
            mode="tags"
            placeholder="输入单号后按回车添加（支持多个，逗号/空格/换行分隔）"
            maxTagCount={10}
            tokenSeparators={[',', '\n', ' ', '，']} // 支持中英文逗号、换行、空格
            maxLength={200}
          />
        </Form.Item>

        {/* 只在新增模式下显示订单备注和同步选项 */}
        {(!initialTrackingNumbers || initialTrackingNumbers.length === 0) && (
          <>
            <Form.Item name="order_notes" label="订单备注" tooltip="订单相关的备注信息（可选）">
              <TextArea
                placeholder="请输入订单备注"
                autoSize={{ minRows: 3, maxRows: 6 }}
                maxLength={500}
                showCount
              />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default DomesticTrackingModal;
