// @ts-nocheck - recharts 组件与 React 19 类型定义不兼容
/**
 * Ozon 管理概览页面
 */
import {
  DashboardOutlined,
  LineChartOutlined,
  ShoppingOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Space, Typography, Spin, Select, DatePicker } from 'antd';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import ShopSelectorWithLabel from '../../components/ozon/ShopSelectorWithLabel';
import { getShops, getStatistics, getDailyStats } from '@/services/ozon';

import styles from './OzonOverview.module.scss';

import PageTitle from '@/components/PageTitle';
import { useCurrency } from '@/hooks/useCurrency';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';

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
  // 获取系统默认货币和时区工具
  const { symbol: currencySymbol } = useCurrency();

  // 店铺选择（带验证）
  const { selectedShop, setSelectedShop } = useShopSelection();
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
    queryFn: () => getShops(),
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
  });

  // 等待ShopSelector完成初始化后再请求数据
  // 允许 debouncedShop 为 null（表示全部店铺）
  const shouldFetchData = !!shops?.data?.length && debouncedShop !== undefined;

  // 获取统计数据（使用防抖后的店铺ID）
  const { data: statisticsData } = useQuery({
    queryKey: ['ozon', 'statistics', debouncedShop],
    queryFn: () => getStatistics(debouncedShop),
    enabled: shouldFetchData,
    staleTime: 1 * 60 * 1000, // 1分钟内不重新请求
  });

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

  // 获取每日统计数据（合并 posting 数量和销售额）
  const { data: dailyStatsData, isLoading: isDailyStatsLoading } = useQuery({
    queryKey: ['ozon', 'daily-stats', debouncedShop, dateRangeParams],
    queryFn: () => getDailyStats(
      debouncedShop,
      dateRangeParams.rangeType,
      dateRangeParams.startDate,
      dateRangeParams.endDate
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
    balance: {
      total_rub: parseFloat(statisticsData?.balance?.total_rub || '0'),
      total_cny: parseFloat(statisticsData?.balance?.total_cny || '0'),
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

  // 转换图表数据 - Recharts格式（posting 数量）
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
          total += dailyStatsData.counts[date]?.[shop] || 0;
        });
        dayData[dateRangeLabel] = total;
      } else {
        // 单店模式：显示各店铺独立数据
        dailyStatsData.shops.forEach((shop) => {
          dayData[shop] = dailyStatsData.counts[date]?.[shop] || 0;
        });
      }

      return dayData;
    });
  }, [dailyStatsData, displayMode, selectedShop, dateRangeLabel]);

  // 转换销售额图表数据 - Recharts格式（使用合并 API 的 revenue 字段）
  const revenueChartData = useMemo(() => {
    if (!dailyStatsData) return [];

    return dailyStatsData.dates.map((date) => {
      // 将日期格式从 YYYY-MM-DD 转换为 MM-DD
      const displayDate = dayjs(date).format('MM-DD');
      const dayData: Record<string, string | number> = { date: displayDate };

      if (displayMode === 'total' && !selectedShop) {
        // 汇总模式：计算所有店铺的总和
        let total = 0;
        dailyStatsData.shops.forEach((shop) => {
          const value = dailyStatsData.revenue[date]?.[shop];
          total += parseFloat(value || '0');
        });
        dayData[dateRangeLabel] = total;
      } else {
        // 单店模式：显示各店铺独立数据
        dailyStatsData.shops.forEach((shop) => {
          const value = dailyStatsData.revenue[date]?.[shop];
          dayData[shop] = parseFloat(value || '0');
        });
      }

      return dayData;
    });
  }, [dailyStatsData, displayMode, selectedShop, dateRangeLabel]);

  // Tooltip 样式常量（避免每次渲染创建新对象）
  const tooltipStyle = useMemo(() => ({
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
  }), []);

  // 自定义tooltip内容 - 订单数量（memoized）
  const CustomTooltip = useCallback(({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string; color?: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum: number, item: { value?: number }) => sum + (item.value || 0), 0);
      return (
        <div style={tooltipStyle}>
          <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{label}</p>
          <p style={{ margin: 0, color: '#1890ff' }}>数量: {total}</p>
        </div>
      );
    }
    return null;
  }, [tooltipStyle]);

  // 自定义tooltip内容 - 销售额（memoized）
  const RevenueTooltip = useCallback(({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; name?: string; color?: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum: number, item: { value?: number }) => sum + (item.value || 0), 0);
      return (
        <div style={tooltipStyle}>
          <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{label}</p>
          <p style={{ margin: 0, color: '#52c41a' }}>
            销售额: {currencySymbol}{total.toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  }, [tooltipStyle, currencySymbol]);

  // 自定义柱状图标签 - 显示销售额（外部显示，带引导线和背景色）- memoized
  const renderBarLabel = useCallback((props: { x: number; y: number; width: number; value: number; fill: string }) => {
    const { x, y, width, value, fill } = props;

    // 如果值为0或太小，不显示标签
    if (!value || value < 1) return null;

    // 格式化显示：大于1000显示为 1.2k，否则显示整数
    let displayValue: string;
    if (value >= 1000) {
      displayValue = (value / 1000).toFixed(1) + 'k';
    } else {
      displayValue = Math.round(value).toString();
    }

    const labelX = x + width / 2;
    const labelY = y - 25; // 标签显示在柱子上方
    const lineY = y - 5; // 引导线终点
    const padding = 4;
    const textWidth = displayValue.length * 6.5; // 估算文本宽度
    const bgWidth = textWidth + padding * 2;
    const bgHeight = 16;

    return (
      <g>
        {/* 引导线：从标签底部到柱子顶部 */}
        <line
          x1={labelX}
          y1={labelY + bgHeight / 2}
          x2={labelX}
          y2={lineY}
          stroke={fill}
          strokeWidth={1}
        />
        {/* 背景矩形：与柱子同色 */}
        <rect
          x={labelX - bgWidth / 2}
          y={labelY - bgHeight / 2}
          width={bgWidth}
          height={bgHeight}
          fill={fill}
          rx={3}
          ry={3}
        />
        {/* 文本标签 */}
        <text
          x={labelX}
          y={labelY}
          fill="#fff"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          fontWeight="bold"
        >
          {displayValue}
        </text>
      </g>
    );
  }, []);

  // 创建带颜色的折线图标签函数（同一X位置不同Y值的标签左右交替）
  // 支持相同值的多个店铺显示不同标签，超过3个点时增加垂直偏移
  const createLineLabel = useCallback(
    (lineColor: string, shopKey: string) => {
      return (props: { x: number; y: number; value: number; index: number }) => {
        const { x, y, value, index } = props;

        // 如果值为0，不显示标签
        if (!value) return null;

        const padding = 3;
        const textWidth = value.toString().length * 6;
        const bgWidth = textWidth + padding * 2;
        const bgHeight = 14;

        try {
          // 从 chartData 获取当前日期的所有数据点
          const currentDataPoint = chartData[index];
          if (!currentDataPoint) {
            return null;
          }

          // 收集当前日期所有店铺的值（带店铺名）
          const valuesAtSameX: Array<{ shop: string; value: number }> = [];
          Object.keys(currentDataPoint).forEach((key) => {
            if (key !== 'date') {
              const val = currentDataPoint[key];
              if (val && typeof val === 'number' && val > 0) {
                valuesAtSameX.push({ shop: key, value: val });
              }
            }
          });

          // 按值从小到大排序，值相同则按店铺名排序（保证一致性）
          valuesAtSameX.sort((a, b) => {
            if (a.value !== b.value) return a.value - b.value;
            return a.shop.localeCompare(b.shop);
          });

          // 找到当前店铺在排序后的位置（精确匹配店铺+值）
          const sortedIndex = valuesAtSameX.findIndex(
            (item) => item.shop === shopKey && item.value === value
          );

          if (sortedIndex >= 0) {
            // 根据排序后的位置交替左右：0左，1右，2左，3右...
            const offsets = [-25, 25, -40, 40, -55, 55, -70, 70];
            const offsetX = offsets[sortedIndex % offsets.length];

            // 垂直偏移：超过3个点时开始垂直偏移，每4个标签向上移动20px
            const verticalOffset = sortedIndex >= 3 ? Math.floor(sortedIndex / 4) * 20 : 0;

            const labelY = y - 15 - verticalOffset;
            const labelX = x + offsetX;

            return (
              <g>
                {/* 连接线 */}
                <line
                  x1={x}
                  y1={y - 5}
                  x2={labelX}
                  y2={labelY}
                  stroke={lineColor}
                  strokeWidth={0.5}
                  strokeDasharray="2,2"
                />
                {/* 白色背景矩形 */}
                <rect
                  x={labelX - bgWidth / 2}
                  y={labelY - bgHeight / 2}
                  width={bgWidth}
                  height={bgHeight}
                  fill="white"
                  stroke={lineColor}
                  strokeWidth={1}
                  rx={2}
                  ry={2}
                />
                {/* 文本标签 */}
                <text
                  x={labelX}
                  y={labelY}
                  fill={lineColor}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fontWeight="bold"
                >
                  {value}
                </text>
              </g>
            );
          }
        } catch (error) {
          console.error('Label render error:', error);
        }

        // 降级显示：如果排序逻辑失败，简单显示在上方
        return (
          <text
            x={x}
            y={y - 10}
            fill={lineColor}
            textAnchor="middle"
            fontSize={10}
            fontWeight="bold"
          >
            {value}
          </text>
        );
      };
    },
    [chartData]
  );

  return (
    <div>
      <PageTitle icon={<DashboardOutlined />} title="店铺概览" />

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
          <Col flex="2">
            <Card>
              {selectedShop ? (
                (() => {
                  const shop = shops?.data?.find((s: { id: number; shop_name: string; shop_name_cn?: string }) => s.id === selectedShop);
                  return (
                    <Statistic
                      title={shop?.shop_name_cn ? (
                        <span style={{ fontSize: '12px', color: '#999' }}>{shop.shop_name_cn}</span>
                      ) : '当前店铺'}
                      value={shop?.shop_name || '-'}
                      valueRender={(value) => (
                        <Text className={styles.shopNameValue}>{value}</Text>
                      )}
                    />
                  );
                })()
              ) : (
                <Statistic
                  title="店铺数"
                  value={shops?.data?.length || 0}
                  prefix={<ShoppingOutlined />}
                />
              )}
            </Card>
          </Col>
          <Col flex="1">
            <Card>
              <Statistic
                title="当前余额"
                value={Math.round(stats.balance.total_rub)}
                precision={0}
                prefix={<WalletOutlined />}
                suffix={<span>₽ <span style={{ fontSize: '14px', color: '#ff4d4f' }}>(≈ ¥{Math.round(stats.balance.total_cny).toLocaleString('zh-CN')})</span></span>}
              />
            </Card>
          </Col>
          <Col flex="1">
            <Card>
              <Statistic
                title="总商品数"
                value={stats.products.total}
                prefix={<ShoppingOutlined />}
              />
            </Card>
          </Col>
          <Col flex="1">
            <Card>
              <Statistic
                title="待处理订单"
                value={stats.orders.pending}
                prefix={<ShoppingOutlined />}
              />
            </Card>
          </Col>
          <Col flex="1">
            <Card>
              <Statistic
                title="昨日销售额"
                value={parseFloat(stats.revenue.yesterday.toString())}
                precision={2}
                prefix={currencySymbol}
              />
            </Card>
          </Col>
        </Row>

        {/* 统一时间范围选择器 */}
        <Card className={styles.filterCard}>
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
            {!selectedShop && (
              <>
                <Text strong style={{ marginLeft: 16 }}>显示模式：</Text>
                <Select
                  value={displayMode}
                  onChange={setDisplayMode}
                  style={{ width: 120 }}
                  options={[
                    { label: '单店显示', value: 'single' },
                    { label: '汇总显示', value: 'total' },
                  ]}
                />
              </>
            )}
          </Space>
        </Card>

        {/* 每日Posting统计趋势图 */}
        <Card
          title={
            <Space>
              <LineChartOutlined />
              <span>每日订单统计趋势</span>
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
              <LineChart data={chartData} margin={{ top: 30, right: 80, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 12 }}
                />
                <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.1)]} />
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
                    label={createLineLabel(CHART_COLORS[0], dateRangeLabel)}
                  />
                ) : (
                  // 单店模式：显示各店铺的线（带数值标签）
                  dailyStatsData?.shops.map((shop, index) => (
                    <Line
                      key={shop}
                      type="monotone"
                      dataKey={shop}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      label={createLineLabel(CHART_COLORS[index % CHART_COLORS.length], shop)}
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

        {/* 每日销售额统计趋势图 */}
        <Card
          title={
            <Space>
              <LineChartOutlined />
              <span>每日销售额统计趋势</span>
            </Space>
          }
          className={styles.chartCard}
        >
          {isDailyStatsLoading ? (
            <div className={styles.chartLoading}>
              <Spin size="large" />
            </div>
          ) : revenueChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={revenueChartData} margin={{ top: 40, right: 80, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 12 }}
                />
                <YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.15)]} />
                <Tooltip content={<RevenueTooltip />} />
                <Legend />
                {displayMode === 'total' && !selectedShop ? (
                  // 汇总模式：只显示一条总计柱（红色）
                  <Bar
                    key="total"
                    dataKey={dateRangeLabel}
                    fill="#f5222d"
                    radius={[4, 4, 0, 0]}
                    label={renderBarLabel}
                  />
                ) : (
                  // 单店模式：显示各店铺的柱（多种颜色）
                  dailyStatsData?.shops.map((shop, index) => (
                    <Bar
                      key={shop}
                      dataKey={shop}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                      radius={[4, 4, 0, 0]}
                      label={renderBarLabel}
                    />
                  ))
                )}
              </BarChart>
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
