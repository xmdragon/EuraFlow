/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ozon 订单报表页面 - 重构版
 * 支持Posting级别展示、双Tab（订单明细+订单汇总）、图表分析
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Button,
  Select,
  message,
  Spin,
  Typography,
  Divider,
  Tabs,
  Avatar,
  Popover,
  Pagination,
} from 'antd';
import {
  DollarOutlined,
  ShoppingCartOutlined,
  PercentageOutlined,
  RiseOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import ShopSelector from '@/components/ozon/ShopSelector';
import { formatRMB } from '../../utils/currency';
import { optimizeOzonImageUrl } from '../../utils/ozonImageOptimizer';
import * as ozonApi from '@/services/ozonApi';
import styles from './OrderReport.module.scss';

const { Title, Text } = Typography;
const { Option } = Select;

// 图表颜色配置
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF6B6B', '#4ECDC4', '#45B7D1'];

// ===== 类型定义 =====

interface ProductInPosting {
  sku: string;
  offer_id?: string;
  name: string;
  quantity: number;
  price: string;
  image_url?: string;
}

interface PostingReportItem {
  posting_number: string;
  shop_name: string;
  status: string;
  created_at: string;
  products: ProductInPosting[];
  order_amount: string;
  purchase_price: string;
  ozon_commission_cny: string;
  international_logistics_fee_cny: string;
  last_mile_delivery_fee_cny: string;
  material_cost: string;
  profit: string;
  profit_rate: number;
}

interface PostingItemRow {
  key: string;
  product: ProductInPosting;
  productIndex: number;
  posting: PostingReportItem;
  isFirstItem: boolean;
  itemCount: number;
}

interface ReportSummary {
  statistics: {
    total_sales: string;
    total_purchase: string;
    total_commission: string;
    total_logistics: string;
    total_cost: string;
    total_profit: string;
    profit_rate: number;
    order_count: number;
  };
  cost_breakdown: Array<{ name: string; value: number }>;
  shop_breakdown: Array<{ shop_name: string; sales: number; profit: number }>;
  daily_trend: Array<{ date: string; sales: number; profit: number }>;
  previous_month: {
    total_sales: string;
    total_profit: string;
    profit_rate: number;
  };
  top_products: Array<{
    offer_id: string;
    name: string;
    sku: string;
    sales: number;
    quantity: number;
    profit: number;
    image_url?: string;
  }>;
}

// ===== 主组件 =====

const OrderReport: React.FC = () => {
  // ===== 状态管理 =====
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [selectedShops, setSelectedShops] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<'delivered' | 'placed'>('delivered');
  const [activeTab, setActiveTab] = useState<string>('details');

  // 分页状态（仅用于订单明细Tab）
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // ===== 数据查询 =====

  // 查询posting级别报表数据（仅在订单明细Tab激活时查询）
  const { data: postingReportData, isLoading: isLoadingPostings, refetch: refetchPostings } = useQuery({
    queryKey: ['ozonPostingReport', selectedMonth, selectedShops, statusFilter, page, pageSize],
    queryFn: async () => {
      const shopIds = selectedShops.length > 0 ? selectedShops.join(',') : undefined;
      return await ozonApi.getPostingReport(selectedMonth, shopIds, statusFilter, page, pageSize);
    },
    enabled: selectedShops.length > 0 && activeTab === 'details',
    retry: 1,
    staleTime: 2 * 60 * 1000, // 2分钟缓存
  });

  // 查询报表汇总数据（仅在订单汇总Tab激活时查询）
  const { data: summaryData, isLoading: isLoadingSummary, refetch: refetchSummary } = useQuery<ReportSummary>({
    queryKey: ['ozonReportSummary', selectedMonth, selectedShops, statusFilter],
    queryFn: async () => {
      const shopIds = selectedShops.length > 0 ? selectedShops.join(',') : undefined;
      return await ozonApi.getReportSummary(selectedMonth, shopIds, statusFilter);
    },
    enabled: selectedShops.length > 0 && activeTab === 'summary',
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });

  // ===== 工具函数 =====

  // 生成月份选项（最近12个月）
  const generateMonthOptions = () => {
    const options = [];
    const now = dayjs();
    for (let i = 0; i < 12; i++) {
      const month = now.subtract(i, 'month');
      options.push({
        label: month.format('YYYY年MM月'),
        value: month.format('YYYY-MM'),
      });
    }
    return options;
  };

  // 复制文本到剪贴板
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  };

  // ===== 订单明细Tab数据处理 =====

  // 将posting数据转换为item行数据（类似PackingShipment的模式）
  const postingItemRows = useMemo<PostingItemRow[]>(() => {
    if (!postingReportData?.data) return [];

    const rows: PostingItemRow[] = [];
    postingReportData.data.forEach((posting: PostingReportItem) => {
      const products = posting.products || [];
      const itemCount = products.length;

      products.forEach((product, index) => {
        rows.push({
          key: `${posting.posting_number}_${index}`,
          product: product,
          productIndex: index,
          posting: posting,
          isFirstItem: index === 0,
          itemCount: itemCount,
        });
      });
    });

    return rows;
  }, [postingReportData]);

  // ===== 订单明细Tab - 表格列定义 =====

  const detailColumns: ColumnsType<PostingItemRow> = [
    // 1. 图片列
    {
      title: '图片',
      width: 80,
      render: (_, row) => {
        const imageUrl80 = optimizeOzonImageUrl(row.product.image_url, 80);
        const imageUrl160 = optimizeOzonImageUrl(row.product.image_url, 160);

        return (
          <Popover
            content={<img src={imageUrl160} width={160} alt="商品预览" />}
            trigger="hover"
          >
            <Avatar src={imageUrl80} size={80} shape="square" />
          </Popover>
        );
      },
    },
    // 2. 商品信息列（2行垂直布局）
    {
      title: '商品信息',
      render: (_, row) => (
        <div className={styles.productInfo}>
          <div className={styles.shopName}>{row.posting.shop_name}</div>
          <div className={styles.productLine}>
            <Text ellipsis={{ tooltip: row.product.name }} style={{ flex: 1 }}>
              {row.product.name?.substring(0, 20) || '-'}
            </Text>
            <span
              className={styles.sku}
              onClick={() => handleCopy(row.product.sku)}
            >
              {row.product.sku} <CopyOutlined />
            </span>
          </div>
        </div>
      ),
    },
    // 3. 货件编号（rowSpan，包含日期）
    {
      title: '货件编号',
      width: '12%',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: (
            <div className={styles.postingInfo}>
              <div className={styles.date}>
                {dayjs(row.posting.created_at).format('MM-DD')}
              </div>
              <span
                className={styles.copyableText}
                onClick={() => handleCopy(row.posting.posting_number)}
              >
                {row.posting.posting_number} <CopyOutlined />
              </span>
            </div>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 4. 订单金额（rowSpan）
    {
      title: '订单金额',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.order_amount,
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 5. 进货金额（rowSpan）
    {
      title: '进货金额',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.purchase_price || '-',
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 6. Ozon佣金（rowSpan）
    {
      title: 'Ozon佣金',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.ozon_commission_cny || '-',
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 7. 国际物流（rowSpan）
    {
      title: '国际物流',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.international_logistics_fee_cny || '-',
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 8. 尾程派送（rowSpan）
    {
      title: '尾程派送',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.last_mile_delivery_fee_cny || '-',
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 9. 打包费用（rowSpan）
    {
      title: '打包费用',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.material_cost || '-',
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 10. 利润金额（rowSpan）
    {
      title: '利润金额',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        const profit = parseFloat(row.posting.profit || '0');
        return {
          children: (
            <span className={`${styles.profitCell} ${profit >= 0 ? styles.positive : styles.negative}`}>
              {row.posting.profit}
            </span>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 11. 利润比率（rowSpan）
    {
      title: '利润比率',
      width: '8%',
      align: 'right',
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        const profitRate = row.posting.profit_rate;
        return {
          children: (
            <span className={`${styles.profitCell} ${profitRate >= 0 ? styles.positive : styles.negative}`}>
              {profitRate.toFixed(2)}%
            </span>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
  ];

  // ===== 渲染 =====

  return (
    <div>
      <Card className={styles.mainCard}>
        <Title level={4}>订单报表</Title>

        {/* 筛选区域 */}
        <Row gutter={16} className={styles.filterRow}>
          <Col span={6}>
            <label className={styles.filterLabel}>选择月份：</label>
            <Select
              value={selectedMonth}
              onChange={setSelectedMonth}
              className={styles.filterSelect}
              options={generateMonthOptions()}
            />
          </Col>
          <Col span={8}>
            <label className={styles.filterLabel}>选择店铺：</label>
            <ShopSelector
              value={selectedShops}
              onChange={(value) => {
                if (Array.isArray(value)) {
                  setSelectedShops(value as number[]);
                } else if (value === null) {
                  setSelectedShops([]);
                } else {
                  setSelectedShops([value as number]);
                }
              }}
              mode="multiple"
              placeholder="请选择店铺"
              className={styles.filterSelect}
              showAllOption={false}
            />
          </Col>
          <Col span={6}>
            <label className={styles.filterLabel}>订单状态：</label>
            <Select
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1); // 重置页码
              }}
              className={styles.filterSelect}
            >
              <Option value="delivered">已签收</Option>
              <Option value="placed">已下订</Option>
            </Select>
          </Col>
          <Col span={4}>
            <label className={styles.filterLabel}>&nbsp;</label>
            <Button
              type="primary"
              onClick={() => {
                if (activeTab === 'details') {
                  refetchPostings();
                } else {
                  refetchSummary();
                }
              }}
            >
              查询
            </Button>
          </Col>
        </Row>

        {/* 提示信息 */}
        {selectedShops.length === 0 && (
          <div className={styles.emptyHint}>
            请选择店铺后查看报表数据
          </div>
        )}

        {/* Tab切换 */}
        {selectedShops.length > 0 && (
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              // 切换Tab时重置分页
              if (key === 'details') {
                setPage(1);
              }
            }}
            className={styles.reportTabs}
          >
            {/* 订单明细Tab */}
            <Tabs.TabPane tab="订单明细" key="details">
              <Spin spinning={isLoadingPostings}>
                <Table
                  dataSource={postingItemRows}
                  columns={detailColumns}
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  loading={isLoadingPostings}
                />

                {/* 独立分页组件 */}
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  <Pagination
                    current={page}
                    pageSize={pageSize}
                    total={postingReportData?.total || 0}
                    pageSizeOptions={[50, 100]}
                    onChange={(newPage, newPageSize) => {
                      setPage(newPage);
                      setPageSize(newPageSize || 50);
                    }}
                    showTotal={(total) => `共 ${total} 条货件`}
                    showSizeChanger
                  />
                </div>
              </Spin>
            </Tabs.TabPane>

            {/* 订单汇总Tab */}
            <Tabs.TabPane tab="订单汇总" key="summary">
              <Spin spinning={isLoadingSummary}>
                {summaryData && (
                  <>
                    {/* 统计卡片行 */}
                    <Row gutter={16} className={styles.summaryCards}>
                      <Col span={4}>
                        <Card className={styles.statSales}>
                          <Statistic
                            title="销售总额"
                            value={summaryData.statistics.total_sales}
                            prefix="¥"
                            precision={2}
                            valueStyle={{ color: '#1890ff' }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card className={styles.statPurchase}>
                          <Statistic
                            title="进货总额"
                            value={summaryData.statistics.total_purchase}
                            prefix="¥"
                            precision={2}
                            valueStyle={{ color: '#faad14' }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card className={styles.statCost}>
                          <Statistic
                            title="费用总额"
                            value={summaryData.statistics.total_cost}
                            prefix="¥"
                            precision={2}
                            valueStyle={{ color: '#ff7875' }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card className={`${styles.statProfit} ${parseFloat(summaryData.statistics.total_profit) >= 0 ? styles.positive : styles.negative}`}>
                          <Statistic
                            title="利润总额"
                            value={summaryData.statistics.total_profit}
                            prefix="¥"
                            precision={2}
                            valueStyle={{ color: parseFloat(summaryData.statistics.total_profit) >= 0 ? '#52c41a' : '#ff4d4f' }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card className={`${styles.statProfitRate} ${summaryData.statistics.profit_rate >= 0 ? styles.positive : styles.negative}`}>
                          <Statistic
                            title="利润率"
                            value={summaryData.statistics.profit_rate}
                            suffix="%"
                            precision={2}
                            prefix={summaryData.statistics.profit_rate >= 0 ? <RiseOutlined /> : null}
                            valueStyle={{ color: summaryData.statistics.profit_rate >= 0 ? '#52c41a' : '#ff4d4f' }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card>
                          <Statistic
                            title="订单总数"
                            value={summaryData.statistics.order_count}
                            prefix={<ShoppingCartOutlined />}
                          />
                        </Card>
                      </Col>
                    </Row>

                    <Divider />

                    {/* 图表行 */}
                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      {/* 饼图：成本分解（单店铺）或店铺销售（多店铺） */}
                      <Col span={12}>
                        <Card title={selectedShops.length === 1 ? "成本构成" : "店铺销售占比"} className={styles.chartCard}>
                          <div className={styles.chartContainer}>
                            {selectedShops.length === 1 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={summaryData.cost_breakdown}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label
                                  >
                                    {summaryData.cost_breakdown.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                  </Pie>
                                  <RechartsTooltip formatter={(value: any) => `¥${parseFloat(value).toFixed(2)}`} />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={summaryData.shop_breakdown}
                                    dataKey="sales"
                                    nameKey="shop_name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label
                                  >
                                    {summaryData.shop_breakdown.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                  </Pie>
                                  <RechartsTooltip formatter={(value: any) => `¥${parseFloat(value).toFixed(2)}`} />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </Card>
                      </Col>

                      {/* 饼图：店铺利润占比（仅多店铺） */}
                      {selectedShops.length > 1 && (
                        <Col span={12}>
                          <Card title="店铺利润占比" className={styles.chartCard}>
                            <div className={styles.chartContainer}>
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={summaryData.shop_breakdown}
                                    dataKey="profit"
                                    nameKey="shop_name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label
                                  >
                                    {summaryData.shop_breakdown.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                  </Pie>
                                  <RechartsTooltip formatter={(value: any) => `¥${parseFloat(value).toFixed(2)}`} />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      )}

                      {/* 单店铺时，第二个位置显示月度对比 */}
                      {selectedShops.length === 1 && (
                        <Col span={12}>
                          <Card title="月度对比" className={styles.chartCard}>
                            <div className={styles.chartContainer}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[
                                    {
                                      month: '上月',
                                      sales: parseFloat(summaryData.previous_month.total_sales),
                                      profit: parseFloat(summaryData.previous_month.total_profit),
                                    },
                                    {
                                      month: '本月',
                                      sales: parseFloat(summaryData.statistics.total_sales),
                                      profit: parseFloat(summaryData.statistics.total_profit),
                                    },
                                  ]}
                                >
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="month" />
                                  <YAxis />
                                  <RechartsTooltip formatter={(value: any) => `¥${value.toFixed(2)}`} />
                                  <Legend />
                                  <Bar dataKey="sales" fill="#1890ff" name="销售额" />
                                  <Bar dataKey="profit" fill="#52c41a" name="利润" />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      )}
                    </Row>

                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      {/* 每日销售趋势 */}
                      <Col span={24}>
                        <Card title="每日销售趋势" className={styles.chartCard}>
                          <div className={styles.chartContainer}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={summaryData.daily_trend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis />
                                <RechartsTooltip formatter={(value: any) => `¥${parseFloat(value).toFixed(2)}`} />
                                <Legend />
                                <Line type="monotone" dataKey="sales" stroke="#1890ff" name="销售额" />
                                <Line type="monotone" dataKey="profit" stroke="#52c41a" name="利润" />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      </Col>
                    </Row>

                    {/* 多店铺时，额外显示月度对比 */}
                    {selectedShops.length > 1 && (
                      <Row gutter={16} style={{ marginBottom: 24 }}>
                        <Col span={24}>
                          <Card title="月度对比" className={styles.chartCard}>
                            <div className={styles.chartContainer}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[
                                    {
                                      month: '上月',
                                      sales: parseFloat(summaryData.previous_month.total_sales),
                                      profit: parseFloat(summaryData.previous_month.total_profit),
                                    },
                                    {
                                      month: '本月',
                                      sales: parseFloat(summaryData.statistics.total_sales),
                                      profit: parseFloat(summaryData.statistics.total_profit),
                                    },
                                  ]}
                                >
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="month" />
                                  <YAxis />
                                  <RechartsTooltip formatter={(value: any) => `¥${value.toFixed(2)}`} />
                                  <Legend />
                                  <Bar dataKey="sales" fill="#1890ff" name="销售额" />
                                  <Bar dataKey="profit" fill="#52c41a" name="利润" />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      </Row>
                    )}

                    {/* TOP10商品 */}
                    <Card title="TOP10 商品" style={{ marginBottom: 24 }}>
                      <Table
                        dataSource={summaryData.top_products}
                        pagination={false}
                        rowKey="offer_id"
                        columns={[
                          {
                            title: '图片',
                            width: 80,
                            render: (_, record) => (
                              <Avatar
                                src={optimizeOzonImageUrl(record.image_url, 200)}
                                size={60}
                                shape="square"
                              />
                            ),
                          },
                          {
                            title: '商品名称',
                            dataIndex: 'name',
                            ellipsis: true,
                          },
                          {
                            title: 'SKU',
                            dataIndex: 'sku',
                            width: 120,
                          },
                          {
                            title: '销售额',
                            dataIndex: 'sales',
                            width: 120,
                            align: 'right',
                            render: (value) => `¥${parseFloat(value).toFixed(2)}`,
                          },
                          {
                            title: '销量',
                            dataIndex: 'quantity',
                            width: 80,
                            align: 'right',
                          },
                          {
                            title: '利润',
                            dataIndex: 'profit',
                            width: 120,
                            align: 'right',
                            render: (value) => {
                              const profit = parseFloat(value);
                              return (
                                <span style={{ color: profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
                                  ¥{profit.toFixed(2)}
                                </span>
                              );
                            },
                          },
                        ]}
                      />
                    </Card>
                  </>
                )}
              </Spin>
            </Tabs.TabPane>
          </Tabs>
        )}
      </Card>
    </div>
  );
};

export default OrderReport;
