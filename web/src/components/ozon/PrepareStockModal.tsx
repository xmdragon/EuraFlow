/**
 * 备货弹窗组件（集成库存功能）
 * 用于填写采购平台、进货价格和订单备注
 * 支持使用库存备货
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Form, Input, Select, InputNumber, Checkbox, Alert, Space, Card, Typography, Spin, Row, Col } from 'antd';
import axios from 'axios';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

const { Option } = Select;
const { TextArea } = Input;
const { Text } = Typography;

interface PrepareStockModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  posting?: ozonApi.Posting; // 传入完整的posting对象，用于加载原有值
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
  const [useStock, setUseStock] = useState(false); // 是否使用库存

  // 查询订单商品的库存情况
  const { data: stockCheckData, isLoading: stockLoading } = useQuery({
    queryKey: ['stockCheck', postingNumber],
    queryFn: () => ozonApi.checkStockForPosting(postingNumber),
    enabled: visible, // 仅在弹窗打开时查询
    staleTime: 30000, // 30秒缓存
  });

  // 判断是否有库存
  const hasStock = stockCheckData && stockCheckData.items && stockCheckData.items.length > 0;
  const stockItems = stockCheckData?.items || [];

  // 判断库存是否充足（所有商品库存都充足）
  const allStockSufficient = stockItems.every((item) => item.is_sufficient);

  // 当弹窗打开时，如果有原有数据，加载到表单
  useEffect(() => {
    if (visible && posting) {
      form.setFieldsValue({
        // 兼容旧数据（字符串）和新数据（数组）
        source_platform: Array.isArray(posting.source_platform)
          ? posting.source_platform
          : posting.source_platform
            ? [posting.source_platform]
            : undefined,
        purchase_price: posting.purchase_price ? parseFloat(posting.purchase_price) : undefined,
        order_notes: posting.order_notes || undefined,
        sync_to_ozon: true, // 默认勾选
      });

      // 如果已选择"库存"，自动勾选"使用库存"
      if (posting.source_platform && posting.source_platform.includes('库存')) {
        setUseStock(true);
      }
    } else if (visible) {
      // 新建时也设置默认值
      form.setFieldsValue({
        sync_to_ozon: true,
      });
      setUseStock(false);
    }
  }, [visible, posting, form]);

  // 当勾选/取消"使用库存"时
  useEffect(() => {
    if (useStock && allStockSufficient) {
      // 库存充足：自动填0
      form.setFieldsValue({
        purchase_price: 0,
        source_platform: ['库存'],
      });
    } else if (!useStock) {
      // 取消使用库存：清空自动填充的值（如果原来是0）
      const currentPrice = form.getFieldValue('purchase_price');
      if (currentPrice === 0) {
        form.setFieldsValue({
          purchase_price: undefined,
        });
      }

      // 移除"库存"选项
      const currentPlatforms = form.getFieldValue('source_platform') || [];
      form.setFieldsValue({
        source_platform: currentPlatforms.filter((p: string) => p !== '库存'),
      });
    }
  }, [useStock, allStockSufficient, form]);

  // 备货操作 mutation
  const prepareStockMutation = useMutation({
    mutationFn: (data: ozonApi.PrepareStockRequest) => {
      return ozonApi.prepareStock(postingNumber, data);
    },
    onSuccess: () => {
      notifySuccess('操作成功', '备货操作成功');
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 刷新订单列表查询（确保切换标签页时数据正确）
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      // 刷新库存查询
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      // 调用父组件回调（用于从列表中移除）
      if (onSuccess) {
        onSuccess();
      }
      // 关闭弹窗并重置表单
      handleClose();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? error.response?.data?.message || error.message || '备货操作失败'
        : error instanceof Error
          ? error.message
          : '备货操作失败';
      notifyError('操作失败', errorMsg);
    },
  });

  const handleClose = () => {
    form.resetFields();
    setUseStock(false);
    onCancel();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      // 如果使用库存但库存不足，显示警告
      if (useStock && !allStockSufficient) {
        const insufficientItems = stockItems.filter((item) => !item.is_sufficient);
        const message = insufficientItems
          .map(
            (item) =>
              `${item.sku}: 库存${item.stock_available}，需要${item.order_quantity}`
          )
          .join('; ');
        notifyWarning('库存不足', message);

        // 但仍然允许提交（部分扣减）
      }

      // 将 purchase_price 转换为字符串（Decimal 类型）
      const data: ozonApi.PrepareStockRequest = {
        source_platform: values.source_platform,
        purchase_price: String(values.purchase_price),
        order_notes: values.order_notes,
        sync_to_ozon: values.sync_to_ozon !== false, // 默认为true
      };
      prepareStockMutation.mutate(data);
    } catch (error) {
      logger.error('Form validation failed:', error);
    }
  };

  return (
    <Modal
      title={`备货操作 - ${postingNumber}`}
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={prepareStockMutation.isPending}
      okText="确认备货"
      cancelText="取消"
      width={700}
    >
      <Form form={form} layout="vertical" autoComplete="off">
        {/* 库存信息展示（如果有库存） */}
        {stockLoading && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin tip="正在查询库存..." />
          </div>
        )}

        {!stockLoading && hasStock && (
          <Alert
            message="检测到库存商品"
            description={
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {stockItems.map((item, index) => (
                  <Card key={index} size="small" style={{ marginTop: 8 }}>
                    <Space>
                      {/* 商品图片 */}
                      {item.product_image ? (
                        <img
                          src={item.product_image}
                          alt={item.product_title || item.sku}
                          style={{
                            width: 80,
                            height: 80,
                            objectFit: 'cover',
                            borderRadius: 4,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 80,
                            height: 80,
                            background: '#f0f0f0',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                          }}
                        >
                          无图片
                        </div>
                      )}

                      {/* 商品信息 */}
                      <div>
                        <Text strong>{item.product_title || item.sku}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          SKU: {item.sku}
                        </Text>
                        <br />
                        <Text
                          type={item.is_sufficient ? 'success' : 'danger'}
                          style={{ fontSize: 12 }}
                        >
                          库存数量: {item.stock_available} / 订单需要: {item.order_quantity}
                        </Text>
                        {!item.is_sufficient && (
                          <>
                            <br />
                            <Text type="danger" style={{ fontSize: 12 }}>
                              ⚠️ 库存不足
                            </Text>
                          </>
                        )}
                      </div>
                    </Space>
                  </Card>
                ))}

                {/* 使用库存复选框 */}
                <Checkbox checked={useStock} onChange={(e) => setUseStock(e.target.checked)}>
                  使用库存
                </Checkbox>

                {/* 库存不足警告 */}
                {useStock && !allStockSufficient && (
                  <Alert
                    message="库存不足，请补充采购信息"
                    description="当前库存无法满足订单需求，系统将尽可能扣减库存，剩余部分请填写进货价格和采购平台。"
                    type="warning"
                    showIcon
                  />
                )}
              </Space>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 进货价格和采购平台（同一行） */}
        <Row gutter={16}>
          {/* 进货价格（左侧） */}
          <Col span={10}>
            <Form.Item
              name="purchase_price"
              label="进货价格"
              rules={[
                { required: true, message: '请输入进货价格' },
                { type: 'number', min: 0, message: '价格必须大于等于0' },
              ]}
              tooltip="商品的采购成本"
            >
              <InputNumber
                placeholder={useStock && allStockSufficient ? '使用库存，价格为0' : '请输入进货价格'}
                precision={2}
                min={0}
                style={{ width: '100%' }}
                addonBefore="¥"
                controls={false}
                disabled={useStock && allStockSufficient}
              />
            </Form.Item>
          </Col>

          {/* 采购平台（右侧） */}
          <Col span={14}>
            <Form.Item name="source_platform" label="采购平台" tooltip="商品采购来源平台（可多选）">
              <Select
                mode="multiple"
                placeholder="请选择采购平台（可多选）"
                allowClear
                disabled={useStock && allStockSufficient}
              >
                <Option value="1688">1688</Option>
                <Option value="拼多多">拼多多</Option>
                <Option value="咸鱼">咸鱼</Option>
                <Option value="淘宝">淘宝</Option>
                <Option value="库存">库存</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {/* 订单备注 */}
        <Form.Item name="order_notes" label="订单备注" tooltip="订单相关的备注信息（可选）">
          <TextArea
            placeholder="请输入订单备注"
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={500}
            showCount
          />
        </Form.Item>

        {/* 同步到 Ozon */}
        <Form.Item
          name="sync_to_ozon"
          valuePropName="checked"
          tooltip="勾选后会将组装完成状态同步到OZON平台"
        >
          <Checkbox>同步到 Ozon</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default PrepareStockModal;
