/**
 * 备货弹窗组件
 * 用于填写进货价格、采购平台和订单备注
 */
import React from 'react';
import { Modal, Form, Input, Select, InputNumber } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ozonApi from '@/services/ozonApi';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Option } = Select;
const { TextArea } = Input;

interface PrepareStockModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  posting?: any; // 传入完整的posting对象，用于加载原有值
  onSuccess?: () => void; // 操作成功后的回调
}

const PrepareStockModal: React.FC<PrepareStockModalProps> = ({
  visible,
  onCancel,
  postingNumber,
  posting,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 当弹窗打开时，如果有原有数据，加载到表单
  React.useEffect(() => {
    if (visible && posting) {
      form.setFieldsValue({
        purchase_price: posting.purchase_price ? parseFloat(posting.purchase_price) : undefined,
        source_platform: posting.source_platform || undefined,
        order_notes: posting.order_notes || undefined,
      });
    }
  }, [visible, posting, form]);

  // 备货操作 mutation
  const prepareStockMutation = useMutation({
    mutationFn: (data: ozonApi.PrepareStockRequest) => {
      return ozonApi.prepareStock(postingNumber, data);
    },
    onSuccess: (response) => {
      notifySuccess('操作成功', '备货操作成功');
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 调用父组件回调（用于从列表中移除）
      if (onSuccess) {
        onSuccess();
      }
      // 关闭弹窗并重置表单
      handleClose();
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.message || error.message || '备货操作失败';
      notifyError('操作失败', errorMsg);
    },
  });

  const handleClose = () => {
    form.resetFields();
    onCancel();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 将 purchase_price 转换为字符串（Decimal 类型）
      const data: ozonApi.PrepareStockRequest = {
        purchase_price: String(values.purchase_price),
        source_platform: values.source_platform,
        order_notes: values.order_notes,
      };
      prepareStockMutation.mutate(data);
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  return (
    <Modal
      title="备货操作"
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={prepareStockMutation.isPending}
      okText="确认备货"
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
            { required: true, message: '请输入进货价格' },
            { type: 'number', min: 0, message: '价格必须大于0' },
          ]}
          tooltip="商品的采购成本"
        >
          <InputNumber
            placeholder="请输入进货价格"
            precision={2}
            min={0}
            style={{ width: '100%' }}
            addonBefore="¥"
            controls={false}
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
          <strong>说明：</strong>备货操作将保存业务信息并调用 OZON exemplar set API，操作成功后状态将变更为"分配中"。
        </p>
      </div>
    </Modal>
  );
};

export default PrepareStockModal;
