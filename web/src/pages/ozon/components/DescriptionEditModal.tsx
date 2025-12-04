/**
 * 商品描述编辑弹窗
 */

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Spin, Alert, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '@/services/axios';
import { notifySuccess, notifyError } from '@/utils/notification';

const { TextArea } = Input;
const { Text } = Typography;

interface DescriptionEditModalProps {
  visible: boolean;
  productId: number | null;
  productTitle?: string;
  onClose: () => void;
}

interface DescriptionData {
  product_id: number;
  offer_id: string;
  ozon_product_id: number;
  title: string;
  description: string;
  description_category_id: number;
  source: 'local' | 'ozon_api';
  error?: string;
}

const fetchDescription = async (productId: number): Promise<DescriptionData> => {
  const response = await axios.get(`/api/ef/v1/ozon/products/${productId}/description`);
  return response.data.data;
};

const updateDescription = async ({
  productId,
  description,
}: {
  productId: number;
  description: string;
}): Promise<void> => {
  await axios.put(`/api/ef/v1/ozon/products/${productId}/description`, {
    description,
  });
};

export const DescriptionEditModal: React.FC<DescriptionEditModalProps> = ({
  visible,
  productId,
  productTitle,
  onClose,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 获取商品描述
  const {
    data: descriptionData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['product-description', productId],
    queryFn: () => fetchDescription(productId!),
    enabled: visible && productId !== null,
    staleTime: 0, // 每次都重新获取
  });

  // 更新描述 mutation
  const updateMutation = useMutation({
    mutationFn: updateDescription,
    onSuccess: () => {
      notifySuccess('商品描述更新成功');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (error: any) => {
      const message = error.response?.data?.detail || error.message || '更新失败';
      notifyError(`更新失败: ${message}`);
    },
  });

  // 当数据加载完成时，设置表单值
  useEffect(() => {
    if (descriptionData) {
      form.setFieldsValue({
        description: descriptionData.description || '',
      });
    }
  }, [descriptionData, form]);

  // 关闭时重置表单
  useEffect(() => {
    if (!visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleSubmit = async () => {
    if (!productId) return;

    try {
      const values = await form.validateFields();
      await updateMutation.mutateAsync({
        productId,
        description: values.description,
      });
    } catch (error) {
      // Form validation error, ignore
    }
  };

  return (
    <Modal
      title={`编辑商品描述${productTitle ? ` - ${productTitle}` : ''}`}
      open={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={updateMutation.isPending}
      width={600}
      destroyOnClose
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="加载商品描述中..." />
        </div>
      ) : error ? (
        <Alert
          type="error"
          message="加载失败"
          description={String(error)}
          showIcon
        />
      ) : (
        <>
          {descriptionData?.source === 'local' && descriptionData?.error && (
            <Alert
              type="warning"
              message="从本地数据加载"
              description={`无法从OZON获取最新数据: ${descriptionData.error}`}
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Form form={form} layout="vertical">
            <Form.Item label="商品标题">
              <Text strong>{descriptionData?.title || productTitle || '-'}</Text>
            </Form.Item>

            <Form.Item label="商品SKU">
              <Text code>{descriptionData?.offer_id || '-'}</Text>
            </Form.Item>

            <Form.Item
              name="description"
              label="商品描述"
              rules={[
                { max: 5000, message: '描述不能超过5000个字符' },
              ]}
              extra="支持 HTML 标签，最多5000个字符"
            >
              <TextArea
                rows={8}
                placeholder="请输入商品描述..."
                showCount
                maxLength={5000}
              />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
};

export default DescriptionEditModal;
