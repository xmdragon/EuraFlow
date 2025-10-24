/**
 * 订单额外信息表单组件
 * 用于编辑订单的进货价格、物料成本、采购平台、国内物流单号和订单备注
 */
import { SendOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Form, Input, Select, Button, Space, Row, Col } from 'antd';
import React, { useEffect } from 'react';

import { useCurrency } from '@/hooks/useCurrency';
import * as ozonApi from '@/services/ozonApi';
import { getCurrencySymbol } from '@/utils/currency';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Option } = Select;

export interface ExtraInfoFormProps {
  /** 选中的订单 */
  selectedOrder: ozonApi.Order | null;
  /** 选中的货件 */
  selectedPosting: ozonApi.Posting | null;
  /** 设置更新加载状态 */
  setIsUpdatingExtraInfo: (loading: boolean) => void;
  /** 同步到跨境巴士的 mutation */
  syncToKuajing84Mutation: any;
  /** 是否有操作权限 */
  canOperate: boolean;
}

/**
 * 订单额外信息表单组件
 */
export const ExtraInfoForm: React.FC<ExtraInfoFormProps> = ({
  selectedOrder,
  selectedPosting,
  setIsUpdatingExtraInfo,
  syncToKuajing84Mutation,
  canOperate,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { symbol: userSymbol } = useCurrency();

  // 优先使用订单货币，否则使用用户设置
  const orderSymbol = getCurrencySymbol(selectedOrder?.currency_code) || userSymbol;

  // 当选中订单变化时，更新表单
  useEffect(() => {
    if (selectedOrder) {
      form.setFieldsValue({
        purchase_price: selectedOrder.purchase_price || '',
        // 使用新的数组字段的第一个值（如果存在）
        domestic_tracking_number: selectedPosting?.domestic_tracking_numbers?.[0] || '',
        material_cost: selectedOrder.material_cost || '',
        order_notes: selectedOrder.order_notes || '',
        source_platform: selectedOrder.source_platform || '',
      });
    } else {
      form.resetFields();
    }
  }, [selectedOrder, selectedPosting, form]);

  const handleFinish = async (values: any) => {
    try {
      setIsUpdatingExtraInfo(true);

      if (!selectedOrder?.posting_number) {
        throw new Error('订单号不存在');
      }

      // 调用API更新订单额外信息
      await ozonApi.updateOrderExtraInfo(selectedOrder.posting_number, values);

      notifySuccess('订单信息已更新', '订单额外信息更新成功');

      // 刷新列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('更新失败', '更新失败: ' + (error as Error).message);
    } finally {
      setIsUpdatingExtraInfo(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish}>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="purchase_price"
            label="进货价格"
            tooltip="商品的采购成本"
            rules={[
              {
                pattern: /^\d+(\.\d{1,2})?$/,
                message: '请输入有效的价格（最多2位小数）',
              },
            ]}
          >
            <Input placeholder="进货价格" prefix={orderSymbol} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="material_cost"
            label="物料成本"
            tooltip="包装、标签等物料成本"
            rules={[
              {
                pattern: /^\d+(\.\d{1,2})?$/,
                message: '请输入有效的价格（最多2位小数）',
              },
            ]}
          >
            <Input placeholder="物料成本" prefix={orderSymbol} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="source_platform" label="采购平台" tooltip="商品采购来源平台">
            <Select placeholder="请选择采购平台" allowClear>
              <Option value="1688">1688</Option>
              <Option value="拼多多">拼多多</Option>
              <Option value="咸鱼">咸鱼</Option>
              <Option value="淘宝">淘宝</Option>
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="domestic_tracking_number"
            label="国内物流单号"
            tooltip="国内物流配送的跟踪单号"
          >
            <Input placeholder="国内物流单号" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="order_notes" label="订单备注" tooltip="订单相关的备注信息">
        <Input.TextArea placeholder="订单备注" autoSize={{ minRows: 3, maxRows: 6 }} />
      </Form.Item>

      {canOperate && (
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              保存信息
            </Button>
            <Button
              type="default"
              icon={<SendOutlined />}
              loading={syncToKuajing84Mutation.isPending}
              onClick={async () => {
                try {
                  // 先保存表单
                  const values = await form.validateFields();
                  await handleFinish(values);

                  // 再同步到跨境巴士
                  if (!selectedOrder?.id) {
                    notifyError('同步失败', '订单ID不存在');
                    return;
                  }
                  if (!selectedPosting?.posting_number) {
                    notifyError('同步失败', '货件编号不存在');
                    return;
                  }
                  if (!values.domestic_tracking_number) {
                    notifyError('同步失败', '请先填写国内物流单号');
                    return;
                  }

                  syncToKuajing84Mutation.mutate({
                    ozonOrderId: selectedOrder.id,
                    postingNumber: selectedPosting.posting_number,
                    logisticsOrder: values.domestic_tracking_number,
                  });
                } catch (error) {
                  console.error('保存并同步失败:', error);
                }
              }}
            >
              保存并同步跨境巴士
            </Button>
            <Button onClick={() => form.resetFields()}>重置</Button>
          </Space>
        </Form.Item>
      )}
    </Form>
  );
};

export default ExtraInfoForm;
