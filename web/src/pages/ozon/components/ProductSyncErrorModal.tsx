import React from 'react';
import { Modal, Alert, Empty, Spin, Typography, List, Tag } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { ozonApi } from '@/api/ozonApi';

const { Text, Paragraph } = Typography;

interface ProductSyncErrorModalProps {
  visible: boolean;
  productId: number | null;
  onClose: () => void;
}

interface SyncError {
  id: number;
  offer_id: string;
  task_id: number | null;
  status: string | null;
  errors: Array<{
    code?: string;
    message?: string;
    field?: string;
    [key: string]: any;
  }>;
  created_at: string | null;
  updated_at: string | null;
}

interface ApiResponse {
  has_errors: boolean;
  message?: string;
  sync_error?: SyncError;
}

const ProductSyncErrorModal: React.FC<ProductSyncErrorModalProps> = ({
  visible,
  productId,
  onClose,
}) => {
  const { data, isLoading, error } = useQuery<ApiResponse>({
    queryKey: ['productSyncErrors', productId],
    queryFn: async () => {
      if (!productId) throw new Error('Product ID is required');
      const response = await ozonApi.get(`/products/${productId}/sync-errors`);
      return response.data;
    },
    enabled: visible && productId !== null,
  });

  const renderErrorItem = (error: any, index: number) => {
    return (
      <List.Item key={index}>
        <div style={{ width: '100%' }}>
          {error.code && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="red">{error.code}</Tag>
            </div>
          )}
          {error.field && (
            <div style={{ marginBottom: 4 }}>
              <Text strong>字段：</Text>
              <Text code>{error.field}</Text>
            </div>
          )}
          {error.message && (
            <Paragraph style={{ marginBottom: 0, marginTop: 4 }}>
              <Text>{error.message}</Text>
            </Paragraph>
          )}
          {!error.code && !error.message && (
            <Paragraph style={{ marginBottom: 0 }}>
              <Text type="secondary">{JSON.stringify(error)}</Text>
            </Paragraph>
          )}
        </div>
      </List.Item>
    );
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">加载错误信息中...</Text>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <Alert
          message="加载失败"
          description={`无法获取同步错误信息：${error instanceof Error ? error.message : '未知错误'}`}
          type="error"
          showIcon
        />
      );
    }

    if (!data?.has_errors) {
      return (
        <Empty
          description="该商品没有同步错误记录"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }

    const { sync_error } = data;
    if (!sync_error) {
      return <Empty description="暂无数据" />;
    }

    return (
      <div>
        {/* 基本信息 */}
        <div style={{ marginBottom: 16, padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
          <div style={{ marginBottom: 8 }}>
            <Text strong>Offer ID：</Text>
            <Text code>{sync_error.offer_id}</Text>
          </div>
          {sync_error.task_id && (
            <div style={{ marginBottom: 8 }}>
              <Text strong>任务 ID：</Text>
              <Text code>{sync_error.task_id}</Text>
            </div>
          )}
          {sync_error.status && (
            <div style={{ marginBottom: 8 }}>
              <Text strong>状态：</Text>
              <Tag color="orange">{sync_error.status}</Tag>
            </div>
          )}
          {sync_error.created_at && (
            <div>
              <Text strong>记录时间：</Text>
              <Text>{new Date(sync_error.created_at).toLocaleString('zh-CN')}</Text>
            </div>
          )}
        </div>

        {/* 错误列表 */}
        <Alert
          message={
            <span>
              <ExclamationCircleOutlined style={{ marginRight: 8 }} />
              共发现 {sync_error.errors?.length || 0} 个错误
            </span>
          }
          type="error"
          style={{ marginBottom: 16 }}
        />

        {sync_error.errors && sync_error.errors.length > 0 ? (
          <List
            bordered
            dataSource={sync_error.errors}
            renderItem={renderErrorItem}
            style={{ maxHeight: '400px', overflow: 'auto' }}
          />
        ) : (
          <Empty description="错误详情为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    );
  };

  return (
    <Modal
      title={
        <span>
          <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
          商品同步错误详情
        </span>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={700}
      destroyOnClose
    >
      {renderContent()}
    </Modal>
  );
};

export default ProductSyncErrorModal;
