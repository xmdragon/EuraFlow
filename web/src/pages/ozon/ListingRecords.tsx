// @ts-nocheck
/**
 * 上架记录列表页面
 * 展示跟卖上架的商品记录，支持查看、编辑、重新上架、删除
 * 使用 @ts-nocheck 避免 recharts 与 React 19 类型冲突
 */
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Tag,
  App,
  Form,
  Modal,
  Select,
  DatePicker,
  Typography,
  Spin,
  Tooltip,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import CollectionRecordDetailModal from '@/components/ozon/CollectionRecordDetailModal';
import ProductImage from '@/components/ozon/ProductImage';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { useCurrency } from '@/hooks/useCurrency';
import { usePermission } from '@/hooks/usePermission';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozon';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';
import axios from '@/services/axios';
import { useNavigate } from 'react-router-dom';
import { convertCollectionRecordToFormData } from '@/utils/collectionRecordConverter';

const { Text } = Typography;

interface ListingRecord {
  id: number;
  user_id: number;
  shop_id: number | null;
  collection_type: string;
  source_url: string;
  product_data: {
    title?: string;
    title_cn?: string;
    images?: string[] | { url: string; is_primary?: boolean }[];
    price?: number;
    old_price?: number;
    currency?: string;
    description?: string;
    specifications?: Record<string, unknown>;
    variants?: unknown[];
    dimensions?: {
      length?: number;
      width?: number;
      height?: number;
      weight?: number;
    };
    [key: string]: unknown;
  };
  listing_status: string | null;
  listing_task_count: number | null;
  listing_error_message: string | null;
  created_at: string;
  updated_at: string;
}

// 获取图片URL的辅助函数
const getImageUrl = (
  images?: string[] | { url: string }[],
  variants?: { primary_image?: string }[]
): string | undefined => {
  // 优先使用顶层 images
  if (images && images.length > 0) {
    const first = images[0];
    if (typeof first === 'string') return first;
    return first?.url;
  }
  // 其次使用第一个变体的 primary_image
  if (variants && variants.length > 0 && variants[0]?.primary_image) {
    return variants[0].primary_image;
  }
  return undefined;
};


