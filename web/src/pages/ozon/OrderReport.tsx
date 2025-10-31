/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ozon 订单报表页面 - 重构版
 * 支持Posting级别展示、双Tab（订单明细+订单汇总）、图表分析
 */
import {
  ShoppingCartOutlined,
  RiseOutlined,
  CopyOutlined,
  UpOutlined,
  DownOutlined,
  LinkOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Button,
  Select,
  Spin,
  Typography,
  Tabs,
  Space,
  Input,
  Divider,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import React, { useState, useEffect, useMemo } from "react";
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
} from "recharts";

import styles from "./OrderReport.module.scss";

import OrderDetailModal from "@/components/ozon/OrderDetailModal";
import ProductImage from "@/components/ozon/ProductImage";
import ShopSelectorWithLabel from "@/components/ozon/ShopSelectorWithLabel";
import PageTitle from "@/components/PageTitle";
import { ORDER_STATUS_CONFIG } from "@/config/ozon/orderStatusConfig";
import { useCopy } from "@/hooks/useCopy";
import { useCurrency } from "@/hooks/useCurrency";
import * as ozonApi from "@/services/ozonApi";
import { notifySuccess, notifyError } from "@/utils/notification";

const { Text } = Typography;
const { Option } = Select;

// 图表颜色配置
const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
  "#82CA9D",
  "#FFC658",
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
];

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
  in_process_at?: string;
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
  top_products_by_sales: Array<{
    offer_id: string;
    name: string;
    sku: string;
    sales: number;
    quantity: number;
    profit: number;
    image_url?: string;
  }>;
  top_products_by_quantity: Array<{
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
  const { copyToClipboard } = useCopy();

  // ===== 状态管理 =====
  const [selectedMonth, setSelectedMonth] = useState(
    dayjs().subtract(1, "month").format("YYYY-MM"),
  );
  const [selectedShop, setSelectedShop] = useState<number | null>(null); // null表示"全部"
  const [statusFilter, setStatusFilter] = useState<"delivered" | "placed">(
    "delivered",
  );
  const [postingNumber, setPostingNumber] = useState<string>(""); // posting_number筛选
  const [activeTab, setActiveTab] = useState<string>("details");

  // 分页状态（用于无限滚动）
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [hasMore, setHasMore] = useState(true);
  const [allLoadedData, setAllLoadedData] = useState<any[]>([]); // 累积所有已加载数据

  // 排序状态
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // 详情Modal状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 货币和状态配置
  const { currency: userCurrency } = useCurrency();
  const statusConfig = ORDER_STATUS_CONFIG;

  // offer_id到图片的映射，从报表数据中提取
  const offerIdImageMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (postingReportData?.data) {
      postingReportData.data.forEach((posting: PostingReportItem) => {
        posting.products.forEach((product: ProductInPosting) => {
          if (product.offer_id && product.image_url) {
            map[product.offer_id] = product.image_url;
          }
        });
      });
    }
    return map;
  }, [postingReportData]);

  // 格式化配送方式文本（用于白色背景显示）
  const formatDeliveryMethodTextWhite = (text: string | undefined): React.ReactNode => {
    if (!text) return '-';

    // 如果包含括号，提取括号内的内容
    const match = text.match(/^(.+?)[\(（](.+?)[\)）]$/);
    if (!match) return text;

    const mainPart = match[1].trim();
    const detailPart = match[2].trim();

    // 解析限制信息为三行：重量、价格、体积
    const parseRestrictions = (restriction: string): string[] => {
      // 移除"限制:"前缀
      const content = restriction.replace(/^限制[:：]\s*/, '');

      // 使用正则提取三个部分
      const parts: string[] = [];
      const weightMatch = content.match(/重量[:：\s]*([^，,]+)/);
      const priceMatch = content.match(/价格[:：\s]*([^，,]+)/);
      const volumeMatch = content.match(/体积[:：\s]*(.+)$/);

      if (weightMatch) parts.push(weightMatch[1].trim());
      if (priceMatch) parts.push(priceMatch[1].trim());
      if (volumeMatch) parts.push(volumeMatch[1].trim());

      return parts;
    };

    const restrictions = parseRestrictions(detailPart);

    return (
      <div>
        <div>{mainPart}</div>
        {restrictions.map((line, idx) => (
          <div key={idx} style={{ fontSize: '12px', color: '#666' }}>
            {line}
          </div>
        ))}
      </div>
    );
  };

  // ===== 数据查询 =====

  // 查询posting级别报表数据（仅在订单明细Tab激活时查询）
  const {
    data: postingReportData,
    isLoading: isLoadingPostings,
    refetch: refetchPostings,
    isFetching,
  } = useQuery({
    queryKey: [
      "ozonPostingReport",
      selectedMonth,
      selectedShop,
      statusFilter,
      postingNumber,
      page,
      pageSize,
      sortBy,
      sortOrder,
    ],
    queryFn: async () => {
      const shopIds =
        selectedShop !== null ? selectedShop.toString() : undefined;
      // 如果posting_number是"数字-数字"格式，自动添加通配符
      let processedPostingNumber = postingNumber || undefined;
      if (postingNumber && /^\d+-\d+$/.test(postingNumber.trim())) {
        processedPostingNumber = postingNumber.trim() + '-%';
      }
      return await ozonApi.getPostingReport(
        selectedMonth,
        shopIds,
        statusFilter,
        page,
        pageSize,
        sortBy,
        sortOrder,
        processedPostingNumber,
      );
    },
    enabled: activeTab === "details",
    retry: 1,
    staleTime: 2 * 60 * 1000, // 2分钟缓存
  });

  // 监听页面滚动以实现无限滚动
  useEffect(() => {
    if (activeTab !== "details") return;

    const handleScroll = () => {
      // 检测滚动到底部（留300px缓冲区）
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;

      if (scrollHeight - scrollTop - clientHeight < 300) {
        if (!isFetching && hasMore) {
          setPage((prev) => prev + 1);
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [activeTab, isFetching, hasMore]);

  // 当数据返回时，累积到allLoadedData
  useEffect(() => {
    if (postingReportData?.data) {
      if (page === 1) {
        // 第一页：重置数据
        setAllLoadedData(postingReportData.data);
      } else {
        // 后续页：追加数据
        setAllLoadedData((prev) => [...prev, ...postingReportData.data]);
      }
      // 检查是否还有更多数据
      setHasMore(page < (postingReportData.total_pages || 1));
    }
  }, [postingReportData, page]);

  // 查询报表汇总数据（仅在订单汇总Tab激活时查询）
  const {
    data: summaryData,
    isLoading: isLoadingSummary,
    refetch: refetchSummary,
  } = useQuery<ReportSummary>({
    queryKey: ["ozonReportSummary", selectedMonth, selectedShop, statusFilter],
    queryFn: async () => {
      const shopIds =
        selectedShop !== null ? selectedShop.toString() : undefined;
      return await ozonApi.getReportSummary(
        selectedMonth,
        shopIds,
        statusFilter,
      );
    },
    enabled: activeTab === "summary",
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });

  // ===== 工具函数 =====

  // 生成月份选项（最近12个月）
  const generateMonthOptions = () => {
    const options = [];
    const now = dayjs();
    for (let i = 0; i < 12; i++) {
      const month = now.subtract(i, "month");
      options.push({
        label: month.format("YYYY年MM月"),
        value: month.format("YYYY-MM"),
      });
    }
    return options;
  };

  // 打开OZON商品链接
  const openProductLink = (sku: string) => {
    const url = `https://www.ozon.ru/product/${sku}/`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // 打开货件详情Modal - 调用 API 获取完整订单数据
  const showPostingDetail = async (postingNumber: string, shopId?: number) => {
    try {
      setLoadingDetail(true);
      const response = await ozonApi.getOrderDetail(postingNumber, shopId);

      // response.data 应该包含完整的订单信息
      if (response.data) {
        const orderData = response.data;
        // 找到对应的 posting
        const posting = orderData.postings?.find(p => p.posting_number === postingNumber);

        setSelectedOrder(orderData);
        setSelectedPosting(posting || null);
        setDetailModalVisible(true);
      }
    } catch (error) {
      notifyError('加载失败', '无法加载订单详情');
    } finally {
      setLoadingDetail(false);
    }
  };

  // ===== 订单明细Tab数据处理 =====

  // 将posting数据转换为item行数据（类似PackingShipment的模式）
  const postingItemRows = useMemo<PostingItemRow[]>(() => {
    if (!allLoadedData || allLoadedData.length === 0) return [];

    const rows: PostingItemRow[] = [];
    allLoadedData.forEach((posting: PostingReportItem) => {
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
  }, [allLoadedData]);

  // ===== 订单明细Tab - 表格列定义 =====

  const detailColumns: ColumnsType<PostingItemRow> = [
    // 1. 图片列
    {
      title: "图片",
      width: 80,
      render: (_, row) => (
        <ProductImage
          imageUrl={row.product.image_url}
          size="small"
          hoverBehavior="medium"
          name={row.product.name}
        />
      ),
    },
    // 2. 商品信息列（3行垂直布局）
    {
      title: "商品信息",
      render: (_, row) => (
        <div className={styles.productInfo}>
          <div className={styles.shopName}>{row.posting.shop_name}</div>
          <div className={styles.productName}>
            <Text
              ellipsis={{
                tooltip:
                  row.product.name && row.product.name.length > 50
                    ? row.product.name
                    : undefined,
              }}
            >
              {row.product.name && row.product.name.length > 50
                ? row.product.name.substring(0, 50) + "..."
                : row.product.name || "-"}
            </Text>
          </div>
          <div className={styles.skuContainer}>
            <span
              className={styles.skuLink}
              onClick={() => openProductLink(row.product.sku)}
            >
              {row.product.sku} <LinkOutlined />
            </span>
            <CopyOutlined
              className={styles.copyIcon}
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(row.product.sku, 'SKU');
              }}
            />
          </div>
        </div>
      ),
    },
    // 3. 货件编号（rowSpan，包含日期）
    {
      title: "货件编号",
      width: "12%",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: (
            <div className={styles.postingInfo}>
              <div className={styles.date}>
                {dayjs(row.posting.created_at).format("MM-DD")}
              </div>
              <div className={styles.postingNumberContainer}>
                <span
                  className={styles.postingNumberLink}
                  onClick={() => showPostingDetail(row.posting.posting_number, selectedShop || undefined)}
                >
                  {row.posting.posting_number}
                </span>
                <CopyOutlined
                  className={styles.copyIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(row.posting.posting_number, 'Posting号');
                  }}
                />
              </div>
            </div>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 4. 订单金额（rowSpan）
    {
      title: "订单金额",
      width: "8%",
      align: "right",
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
      title: "进货金额",
      width: "8%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.purchase_price || "-",
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 6. Ozon佣金（rowSpan）
    {
      title: "Ozon佣金",
      width: "8%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.ozon_commission_cny || "-",
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 7. 国际物流（rowSpan）
    {
      title: "国际物流",
      width: "8%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.international_logistics_fee_cny || "-",
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 8. 尾程派送（rowSpan）
    {
      title: "尾程派送",
      width: "8%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.last_mile_delivery_fee_cny || "-",
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 9. 打包费用（rowSpan）
    {
      title: "打包费用",
      width: "8%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        return {
          children: row.posting.material_cost || "-",
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 10. 利润金额（rowSpan）
    {
      title: "利润金额",
      width: "8%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        const profit = parseFloat(row.posting.profit || "0");
        return {
          children: (
            <span
              className={`${styles.profitCell} ${profit >= 0 ? styles.positive : styles.negative}`}
            >
              {row.posting.profit}
            </span>
          ),
          props: { rowSpan: row.itemCount },
        };
      },
    },
    // 11. 利润比率（rowSpan，带排序）
    {
      title: () => (
        <div className={styles.profitRateHeader}>
          <span>利润比率</span>
          <span className={styles.sortIcons}>
            <UpOutlined
              className={`${styles.sortIcon} ${sortBy === "profit_rate" && sortOrder === "asc" ? styles.active : ""}`}
              onClick={() => {
                setSortBy("profit_rate");
                setSortOrder("asc");
                setPage(1);
                setAllLoadedData([]);
              }}
            />
            <DownOutlined
              className={`${styles.sortIcon} ${sortBy === "profit_rate" && sortOrder === "desc" ? styles.active : ""}`}
              onClick={() => {
                setSortBy("profit_rate");
                setSortOrder("desc");
                setPage(1);
                setAllLoadedData([]);
              }}
            />
          </span>
        </div>
      ),
      width: "10%",
      align: "right",
      render: (_, row) => {
        if (!row.isFirstItem) return null;
        const profitRate = row.posting.profit_rate;
        return {
          children: (
            <span
              className={`${styles.profitCell} ${profitRate >= 0 ? styles.positive : styles.negative}`}
            >
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
      {/* 页面标题 */}
      <PageTitle icon={<FileTextOutlined />} title="订单报表" />

      <Card className={styles.mainCard}>
        <div className={styles.contentContainer}>
          {/* 筛选区域 */}
          <Row gutter={16} className={styles.filterRow} align="middle">
            <Col>
              <Space>
                <span>选择月份：</span>
                <Select
                  value={selectedMonth}
                  onChange={(value) => {
                    setSelectedMonth(value);
                    setPage(1);
                    setAllLoadedData([]);
                  }}
                  style={{ minWidth: 140 }}
                  options={generateMonthOptions()}
                />
              </Space>
            </Col>
            <Col>
              <ShopSelectorWithLabel
                label="选择店铺"
                value={selectedShop}
                onChange={(value) => {
                  setSelectedShop(value as number | null);
                  setPage(1);
                  setAllLoadedData([]);
                }}
                placeholder="请选择店铺"
                className={styles.shopSelector}
                showAllOption={true}
              />
            </Col>
            <Col>
              <Space>
                <span>订单状态：</span>
                <Select
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value);
                    setPage(1);
                    setAllLoadedData([]);
                  }}
                  style={{ minWidth: 120 }}
                >
                  <Option value="delivered">已签收</Option>
                  <Option value="placed">已下订</Option>
                </Select>
              </Space>
            </Col>
            <Col>
              <Space>
                <span>物流单号：</span>
                <Input
                  value={postingNumber}
                  onChange={(e) => setPostingNumber(e.target.value)}
                  placeholder="输入物流单号"
                  style={{ width: 200 }}
                  allowClear
                  onPressEnter={() => {
                    setPage(1);
                    setAllLoadedData([]);
                    if (activeTab === "details") {
                      refetchPostings();
                    }
                  }}
                />
              </Space>
            </Col>
            <Col>
              <Button
                type="primary"
                onClick={() => {
                  setPage(1);
                  setAllLoadedData([]);
                  if (activeTab === "details") {
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

          {/* Tab切换 */}
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              // 切换Tab时重置页码（保留已加载数据，避免闪烁）
              setPage(1);
            }}
            className={styles.reportTabs}
          >
            {/* 订单明细Tab */}
            <Tabs.TabPane
              tab={`订单明细 (${postingReportData?.total || 0})`}
              key="details"
            >
              <Spin spinning={isLoadingPostings}>
                <Table
                  dataSource={postingItemRows}
                  columns={detailColumns}
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  loading={false}
                />
                {/* 加载更多提示 */}
                {isFetching && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "12px",
                      color: "#666",
                    }}
                  >
                    加载中...
                  </div>
                )}
                {!hasMore && allLoadedData.length > 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "12px",
                      color: "#999",
                    }}
                  >
                    已加载全部数据
                  </div>
                )}
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
                            valueStyle={{ color: "#1890ff" }}
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
                            valueStyle={{ color: "#faad14" }}
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
                            valueStyle={{ color: "#ff7875" }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card
                          className={`${styles.statProfit} ${parseFloat(summaryData.statistics.total_profit) >= 0 ? styles.positive : styles.negative}`}
                        >
                          <Statistic
                            title="利润总额"
                            value={summaryData.statistics.total_profit}
                            prefix="¥"
                            precision={2}
                            valueStyle={{
                              color:
                                parseFloat(
                                  summaryData.statistics.total_profit,
                                ) >= 0
                                  ? "#52c41a"
                                  : "#ff4d4f",
                            }}
                          />
                        </Card>
                      </Col>
                      <Col span={4}>
                        <Card
                          className={`${styles.statProfitRate} ${summaryData.statistics.profit_rate >= 0 ? styles.positive : styles.negative}`}
                        >
                          <Statistic
                            title="利润率"
                            value={summaryData.statistics.profit_rate}
                            suffix="%"
                            precision={2}
                            prefix={
                              summaryData.statistics.profit_rate >= 0 ? (
                                <RiseOutlined />
                              ) : null
                            }
                            valueStyle={{
                              color:
                                summaryData.statistics.profit_rate >= 0
                                  ? "#52c41a"
                                  : "#ff4d4f",
                            }}
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
                    <Row gutter={16} className={styles.chartRowMargin}>
                      {/* 饼图：成本分解（单店铺）或店铺销售（多店铺） */}
                      <Col span={12}>
                        <Card
                          title={
                            selectedShop !== null
                              ? "销售额分解"
                              : "店铺销售占比"
                          }
                          className={styles.chartCard}
                        >
                          <div className={styles.chartContainer}>
                            {selectedShop !== null ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={summaryData.cost_breakdown}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label={(entry) =>
                                      `${Math.round(entry.percent * 100)}%`
                                    }
                                  >
                                    {summaryData.cost_breakdown.map(
                                      (entry, index) => (
                                        <Cell
                                          key={`cell-${index}`}
                                          fill={COLORS[index % COLORS.length]}
                                        />
                                      ),
                                    )}
                                  </Pie>
                                  <RechartsTooltip
                                    formatter={(value) =>
                                      `¥${parseFloat(value).toFixed(2)}`
                                    }
                                  />
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
                                    label={(entry) =>
                                      `${Math.round(entry.percent * 100)}%`
                                    }
                                  >
                                    {summaryData.shop_breakdown.map(
                                      (entry, index) => (
                                        <Cell
                                          key={`cell-${index}`}
                                          fill={COLORS[index % COLORS.length]}
                                        />
                                      ),
                                    )}
                                  </Pie>
                                  <RechartsTooltip
                                    formatter={(value) =>
                                      `¥${parseFloat(value).toFixed(2)}`
                                    }
                                  />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </Card>
                      </Col>

                      {/* 饼图：店铺利润占比（仅多店铺/全部） */}
                      {selectedShop === null && (
                        <Col span={12}>
                          <Card
                            title="店铺利润占比"
                            className={styles.chartCard}
                          >
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
                                    label={(entry) =>
                                      `${Math.round(entry.percent * 100)}%`
                                    }
                                  >
                                    {summaryData.shop_breakdown.map(
                                      (entry, index) => (
                                        <Cell
                                          key={`cell-${index}`}
                                          fill={COLORS[index % COLORS.length]}
                                        />
                                      ),
                                    )}
                                  </Pie>
                                  <RechartsTooltip
                                    formatter={(value) =>
                                      `¥${parseFloat(value).toFixed(2)}`
                                    }
                                  />
                                  <Legend />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      )}

                      {/* 单店铺时，第二个位置显示月度对比 */}
                      {selectedShop !== null && (
                        <Col span={12}>
                          <Card title="月度对比" className={styles.chartCard}>
                            <div className={styles.chartContainer}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[
                                    {
                                      month: "上月",
                                      sales: parseFloat(
                                        summaryData.previous_month.total_sales,
                                      ),
                                      profit: parseFloat(
                                        summaryData.previous_month.total_profit,
                                      ),
                                    },
                                    {
                                      month: "本月",
                                      sales: parseFloat(
                                        summaryData.statistics.total_sales,
                                      ),
                                      profit: parseFloat(
                                        summaryData.statistics.total_profit,
                                      ),
                                    },
                                  ]}
                                >
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="month" />
                                  <YAxis />
                                  <RechartsTooltip
                                    formatter={(value) =>
                                      `¥${value.toFixed(2)}`
                                    }
                                  />
                                  <Legend />
                                  <Bar
                                    dataKey="sales"
                                    fill="#1890ff"
                                    name="销售额"
                                  />
                                  <Bar
                                    dataKey="profit"
                                    fill="#52c41a"
                                    name="利润"
                                  />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      )}
                    </Row>

                    <Row gutter={16} className={styles.chartRowMargin}>
                      {/* 每日销售趋势 */}
                      <Col span={24}>
                        <Card title="每日销售趋势" className={styles.chartCard}>
                          <div className={styles.chartContainer}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={summaryData.daily_trend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis />
                                <RechartsTooltip
                                  formatter={(value) =>
                                    `¥${parseFloat(value).toFixed(2)}`
                                  }
                                />
                                <Legend />
                                <Line
                                  type="monotone"
                                  dataKey="sales"
                                  stroke="#1890ff"
                                  name="销售额"
                                />
                                <Line
                                  type="monotone"
                                  dataKey="profit"
                                  stroke="#52c41a"
                                  name="利润"
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      </Col>
                    </Row>

                    {/* 多店铺/全部时，额外显示月度对比 */}
                    {selectedShop === null && (
                      <Row gutter={16} className={styles.chartRowMargin}>
                        <Col span={24}>
                          <Card title="月度对比" className={styles.chartCard}>
                            <div className={styles.chartContainer}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={[
                                    {
                                      month: "上月",
                                      sales: parseFloat(
                                        summaryData.previous_month.total_sales,
                                      ),
                                      profit: parseFloat(
                                        summaryData.previous_month.total_profit,
                                      ),
                                    },
                                    {
                                      month: "本月",
                                      sales: parseFloat(
                                        summaryData.statistics.total_sales,
                                      ),
                                      profit: parseFloat(
                                        summaryData.statistics.total_profit,
                                      ),
                                    },
                                  ]}
                                >
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis dataKey="month" />
                                  <YAxis />
                                  <RechartsTooltip
                                    formatter={(value) =>
                                      `¥${value.toFixed(2)}`
                                    }
                                  />
                                  <Legend />
                                  <Bar
                                    dataKey="sales"
                                    fill="#1890ff"
                                    name="销售额"
                                  />
                                  <Bar
                                    dataKey="profit"
                                    fill="#52c41a"
                                    name="利润"
                                  />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      </Row>
                    )}

                    {/* 销售额TOP10 */}
                    <Card title="销售额TOP10" className={styles.chartRowMargin}>
                      <Table
                        dataSource={summaryData.top_products_by_sales}
                        pagination={false}
                        rowKey="offer_id"
                        columns={[
                          {
                            title: "图片",
                            width: 80,
                            render: (_, record) => (
                              <ProductImage
                                imageUrl={record.image_url}
                                size="small"
                                hoverBehavior="medium"
                                name={record.name}
                              />
                            ),
                          },
                          {
                            title: "商品信息",
                            render: (_, record) => (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <div style={{ fontWeight: 500 }}>
                                  {record.name}
                                </div>
                                <div className={styles.skuContainer}>
                                  <span
                                    className={styles.skuLink}
                                    onClick={() => openProductLink(record.sku)}
                                  >
                                    {record.sku} <LinkOutlined />
                                  </span>
                                  <CopyOutlined
                                    className={styles.copyIcon}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(record.sku, 'SKU');
                                    }}
                                  />
                                </div>
                              </div>
                            ),
                          },
                          {
                            title: "销售额",
                            dataIndex: "sales",
                            width: 120,
                            align: "right",
                            render: (value) =>
                              `¥${parseFloat(value).toFixed(2)}`,
                          },
                          {
                            title: "销量",
                            dataIndex: "quantity",
                            width: 80,
                            align: "right",
                          },
                          {
                            title: "利润",
                            dataIndex: "profit",
                            width: 120,
                            align: "right",
                            render: (value) => {
                              const profit = parseFloat(value);
                              return (
                                <span
                                  style={{
                                    color: profit >= 0 ? "#52c41a" : "#ff4d4f",
                                  }}
                                >
                                  ¥{profit.toFixed(2)}
                                </span>
                              );
                            },
                          },
                        ]}
                      />
                    </Card>

                    {/* 销售量TOP10 */}
                    <Card title="销售量TOP10" className={styles.chartRowMargin}>
                      <Table
                        dataSource={summaryData.top_products_by_quantity}
                        pagination={false}
                        rowKey="offer_id"
                        columns={[
                          {
                            title: "图片",
                            width: 80,
                            render: (_, record) => (
                              <ProductImage
                                imageUrl={record.image_url}
                                size="small"
                                hoverBehavior="medium"
                                name={record.name}
                              />
                            ),
                          },
                          {
                            title: "商品信息",
                            render: (_, record) => (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <div style={{ fontWeight: 500 }}>
                                  {record.name}
                                </div>
                                <div className={styles.skuContainer}>
                                  <span
                                    className={styles.skuLink}
                                    onClick={() => openProductLink(record.sku)}
                                  >
                                    {record.sku} <LinkOutlined />
                                  </span>
                                  <CopyOutlined
                                    className={styles.copyIcon}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(record.sku, 'SKU');
                                    }}
                                  />
                                </div>
                              </div>
                            ),
                          },
                          {
                            title: "销售额",
                            dataIndex: "sales",
                            width: 120,
                            align: "right",
                            render: (value) =>
                              `¥${parseFloat(value).toFixed(2)}`,
                          },
                          {
                            title: "销量",
                            dataIndex: "quantity",
                            width: 80,
                            align: "right",
                          },
                          {
                            title: "利润",
                            dataIndex: "profit",
                            width: 120,
                            align: "right",
                            render: (value) => {
                              const profit = parseFloat(value);
                              return (
                                <span
                                  style={{
                                    color: profit >= 0 ? "#52c41a" : "#ff4d4f",
                                  }}
                                >
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
        </div>
      </Card>

      {/* 订单详情Modal（统一组件） */}
      <OrderDetailModal
        visible={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        selectedOrder={selectedOrder}
        selectedPosting={selectedPosting}
        statusConfig={statusConfig}
        userCurrency={userCurrency}
        offerIdImageMap={offerIdImageMap}
        formatDeliveryMethodTextWhite={formatDeliveryMethodTextWhite}
        onUpdate={() => {
          // 刷新报表数据
          refetchPostings();
        }}
      />
    </div>
  );
};

export default OrderReport;
