/**
 * 上架记录列表页面
 * 展示跟卖上架的商品记录，支持查看、编辑、重新上架、删除
 */
import { CloudUploadOutlined, DeleteOutlined, EditOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Tag,
  Image,
  App,
  Form,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';
import axios from '@/services/axios';

interface ListingRecord {
  id: number;
  user_id: number;
  shop_id: number | null;
  collection_type: string;
  source_url: string;
  product_data: {
    title?: string;
    title_cn?: string;
    images?: string[];
    price?: number;
  };
  listing_status: string | null;
  listing_task_id: string | null;
  listing_error_message: string | null;
  created_at: string;
  updated_at: string;
}

const ListingRecords: React.FC = () => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const { canOperate, canDelete } = usePermission();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { selectedShop, handleShopChange } = useShopSelection();
  const [filterForm] = Form.useForm();

  // 查询上架记录列表
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['listing-records', selectedShop, currentPage, pageSize],
    queryFn: async () => {
      if (!selectedShop) return { items: [], total: 0 };

      const response = await axios.get('/api/ef/v1/ozon/collection-records', {
        params: {
          collection_type: 'follow_pdp',
          shop_id: selectedShop,
          page: currentPage,
          page_size: pageSize,
        },
      });

      return response.data.data;
    },
    enabled: selectedShop !== null,
  });

  // 删除记录
  const handleDelete = (recordId: number) => {
    modal.confirm({
      title: '确认删除',
      content: '确定要删除这条上架记录吗？删除后将无法恢复。',
      onOk: async () => {
        try {
          await axios.delete(`/api/ef/v1/ozon/collection-records/${recordId}`);
          notifySuccess('删除成功');
          refetch();
        } catch (error) {
          loggers.api.error('Delete listing record failed', { error });
          notifyError('删除失败');
        }
      },
    });
  };

  // 状态标签渲染
  const renderStatusTag = (status: string | null) => {
    const statusConfig: Record<string, { color: string; text: string }> = {
      pending: { color: 'processing', text: '待上架' },
      processing: { color: 'default', text: '上架中' },
      success: { color: 'success', text: '已上架' },
      failed: { color: 'error', text: '失败' },
    };

    const config = statusConfig[status || 'pending'];
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  // 表格列定义
  const columns = [
    {
      title: '商品图片',
      dataIndex: 'product_data',
      key: 'image',
      width: 100,
      render: (product_data: ListingRecord['product_data']) => {
        const imageUrl = product_data?.images?.[0];
        return imageUrl ? (
          <Image src={imageUrl} alt="商品图片" width={60} height={60} />
        ) : (
          <div style={{ width: 60, height: 60, background: '#f0f0f0' }} />
        );
      },
    },
    {
      title: '商品标题',
      dataIndex: 'product_data',
      key: 'title',
      ellipsis: true,
      render: (product_data: ListingRecord['product_data']) => (
        <div>
          <div>{product_data?.title || '-'}</div>
          <div style={{ color: '#999', fontSize: 12 }}>{product_data?.title_cn || '-'}</div>
        </div>
      ),
    },
    {
      title: '上架状态',
      dataIndex: 'listing_status',
      key: 'listing_status',
      width: 100,
      render: renderStatusTag,
    },
    {
      title: '错误信息',
      dataIndex: 'listing_error_message',
      key: 'listing_error_message',
      ellipsis: true,
      width: 200,
      render: (error: string | null) => error || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: ListingRecord) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />}>
            查看
          </Button>
          {canOperate && (
            <Button type="link" size="small" icon={<EditOutlined />}>
              编辑
            </Button>
          )}
          {record.listing_status === 'failed' && canOperate && (
            <Button type="link" size="small" icon={<ReloadOutlined />}>
              重新上架
            </Button>
          )}
          {canDelete && (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id)}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageTitle icon={<CloudUploadOutlined />} title="上架记录" />

      {/* 过滤栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Form form={filterForm} layout="inline">
          <Form.Item label="选择店铺">
            <ShopSelector
              value={selectedShop}
              onChange={handleShopChange}
              showAllOption={false}
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={() => refetch()}>
              刷新
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 数据表格 */}
      <Card>
        <Table
          columns={columns}
          dataSource={data?.items || []}
          loading={isLoading}
          rowKey="id"
          pagination={{
            current: currentPage,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
          }}
        />
      </Card>
    </div>
  );
};

export default ListingRecords;
