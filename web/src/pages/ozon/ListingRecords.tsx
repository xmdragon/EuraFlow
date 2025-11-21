/**
 * 上架记录列表页面
 * 展示跟卖上架的商品记录，支持查看、编辑、重新上架、删除
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
  Image,
  App,
  Form,
  Modal,
  Select,
  DatePicker,
  Typography,
  Spin,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';
import axios from '@/services/axios';

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

  // 查询上架记录列表
  const { data, isLoading } = useQuery({
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

  // 查询每日上架统计数据
  const { data: dailyStatsData, isLoading: isDailyStatsLoading } = useQuery({
    queryKey: ['listing-records-daily-stats', selectedShop, dateRangeParams],
    queryFn: async () => {
      if (!selectedShop) return null;

      const response = await axios.get('/api/ef/v1/ozon/listing-records/daily-stats', {
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

      {/* 统计弹窗 */}
      <Modal
        title={
          <Space>
            <LineChartOutlined />
            <span>商品上架统计</span>
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
              <Tooltip
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
    </div>
  );
};

export default ListingRecords;