const ListingRecords: React.FC = () => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const { canOperate, canDelete } = usePermission();
  const { formatPrice } = useCurrency();
  const { formatDateTime } = useDateTime();
  const navigate = useNavigate();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { selectedShop, handleShopChange } = useShopSelection();
  const [filterForm] = Form.useForm();

  // 详情弹窗状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ListingRecord | null>(null);

  // 统计弹窗状态
  const [statsModalVisible, setStatsModalVisible] = useState(false);
  const [timeRangeType, setTimeRangeType] = useState<'7days' | '14days' | 'thisMonth' | 'lastMonth' | 'custom'>('14days');
  const [customDateRange, setCustomDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);

  // 计算日期范围参数（后端会根据用户时区处理）
  const dateRangeParams = useMemo(() => {
    switch (timeRangeType) {
      case '7days':
      case '14days':
      case 'thisMonth':
      case 'lastMonth':
        // 传递 range_type，让后端根据用户时区计算
        return { rangeType: timeRangeType };
      case 'custom':
        // 自定义日期范围：前端传日期字符串，后端按用户时区解析
        if (customDateRange[0] && customDateRange[1]) {
          return {
            rangeType: 'custom',
            startDate: customDateRange[0].format('YYYY-MM-DD'),
            endDate: customDateRange[1].format('YYYY-MM-DD'),
          };
        }
        return { rangeType: '7days' }; // 默认7天
      default:
        return { rangeType: '7days' };
    }
  }, [timeRangeType, customDateRange]);

  // 查询店铺列表（用于获取店铺名称）
  const { data: shopsData } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: () => ozonApi.getShops(),
    staleTime: 5 * 60 * 1000,
  });

  const shops = shopsData?.data || [];

  // 获取当前选中店铺的名称
  const selectedShopName = selectedShop
    ? shops.find((s) => s.id === selectedShop)?.shop_name || '未知店铺'
    : '';

  // 查询上架记录列表
  const { data, isLoading } = useQuery({
    queryKey: ['listing-records', selectedShop, currentPage, pageSize],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        collection_type: 'follow_pdp',
        page: currentPage,
        page_size: pageSize,
      };

      // 如果选择了特定店铺（非"全部"），添加 shop_id 参数
      if (selectedShop !== null) {
        params.shop_id = selectedShop;
      }

      const response = await axios.get('/api/ef/v1/ozon/collection-records', { params });
      return response.data.data;
    },
  });

  // 查询每日上架统计数据
  const { data: dailyStatsData, isLoading: isDailyStatsLoading } = useQuery({
    queryKey: ['listing-records-daily-stats', selectedShop, dateRangeParams],
    queryFn: async () => {
      if (!selectedShop) return null;

      const response = await axios.get('/api/ef/v1/ozon/collection-records/daily-stats', {
        params: {
          shop_id: selectedShop,
          range_type: dateRangeParams.rangeType,
          start_date: dateRangeParams.startDate,
          end_date: dateRangeParams.endDate,
        },
      });

      return response.data.data;
    },
    enabled: selectedShop !== null && statsModalVisible,
  });

  // 转换图表数据 - Recharts格式
  const chartData = useMemo(() => {
    if (!dailyStatsData || !dailyStatsData.dates) return [];

    return dailyStatsData.dates.map((date: string) => {
      const displayDate = dayjs(date).format('MM-DD');
      return {
        date: displayDate,
        count: dailyStatsData.data[date] || 0,
      };
    });
  }, [dailyStatsData]);

  // 查看记录详情
  const handleView = (record: ListingRecord) => {
    setCurrentRecord(record);
    setDetailModalVisible(true);
  };

  // 删除记录
  const handleDelete = (recordId: number) => {
    modal.confirm({
      title: '确认删除',
      content: '确定要删除这条上架记录吗？删除后将无法恢复。',
      onOk: async () => {
        try {
          await axios.delete(`/api/ef/v1/ozon/collection-records/${recordId}`);
          notifySuccess('删除成功');
          queryClient.invalidateQueries({ queryKey: ['listing-records'] });
        } catch (error) {
          loggers.api.error('Delete listing record failed', { error });
          notifyError('删除失败');
        }
      },
    });
  };

  // 编辑记录（跳转到商品创建页面）
  const handleEdit = (record: ListingRecord) => {
    if (!selectedShop) {
      notifyError('错误', '请先选择店铺');
      return;
    }

    try {
      // 将采集记录转换为商品表单数据
      const formData = convertCollectionRecordToFormData(record, selectedShop);

      loggers.ozon.info('[ListingRecords] 编辑采集记录', {
        recordId: record.id,
        shopId: selectedShop,
        hasVariants: formData.variants && formData.variants.length > 0,
        imagesCount: formData.images?.length || 0,
      });

      // 跳转到商品创建页面，传递表单数据
      navigate('/dashboard/ozon/product-create', {
        state: {
          draftData: formData,
          source: 'collection_record',
          sourceRecordId: record.id,
        },
      });
    } catch (error) {
      loggers.ozon.error('[ListingRecords] 转换采集记录失败', error);
      notifyError('转换失败', '采集记录数据转换失败，请重试');
    }
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
      width: 80,
      render: (product_data: ListingRecord['product_data']) => {
        const imageUrl = getImageUrl(product_data?.images, product_data?.variants as { primary_image?: string }[]);
        return (
          <ProductImage
            imageUrl={imageUrl}
            size="small"
            hoverBehavior="medium"
          />
        );
      },
    },
    {
      title: '货号',
      dataIndex: 'product_data',
      key: 'offer_id',
      width: 150,
      render: (product_data: ListingRecord['product_data'], record: ListingRecord) => {
        // 优先从 listing_request_payload 获取 offer_id
        const payload = (record as unknown as { listing_request_payload?: { variants?: { offer_id?: string }[] } }).listing_request_payload;
        const offerId = payload?.variants?.[0]?.offer_id || product_data?.offer_id || '-';
        return <Text copyable={{ text: offerId }}>{offerId}</Text>;
      },
    },
    {
      title: '价格',
      dataIndex: 'product_data',
      key: 'price',
      width: 100,
      render: (product_data: ListingRecord['product_data']) => {
        const price = product_data?.price;
        return price ? formatPrice(price) : '-';
      },
    },
    {
      title: '上架状态',
      dataIndex: 'listing_status',
      key: 'listing_status',
      width: 90,
      render: renderStatusTag,
    },
    {
      title: '上架方式',
      dataIndex: 'listing_source',
      key: 'listing_source',
      width: 100,
      render: (_: unknown, record: ListingRecord) => {
        // 根据记录数据推断上架方式
        const extRecord = record as unknown as { listing_source?: string; last_edited_at?: string };

        // 如果有明确的 listing_source 字段
        if (extRecord.listing_source) {
          const sourceConfig: Record<string, { color: string; text: string }> = {
            follow: { color: 'blue', text: '跟卖上架' },
            manual: { color: 'green', text: '手动上架' },
            edit: { color: 'orange', text: '编辑上架' },
          };
          const config = sourceConfig[extRecord.listing_source] || { color: 'default', text: extRecord.listing_source };
          return <Tag color={config.color}>{config.text}</Tag>;
        }

        // 否则根据是否有编辑记录推断
        if (extRecord.last_edited_at) {
          return <Tag color="orange">编辑上架</Tag>;
        }

        // 默认为跟卖上架
        return <Tag color="blue">跟卖上架</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 100,
      render: (time: string) => formatDateTime(time),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      align: 'center' as const,
      render: (_: unknown, record: ListingRecord) => (
        <Space direction="vertical" size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
            style={{ padding: 0 }}
          >
            查看
          </Button>
          {canOperate && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              style={{ padding: 0 }}
            >
              编辑
            </Button>
          )}
          {record.listing_status === 'failed' && canOperate && (
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              style={{ padding: 0 }}
            >
              重试
            </Button>
          )}
          {canDelete && (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id)}
              style={{ padding: 0 }}
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
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              icon={<LineChartOutlined />}
              onClick={() => setStatsModalVisible(true)}
              disabled={!selectedShop}
            >
              统计
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 数据表格 */}
      <Card>
        <style>{`
          .listing-table .ant-table-cell {
            padding: 4px 8px !important;
          }
        `}</style>
        <Table
          columns={columns}
          dataSource={data?.items || []}
          loading={isLoading}
          rowKey="id"
          size="small"
          scroll={{ x: true }}
          className="listing-table"
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

      {/* 统计弹窗 */}
      <Modal
        title={
          <Space>
            <LineChartOutlined />
            <span>{selectedShopName} - 商品上架统计</span>
          </Space>
        }
        open={statsModalVisible}
        onCancel={() => setStatsModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setStatsModalVisible(false)}>
            关闭
          </Button>,
        ]}
        width={900}
      >
        {/* 时间范围选择器 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size="middle">
            <Text strong>时间范围：</Text>
            <Select
              value={timeRangeType}
              onChange={(value) => {
                setTimeRangeType(value);
                if (value !== 'custom') {
                  setCustomDateRange([null, null]);
                }
              }}
              style={{ width: 100 }}
              options={[
                { label: '7天', value: '7days' },
                { label: '14天', value: '14days' },
                { label: '本月', value: 'thisMonth' },
                { label: '上月', value: 'lastMonth' },
                { label: '自定义', value: 'custom' },
              ]}
            />
            {timeRangeType === 'custom' && (
              <DatePicker.RangePicker
                value={customDateRange}
                onChange={(dates) => setCustomDateRange(dates as [Dayjs | null, Dayjs | null])}
                format="YYYY-MM-DD"
                placeholder={['开始日期', '结束日期']}
              />
            )}
          </Space>
        </Card>

        {/* 折线图 */}
        {isDailyStatsLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12 }}
              />
              <YAxis />
              <RechartsTooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          padding: '10px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                        }}
                      >
                        <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{label}</p>
                        <p style={{ margin: 0, color: '#1890ff' }}>
                          上架数量: {payload[0].value}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="count"
                name="上架数量"
                stroke="#1890ff"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Text type="secondary">暂无数据</Text>
          </div>
        )}
      </Modal>

      {/* 详情弹窗 */}
      <CollectionRecordDetailModal
        visible={detailModalVisible}
        record={currentRecord}
        onClose={() => {
          setDetailModalVisible(false);
          setCurrentRecord(null);
        }}
        isListingRecord={true}
      />
    </div>
  );
};

export default ListingRecords;
