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

import ShopSelector from '@/components/ozon/ShopSelector';
import { formatRMB } from '../../utils/currency';
import { optimizeOzonImageUrl } from '../../utils/ozonImageOptimizer';
import * as ozonApi from '@/services/ozonApi';
import styles from './OrderReport.module.scss';

const { Title, Text } = Typography;
const { Option } = Select;

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
      fixed: 'left',
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
    // 2. 商品信息列（3行垂直布局）
    {
      title: '商品信息',
      width: 220,
      render: (_, row) => (
        <div className={styles.productInfo}>
          <div className={styles.date}>
            {dayjs(row.posting.created_at).format('MM-DD')}
          </div>
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
    // 3. 货件编号（rowSpan）
    {
      title: '货件编号',
      width: 150,
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: (
            <span
              className={styles.copyableText}
              onClick={() => handleCopy(row.posting.posting_number)}
            >
              {row.posting.posting_number} <CopyOutlined />
            </span>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 4. 订单金额（rowSpan）
    {
      title: '订单金额',
      width: 100,
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
      width: 100,
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
      width: 100,
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
      width: 100,
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
      width: 100,
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
      width: 100,
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
      width: 100,
      align: 'right',
      fixed: 'right',
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
      width: 100,
      align: 'right',
      fixed: 'right',
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
                  scroll={{ x: 1600, y: 600 }}
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

            {/* 订单汇总Tab - 占位符，后续实现 */}
            <Tabs.TabPane tab="订单汇总" key="summary">
              <Spin spinning={isLoadingSummary}>
                <div>订单汇总功能开发中...</div>
              </Spin>
            </Tabs.TabPane>
          </Tabs>
        )}
      </Card>
    </div>
  );
};

export default OrderReport;
