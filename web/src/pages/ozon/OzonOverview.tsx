/**
 * Ozon 管理概览页面
 */
import {
  ShoppingOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Space, Typography, Spin, Select, DatePicker } from 'antd';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
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

import ShopSelectorWithLabel from '../../components/ozon/ShopSelectorWithLabel';
import * as ozonApi from '../../services/ozonApi';

import styles from './OzonOverview.module.scss';

import PageTitle from '@/components/PageTitle';
import { useCurrency } from '@/hooks/useCurrency';

const { Text } = Typography;

// 图表颜色配置
const CHART_COLORS = [
  '#1890ff',
  '#52c41a',
  '#faad14',
  '#f5222d',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
  '#a0d911',
  '#2f54eb',
];

const OzonOverview: React.FC = () => {
  // 获取系统默认货币
  const { symbol: currencySymbol } = useCurrency();

  // 初始化为 null 表示"全部店铺"
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [debouncedShop, setDebouncedShop] = useState<number | null>(null);
  const [timeRangeType, setTimeRangeType] = useState<'7days' | '14days' | 'thisMonth' | 'lastMonth' | 'custom'>('14days');
  const [customDateRange, setCustomDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [displayMode, setDisplayMode] = useState<'single' | 'total'>('total'); // single: 单店显示, total: 汇总显示

  // 防抖处理，避免快速切换店铺时的大量请求
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedShop(selectedShop);
    }, 300);

    return () => clearTimeout(timer);
  }, [selectedShop]);

  // 优化店铺选择处理函数
  const handleShopChange = useCallback((shopId: number | number[] | null) => {
    const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
    setSelectedShop(normalized);
  }, []);

  // 获取店铺列表（与ShopSelector共享查询）
  const { data: shops } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: ozonApi.getShops,
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
  });

  // 等待ShopSelector完成初始化后再请求数据
  // 允许 debouncedShop 为 null（表示全部店铺）
  const shouldFetchData = !!shops?.data?.length && debouncedShop !== undefined;

  // 获取统计数据（使用防抖后的店铺ID）
  const { data: statisticsData } = useQuery({
    queryKey: ['ozon', 'statistics', debouncedShop],
    queryFn: () => ozonApi.getStatistics(debouncedShop),
    enabled: shouldFetchData,
    staleTime: 1 * 60 * 1000, // 1分钟内不重新请求
  });

  // 计算日期范围参数
  const dateRangeParams = useMemo(() => {
    const now = dayjs();

    switch (timeRangeType) {
      case '7days':
        return { days: 7 };
      case '14days':
        return { days: 14 };
      case 'thisMonth':
        // 从本月1日到今天
        return {
          startDate: now.startOf('month').format('YYYY-MM-DD'),
          endDate: now.format('YYYY-MM-DD'),
        };
      case 'lastMonth':
        // 上个月1日到上个月最后一天
        const lastMonth = now.subtract(1, 'month');
        return {
          startDate: lastMonth.startOf('month').format('YYYY-MM-DD'),
          endDate: lastMonth.endOf('month').format('YYYY-MM-DD'),
        };
      case 'custom':
        // 自定义日期范围
        if (customDateRange[0] && customDateRange[1]) {
          return {
            startDate: customDateRange[0].format('YYYY-MM-DD'),
            endDate: customDateRange[1].format('YYYY-MM-DD'),
          };
        }
        return { days: 7 }; // 默认7天
      default:
        return { days: 7 };
    }
  }, [timeRangeType, customDateRange]);

  // 获取每日posting统计
  const { data: dailyStatsData, isLoading: isDailyStatsLoading } = useQuery({
    queryKey: ['ozon', 'daily-posting-stats', debouncedShop, dateRangeParams],
    queryFn: () => ozonApi.getDailyPostingStats(
      debouncedShop,
      'days' in dateRangeParams ? dateRangeParams.days : undefined,
      'startDate' in dateRangeParams ? dateRangeParams.startDate : undefined,
      'endDate' in dateRangeParams ? dateRangeParams.endDate : undefined
    ),
    enabled: shouldFetchData,
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
  });

  // 使用statistics API数据
  const stats = {
    products: {
      total: statisticsData?.products?.total || 0,
      on_sale: statisticsData?.products?.on_sale || 0,
      out_of_stock: statisticsData?.products?.out_of_stock || 0,
      synced: statisticsData?.products?.synced || 0,
    },
    orders: {
      total: statisticsData?.orders?.total || 0,
      pending: statisticsData?.orders?.pending || 0,
      processing: statisticsData?.orders?.processing || 0,
      shipped: statisticsData?.orders?.shipped || 0,
      delivered: statisticsData?.orders?.delivered || 0,
      cancelled: statisticsData?.orders?.cancelled || 0,
    },
    revenue: {
      yesterday: statisticsData?.revenue?.yesterday || 0,
      week: statisticsData?.revenue?.week || 0,
      month: statisticsData?.revenue?.month || 0,
    },
  };

  // 计算日期范围显示文本
  const dateRangeLabel = useMemo(() => {
    if (!dailyStatsData || dailyStatsData.dates.length === 0) {
      return '总计';
    }
    const startDate = dailyStatsData.dates[0];
    const endDate = dailyStatsData.dates[dailyStatsData.dates.length - 1];
    return `总计 (${startDate} ~ ${endDate})`;
  }, [dailyStatsData]);

  // 转换图表数据 - Recharts格式
  const chartData = useMemo(() => {
    if (!dailyStatsData) return [];

    return dailyStatsData.dates.map((date) => {
      // 将日期格式从 YYYY-MM-DD 转换为 MM-DD
      const displayDate = dayjs(date).format('MM-DD');
      const dayData: Record<string, string | number> = { date: displayDate };

      if (displayMode === 'total' && !selectedShop) {
        // 汇总模式：计算所有店铺的总和
        let total = 0;
        dailyStatsData.shops.forEach((shop) => {
          total += dailyStatsData.data[date]?.[shop] || 0;
        });
        dayData[dateRangeLabel] = total;
      } else {
        // 单店模式：显示各店铺独立数据
        dailyStatsData.shops.forEach((shop) => {
          dayData[shop] = dailyStatsData.data[date]?.[shop] || 0;
        });
      }

      return dayData;
    });
  }, [dailyStatsData, displayMode, selectedShop, dateRangeLabel]);

  // 自定义tooltip内容
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      // 计算总数量
      const total = payload.reduce((sum: number, item: any) => sum + (item.value || 0), 0);

      return (
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          padding: '10px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{label}</p>
          <p style={{ margin: 0, color: '#1890ff' }}>数量: {total}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      <PageTitle icon={<ShoppingOutlined />} title="Ozon 管理概览" />

      <div className={styles.contentContainer}>
        <Row className={styles.titleRow} align="middle">
          <Col>
            <ShopSelectorWithLabel
              value={selectedShop}
              onChange={handleShopChange}
              showAllOption={true}
              className={styles.shopSelector}
            />
          </Col>
        </Row>

        {/* 概览统计 */}
        <Row gutter={8} className={styles.statsRow} align="middle">
          <Col flex="auto">
            <Card>
              <Statistic
                title={selectedShop ? shops?.data?.find((s: any) => s.id === selectedShop)?.shop_name : '店铺数'}
                value={
                  selectedShop
                    ? shops?.data?.find((s: any) => s.id === selectedShop)?.shop_name || '-'
                    : shops?.data?.length || 0
                }
                prefix={selectedShop ? null : <ShoppingOutlined />}
                valueRender={(value) =>
                  selectedShop && typeof value === 'string' && isNaN(Number(value)) ? (
                    <Text className={styles.shopNameValue}>{value}</Text>
                  ) : (
                    value
                  )
                }
              />
            </Card>
          </Col>
          <Col flex="160px">
            <Card className={styles.fixedWidthCard}>
              <Statistic
                title="总商品数"
                value={stats.products.total}
                prefix={<ShoppingOutlined />}
              />
            </Card>
          </Col>
          <Col flex="160px">
            <Card className={styles.fixedWidthCard}>
              <Statistic
                title="待处理订单"
                value={stats.orders.pending}
                prefix={<ShoppingOutlined />}
              />
            </Card>
          </Col>
          <Col flex="160px">
            <Card className={styles.fixedWidthCard}>
              <Statistic
                title="昨日销售额"
                value={parseFloat(stats.revenue.yesterday.toString())}
                precision={2}
                prefix={currencySymbol}
              />
            </Card>
          </Col>
        </Row>

        {/* 每日Posting统计趋势图 */}
        <Card
          title={
            <Space>
              <LineChartOutlined />
              <span>每日订单统计趋势</span>
            </Space>
          }
          extra={
            <Space>
              {!selectedShop && (
                <Select
                  value={displayMode}
                  onChange={setDisplayMode}
                  style={{ width: 120 }}
                  options={[
                    { label: '单店显示', value: 'single' },
                    { label: '汇总显示', value: 'total' },
                  ]}
                />
              )}
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
          }
          className={styles.chartCard}
        >
          {isDailyStatsLoading ? (
            <div className={styles.chartLoading}>
              <Spin size="large" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 12 }}
                />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                {displayMode === 'total' && !selectedShop ? (
                  // 汇总模式：只显示一条总计线
                  <Line
                    key="total"
                    type="monotone"
                    dataKey={dateRangeLabel}
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ) : (
                  // 单店模式：显示各店铺的线
                  dailyStatsData?.shops.map((shop, index) => (
                    <Line
                      key={shop}
                      type="monotone"
                      dataKey={shop}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  ))
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className={styles.chartEmpty}>
              <Text type="secondary">暂无数据</Text>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default OzonOverview;
