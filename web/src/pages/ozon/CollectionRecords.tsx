/**
 * 采集记录列表页面
 * 展示普通采集的商品记录，支持查看、编辑、上架、删除
 */
import { DatabaseOutlined, DeleteOutlined, EditOutlined, EyeOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Image,
  App,
  Form,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';
import axios from '@/services/axios';

interface CollectionRecord {
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
  created_at: string;
  updated_at: string;
}

const CollectionRecords: React.FC = () => {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canOperate, canDelete } = usePermission();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // 使用独立的 localStorage 键，默认为 null（全部店铺）
  const { selectedShop, handleShopChange } = useShopSelection({
    persistKey: 'ozon_collection_records_shop',
    initialValue: null,
  });
  const [filterForm] = Form.useForm();

  // 查询采集记录列表
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['collection-records', selectedShop, currentPage, pageSize],
    queryFn: async () => {
      // 构建查询参数
      const params: Record<string, string> = {
        collection_type: 'collect_only',
        page: String(currentPage),
        page_size: String(pageSize),
      };

      // 如果选择了具体店铺，添加 shop_id 参数
      if (selectedShop && selectedShop > 0) {
        params.shop_id = String(selectedShop);
      }
      // 如果 selectedShop 为 null 或 0，不传 shop_id（查询所有记录）

      const response = await axios.get('/api/ef/v1/ozon/collection-records', {
        params,
      });

      return response.data.data;
    },
  });

  // 删除记录
  const handleDelete = (recordId: number) => {
    modal.confirm({
      title: '确认删除',
      content: '确定要删除这条采集记录吗？删除后将无法恢复。',
      onOk: async () => {
        try {
          await axios.delete(`/api/ef/v1/ozon/collection-records/${recordId}`);
          notifySuccess('删除成功');
          refetch();
        } catch (error) {
          loggers.api.error('Delete collection record failed', { error });
          notifyError('删除失败');
        }
      },
    });
  };

  // 查看记录详情
  const handleView = (record: CollectionRecord) => {
    modal.info({
      title: '商品详情',
      width: 800,
      content: (
        <div>
          <p><strong>来源链接：</strong><a href={record.source_url} target="_blank" rel="noopener noreferrer">{record.source_url}</a></p>
          <p><strong>商品标题：</strong>{record.product_data?.title || '-'}</p>
          <p><strong>中文标题：</strong>{record.product_data?.title_cn || '-'}</p>
          <p><strong>创建时间：</strong>{dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss')}</p>
          <p><strong>商品数据：</strong></p>
          <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
            {JSON.stringify(record.product_data, null, 2)}
          </pre>
        </div>
      ),
    });
  };

  // 编辑记录（跳转到新建商品页并填充数据）
  const handleEdit = async (recordId: number) => {
    try {
      const response = await axios.post(`/api/ef/v1/ozon/collection-records/${recordId}/to-draft`);
      const draftData = response.data.data.draft_data;

      // 跳转到新建商品页，携带草稿数据
      navigate('/dashboard/ozon/products/create', {
        state: {
          draftData,
          source: 'collection_record',
          sourceRecordId: recordId,
        },
      });
    } catch (error) {
      loggers.api.error('Convert to draft failed', { error });
      notifyError('转换失败');
    }
  };

  // 上架（跳转到新建商品页并填充数据）
  const handleListing = async (recordId: number) => {
    try {
      const response = await axios.post(`/api/ef/v1/ozon/collection-records/${recordId}/to-draft`);
      const draftData = response.data.data.draft_data;

      // 跳转到新建商品页，携带草稿数据
      navigate('/dashboard/ozon/products/create', {
        state: {
          draftData,
          source: 'collection_record',
          sourceRecordId: recordId,
        },
      });
    } catch (error) {
      loggers.api.error('Convert to draft failed', { error });
      notifyError('转换失败');
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '商品图片',
      dataIndex: 'product_data',
      key: 'image',
      width: 100,
      render: (product_data: CollectionRecord['product_data']) => {
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
      render: (product_data: CollectionRecord['product_data']) => (
        <div>
          <div>{product_data?.title || '-'}</div>
          <div style={{ color: '#999', fontSize: 12 }}>{product_data?.title_cn || '-'}</div>
        </div>
      ),
    },
    {
      title: '来源链接',
      dataIndex: 'source_url',
      key: 'source_url',
      ellipsis: true,
      width: 200,
      render: (url: string) => (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      ),
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
      width: 280,
      render: (_: unknown, record: CollectionRecord) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
          >
            查看
          </Button>
          {canOperate && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record.id)}
            >
              编辑
            </Button>
          )}
          {canOperate && (
            <Button
              type="link"
              size="small"
              icon={<CloudUploadOutlined />}
              onClick={() => handleListing(record.id)}
            >
              上架
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
      <PageTitle icon={<DatabaseOutlined />} title="采集记录" />

      {/* 过滤栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Form form={filterForm} layout="inline">
          <Form.Item label="选择店铺">
            <ShopSelector
              value={selectedShop}
              onChange={handleShopChange}
              showAllOption={true}
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

export default CollectionRecords;
