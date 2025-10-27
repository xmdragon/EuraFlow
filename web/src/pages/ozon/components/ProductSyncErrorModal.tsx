import React from 'react';
import { Modal, Alert, Empty, Spin, Typography, List, Tag } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import * as ozonApi from '@/services/ozonApi';

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
      return await ozonApi.getProductSyncErrors(productId);
    },
    enabled: visible && productId !== null,
  });

  const renderErrorItem = (error: any, index: number) => {
    // 获取错误描述（优先使用 texts.description，其次使用 description）
    const description = error.texts?.description || error.description;
    const attributeName = error.texts?.attribute_name || error.attribute_name;

    return (
      <List.Item key={index}>
        <div style={{ width: '100%' }}>
          {/* 错误代码和级别 */}
          <div style={{ marginBottom: 8 }}>
            {error.code && (
              <Tag color="red">{error.code}</Tag>
            )}
            {error.level && (
              <Tag color="orange">{error.level}</Tag>
            )}
            {error.state && (
              <Tag color="blue">{error.state}</Tag>
            )}
          </div>

          {/* 错误描述（用户友好） */}
          {description && (
            <div style={{ marginBottom: 8, padding: '8px 12px', backgroundColor: '#fff2e8', borderRadius: '4px' }}>
              <Text strong style={{ color: '#d46b08' }}>错误说明：</Text>
              <div style={{ marginTop: 4 }}>
                <Text>{description}</Text>
              </div>
            </div>
          )}

          {/* 属性名称 */}
          {attributeName && (
            <div style={{ marginBottom: 4 }}>
              <Text strong>属性名称：</Text>
              <Text>{attributeName}</Text>
              {error.attribute_id && (
                <Text type="secondary"> (ID: {error.attribute_id})</Text>
              )}
            </div>
          )}

          {/* 字段 */}
          {error.field && (
            <div style={{ marginBottom: 4 }}>
              <Text strong>字段：</Text>
              <Text code>{error.field}</Text>
            </div>
          )}

          {/* 技术消息（折叠显示） */}
          {error.message && error.message !== description && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                技术信息：{error.message}
              </Text>
            </div>
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
          description="该商品没有错误记录"
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
          商品错误详情
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
