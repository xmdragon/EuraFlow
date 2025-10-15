/**
 * 更新业务信息弹窗组件
 * 用于"分配中"状态，允许编辑进货价格、采购平台和订单备注
 */
import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ozonApi from '@/services/ozonApi';

const { Option } = Select;
const { TextArea } = Input;

interface UpdateBusinessInfoModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  currentData?: {
    purchase_price?: string;
    source_platform?: string;
    order_notes?: string;
  };
}

const UpdateBusinessInfoModal: React.FC<UpdateBusinessInfoModalProps> = ({
  visible,
  onCancel,
  postingNumber,
  currentData,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 当弹窗打开或数据变化时，设置表单初始值
  useEffect(() => {
    if (visible && currentData) {
      form.setFieldsValue({
        purchase_price: currentData.purchase_price ? Number(currentData.purchase_price) : undefined,
        source_platform: currentData.source_platform,
        order_notes: currentData.order_notes,
      });
    }
  }, [visible, currentData, form]);

  // 更新业务信息 mutation
  const updateBusinessInfoMutation = useMutation({
    mutationFn: (data: ozonApi.UpdateBusinessInfoRequest) => {
      return ozonApi.updatePostingBusinessInfo(postingNumber, data);
    },
    onSuccess: (response) => {
      message.success('业务信息更新成功');
      // 刷新订单列表
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      // 关闭弹窗并重置表单
      handleClose();
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || error.message || '更新失败';
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
      // 构造请求数据，所有字段都是可选的
      const data: ozonApi.UpdateBusinessInfoRequest = {
        purchase_price: values.purchase_price !== undefined ? String(values.purchase_price) : undefined,
        source_platform: values.source_platform,
        order_notes: values.order_notes,
      };
      updateBusinessInfoMutation.mutate(data);
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  return (
    <Modal
      title="更新业务信息"
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={updateBusinessInfoMutation.isPending}
      okText="保存"
      cancelText="取消"
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
      >
        <Form.Item
          name="purchase_price"
          label="进货价格"
          rules={[
            { type: 'number', min: 0, message: '价格必须大于0' },
          ]}
          tooltip="商品的采购成本（可选）"
        >
          <InputNumber
            placeholder="请输入进货价格"
            precision={2}
            min={0}
            style={{ width: '100%' }}
            addonBefore="¥"
          />
        </Form.Item>

        <Form.Item
          name="source_platform"
          label="采购平台"
          tooltip="商品采购来源平台（可选）"
        >
          <Select placeholder="请选择采购平台" allowClear>
            <Option value="1688">1688</Option>
            <Option value="拼多多">拼多多</Option>
            <Option value="咸鱼">咸鱼</Option>
            <Option value="淘宝">淘宝</Option>
          </Select>
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
          <strong>说明：</strong>更新业务信息不会改变操作状态，仅修改订单的业务字段。
        </p>
      </div>
    </Modal>
  );
};

export default UpdateBusinessInfoModal;
