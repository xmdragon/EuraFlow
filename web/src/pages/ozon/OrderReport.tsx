/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck - recharts 组件与 React 19 类型定义不兼容
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
  UnorderedListOutlined,
  PieChartOutlined,
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
  Tooltip,
  Checkbox,
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
import ShopSelector from "@/components/ozon/ShopSelector";
import PageTitle from "@/components/PageTitle";
import { ORDER_STATUS_CONFIG } from "@/config/ozon/orderStatusConfig";
import { useCopy } from "@/hooks/useCopy";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateTime } from "@/hooks/useDateTime";
import { useShopSelection } from "@/hooks/ozon/useShopSelection";
import { useShopNameFormat } from "@/hooks/useShopNameFormat";
import * as ozonApi from "@/services/ozon";
import { notifySuccess, notifyError } from "@/utils/notification";
import { formatDeliveryMethodTextWhite } from "@/utils/packingHelpers";

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

// 饼图自定义标签渲染 - 根据索引调整距离避免重叠
const renderPieLabel = (props: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  index: number;
}) => {
  const { cx, cy, midAngle, outerRadius, percent, index } = props;

  const RADIAN = Math.PI / 180;

  // 根据索引调整标签距离，奇偶交替，避免相邻标签重叠
  const radiusOffset = index % 2 === 0 ? 20 : 35;
  const radius = outerRadius + radiusOffset;

  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  const percentValue = Math.round(percent * 100);
  if (percentValue === 0) return null;

  return (
    <text
      x={x}
      y={y}
      fill={COLORS[index % COLORS.length]}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={12}
      fontWeight="bold"
    >
      {`${percentValue}%`}
    </text>
  );
};

// ===== 类型定义 =====

// 分页响应类型
interface PostingReportResponse {
  data: PostingReportItem[];
  total: number;
  total_pages: number;
  page: number;
  page_size: number;
}

// Posting 列表项（不含商品详情，优化后的响应）
interface PostingReportItem {
  posting_number: string;
  shop_name: string;
  status: string;
  is_cancelled: boolean;
  created_at: string;
  in_process_at?: string;
  delivered_at?: string;  // 签收日期
  product_count: number;  // 商品数量（替代 products 数组）
  order_amount: string;
  purchase_price: string;
  ozon_commission_cny: string;
  international_logistics_fee_cny: string;
  last_mile_delivery_fee_cny: string;
  material_cost: string;
  profit: string;
  profit_rate: number;
}

// PostingDetailResponse 转换为 ozonApi.Posting 的辅助类型（用于 API 响应）
interface PostingDetailResponse {
  posting_number: string;
  shop_name: string;
  status: string;
  is_cancelled: boolean;
  created_at: string;
  in_process_at?: string;
  shipped_at?: string;
  delivered_at?: string;
  products: Array<{
    sku: string;
    offer_id?: string;
    name: string;
    quantity: number;
    price: string;
    image_url?: string;
  }>;
  product_count: number;
  order_amount: string;
  purchase_price: string;
  ozon_commission_cny: string;
  international_logistics_fee_cny: string;
  last_mile_delivery_fee_cny: string;
  material_cost: string;
  profit: string;
  profit_rate: number;
  warehouse_name?: string;
  delivery_method_name?: string;
  order_notes?: string;
  domestic_tracking_numbers?: string[];
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
  const { formatDate } = useDateTime();
  const { currency: userCurrency } = useCurrency();
  const { formatShopName } = useShopNameFormat();

  // ===== 状态管理 =====
  const [selectedMonth, setSelectedMonth] = useState(
    dayjs().subtract(1, "month").format("YYYY-MM"),
  );
  // 店铺选择（带验证）
  const { selectedShop, setSelectedShop } = useShopSelection();
  const [statusFilter, setStatusFilter] = useState<"delivered" | "placed">(
    "delivered",
  );
  const [postingNumber, setPostingNumber] = useState<string>(""); // posting_number筛选
  const [noCommissionFilter, setNoCommissionFilter] = useState<boolean>(false); // 无Ozon佣金筛选
  const [activeTab, setActiveTab] = useState<string>("summary");

  // 分页状态（用于无限滚动）
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [hasMore, setHasMore] = useState(true);
  const [allLoadedData, setAllLoadedData] = useState<any[]>([]); // 累积所有已加载数据

  // 排序状态
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // 详情Modal状态（使用统一的 OrderDetailModal）
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);

  // 批量同步状态
  const [batchSyncTaskId, setBatchSyncTaskId] = useState<string | null>(null);
  const [batchSyncProgress, setBatchSyncProgress] = useState<any>(null);
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);

  // 状态配置
  const statusConfig = ORDER_STATUS_CONFIG;


  // ===== 数据查询 =====

  // 查询posting级别报表数据（仅在订单明细Tab激活时查询）
  const {
    data: postingReportData,
    isLoading: isLoadingPostings,
    refetch: refetchPostings,
    isFetching,
  } = useQuery<PostingReportResponse>({
    queryKey: [
      "ozonPostingReport",
      selectedMonth,
      selectedShop,
      statusFilter,
      postingNumber,
      noCommissionFilter,
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
        noCommissionFilter,
      ) as PostingReportResponse;
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

  // 查询店铺列表（用于格式化店铺名称）
  const { data: shopsData } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: () => ozonApi.getShops(),
    staleTime: 5 * 60 * 1000,
  });

  // 创建店铺名称映射：shop_name -> 格式化后的显示名称
  const shopNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (shopsData?.data) {
      shopsData.data.forEach((shop: { shop_name: string; shop_name_cn?: string }) => {
        map[shop.shop_name] = formatShopName(shop);
      });
    }
    return map;
  }, [shopsData?.data, formatShopName]);

  // 查询报表汇总数据（仅在订单汇总Tab激活时查询）
  const {
    data: rawSummaryData,
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
      ) as ReportSummary;
    },
    enabled: activeTab === "summary",
    retry: 1,
    staleTime: 2 * 60 * 1000,
  });

  // 处理 summaryData，格式化店铺名称
  const summaryData = useMemo(() => {
    if (!rawSummaryData) return undefined;
    return {
      ...rawSummaryData,
      shop_breakdown: rawSummaryData.shop_breakdown.map(item => ({
        ...item,
        shop_name: shopNameMap[item.shop_name] || item.shop_name,
      })),
    };
  }, [rawSummaryData, shopNameMap]);

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

  // 打开货件详情Modal - 调用报表详情 API 并转换为 Posting 格式
  const showPostingDetail = async (postingNumberToShow: string) => {
    try {
      const detail = await ozonApi.getPostingDetail(postingNumberToShow) as PostingDetailResponse;

      // 将 PostingDetailResponse 转换为 ozonApi.Posting 格式
      const posting: ozonApi.Posting & {
        total_price?: string;
        created_at?: string;
      } = {
        id: 0,
        posting_number: detail.posting_number,
        status: detail.status,
        is_cancelled: detail.is_cancelled,
        packages_count: 0,
        // 财务字段
        purchase_price: detail.purchase_price,
        material_cost: detail.material_cost,
        last_mile_delivery_fee_cny: detail.last_mile_delivery_fee_cny,
        international_logistics_fee_cny: detail.international_logistics_fee_cny,
        ozon_commission_cny: detail.ozon_commission_cny,
        // 时间字段
        in_process_at: detail.in_process_at,
        shipped_at: detail.shipped_at,
        delivered_at: detail.delivered_at,
        // 其他字段
        warehouse_name: detail.warehouse_name,
        delivery_method_name: detail.delivery_method_name,
        order_notes: detail.order_notes,
        domestic_tracking_numbers: detail.domestic_tracking_numbers,
        // 商品列表（转换格式）
        items: detail.products.map(p => ({
          sku: p.sku,
          offer_id: p.offer_id,
          name: p.name,
          quantity: p.quantity,
          price: p.price,
          image: p.image_url,
        })),
        // OrderDetailModal 需要的额外字段
        total_price: detail.order_amount,
        created_at: detail.created_at,
      };

      setSelectedPosting(posting);
      setDetailModalVisible(true);
    } catch {
      notifyError('加载失败', '无法加载货件详情');
    }
  };

  // 启动批量同步
  const handleBatchSync = async () => {
    if (!selectedShop) {
      notifyError('请先选择店铺');
      return;
    }

    try {
      setIsBatchSyncing(true);
      const result = await ozonApi.startBatchFinanceSync(selectedShop);

      // 检查后端返回的错误
      if (result.ok === false) {
        notifyError('启动失败', result.error || '无法启动批量同步任务');
        setIsBatchSyncing(false);
        return;
      }

      if (!result.task_id) {
        notifyError('启动失败', '未获取到任务ID');
        setIsBatchSyncing(false);
        return;
      }

      setBatchSyncTaskId(result.task_id);
    } catch (error: any) {
      notifyError('启动失败', error.message || '无法启动批量同步任务');
      setIsBatchSyncing(false);
    }
  };

  // 轮询批量同步进度
  useEffect(() => {
    if (!batchSyncTaskId || !isBatchSyncing) return;

    interface SyncProgress {
      status: string;
      message?: string;
      current?: number;
      total?: number;
    }

    const pollProgress = async () => {
      try {
        const progress = await ozonApi.getBatchFinanceSyncProgress(batchSyncTaskId) as SyncProgress;
        setBatchSyncProgress(progress);

        if (progress.status === 'completed') {
          setIsBatchSyncing(false);
          notifySuccess('同步完成', progress.message || '批量同步任务已完成');
          // 刷新报表数据
          if (activeTab === "details") {
            refetchPostings();
          } else {
            refetchSummary();
          }
        } else if (progress.status === 'failed') {
          setIsBatchSyncing(false);
          notifyError('同步失败', progress.message || '批量同步任务失败');
        }
      } catch (error) {
        console.error('Failed to poll progress:', error);
      }
    };

    // 立即执行一次
    pollProgress();

    // 每2秒轮询一次
    const interval = setInterval(pollProgress, 2000);

    return () => clearInterval(interval);
  }, [batchSyncTaskId, isBatchSyncing, activeTab]);

  // ===== 订单明细Tab数据处理 =====

  // 直接使用 allLoadedData，每个 posting 一行（优化后不再展开商品）
  const postingRows = useMemo<PostingReportItem[]>(() => {
    if (!allLoadedData || allLoadedData.length === 0) return [];
    return allLoadedData.map((posting: PostingReportItem) => ({
      ...posting,
      key: posting.posting_number,
    }));
  }, [allLoadedData]);

  // ===== 订单明细Tab - 表格列定义（优化后：每个 posting 一行）=====

  const detailColumns: ColumnsType<PostingReportItem & { key: string }> = [
    // 1. 店铺名称（显示第一个单词，完整名称用 Tooltip）
    {
      title: "店铺",
      width: 120,
      render: (_, row) => {
        const shopName = row.shop_name || '-';
        const firstWord = shopName.split(' ')[0] || shopName;
        return (
          <Tooltip title={shopName}>
            <div className={styles.shopName} style={{ cursor: 'help' }}>
              {firstWord}
            </div>
          </Tooltip>
        );
      },
    },
    // 2. 货件编号（可点击查看详情）
    {
      title: "货件编号",
      width: 150,
      render: (_, row) => (
        <div className={styles.postingNumberContainer}>
          <span
            className={styles.postingNumberLink}
            onClick={() => showPostingDetail(row.posting_number)}
          >
            {row.posting_number}
          </span>
          <CopyOutlined
            className={styles.copyIcon}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(row.posting_number, 'Posting号');
            }}
          />
        </div>
      ),
    },
    // 3. 状态
    {
      title: "状态",
      width: 70,
      render: (_, row) => {
        const config = statusConfig[row.status];
        // Ant Design 颜色名转换为实际颜色
        const colorMap: Record<string, { text: string; bg: string }> = {
          success: { text: '#52c41a', bg: '#f6ffed' },
          error: { text: '#ff4d4f', bg: '#fff2f0' },
          processing: { text: '#1890ff', bg: '#e6f7ff' },
          warning: { text: '#faad14', bg: '#fffbe6' },
          cyan: { text: '#13c2c2', bg: '#e6fffb' },
        };
        const colors = config ? colorMap[config.color] || { text: '#999', bg: '#f5f5f5' } : { text: '#999', bg: '#f5f5f5' };
        return (
          <span
            className={styles.statusTag}
            style={{ color: colors.text, backgroundColor: colors.bg }}
          >
            {config?.text || row.status}
          </span>
        );
      },
    },
    // 4. 订单金额
    {
      title: "订单金额",
      width: 80,
      align: "right",
      render: (_, row) => row.order_amount,
    },
    // 5. 进货金额
    {
      title: "进货金额",
      width: 80,
      align: "right",
      render: (_, row) => row.purchase_price || "-",
    },
    // 6. Ozon佣金
    {
      title: "Ozon佣金",
      width: 80,
      align: "right",
      render: (_, row) => row.ozon_commission_cny || "-",
    },
    // 7. 国际物流
    {
      title: "国际物流",
      width: 80,
      align: "right",
      render: (_, row) => row.international_logistics_fee_cny || "-",
    },
    // 8. 尾程派送
    {
      title: "尾程派送",
      width: 80,
      align: "right",
      render: (_, row) => row.last_mile_delivery_fee_cny || "-",
    },
    // 9. 打包费用
    {
      title: "打包费用",
      width: 80,
      align: "right",
      render: (_, row) => row.material_cost || "-",
    },
    // 10. 利润金额
    {
      title: "利润金额",
      width: 80,
      align: "right",
      render: (_, row) => {
        const profit = parseFloat(row.profit || "0");
        return (
          <span
            className={`${styles.profitCell} ${profit >= 0 ? styles.positive : styles.negative}`}
          >
            {row.profit}
          </span>
        );
      },
    },
    // 11. 利润比率（带排序）
    {
      title: () => (
        <div className={styles.profitRateHeader}>
          <span>利润率</span>
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
      width: 80,
      align: "right",
      render: (_, row) => {
        const profitRate = row.profit_rate;
        return (
          <span
            className={`${styles.profitCell} ${profitRate >= 0 ? styles.positive : styles.negative}`}
          >
            {profitRate.toFixed(2)}%
          </span>
        );
      },
    },
    // 12. 订单日期
    {
      title: "订单日期",
      width: 65,
      render: (_, row) => (
        <Tooltip title={formatDate(row.created_at, "YYYY-MM-DD HH:mm")}>
          <div className={styles.date} style={{ cursor: 'help' }}>
            {formatDate(row.created_at, "MM-DD")}
          </div>
        </Tooltip>
      ),
    },
    // 13. 签收日期
    {
      title: "签收日期",
      width: 65,
      render: (_, row) => (
        row.delivered_at ? (
          <Tooltip title={formatDate(row.delivered_at, "YYYY-MM-DD HH:mm")}>
            <div className={styles.date} style={{ cursor: 'help' }}>
              {formatDate(row.delivered_at, "MM-DD")}
            </div>
          </Tooltip>
        ) : (
          <span>-</span>
        )
      ),
    },
  ];

  // ===== 渲染 =====

  return (
    <div>
      {/* Sticky头部区域：标题 + 筛选 */}
      <div className={styles.stickyHeader}>
        {/* 页面标题 */}
        <PageTitle icon={<FileTextOutlined />} title="订单报表" />

        {/* 筛选区域 */}
        <div className={styles.filterWrapper}>
          <Row gutter={12} className={styles.filterRow} align="middle">
            <Col>
              <ShopSelector
                value={selectedShop}
                onChange={(value) => {
                  setSelectedShop(value as number | null);
                  setPage(1);
                  setAllLoadedData([]);
                }}
                placeholder="全部店铺"
                className={styles.shopSelector}
                showAllOption={true}
              />
            </Col>
            <Col>
              <Select
                value={selectedMonth}
                onChange={(value) => {
                  setSelectedMonth(value);
                  setPage(1);
                  setAllLoadedData([]);
                }}
                style={{ minWidth: 130 }}
                options={generateMonthOptions()}
              />
            </Col>
            <Col>
              <Select
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value);
                  setPage(1);
                  setAllLoadedData([]);
                }}
                style={{ minWidth: 100 }}
              >
                <Option value="delivered">已签收</Option>
                <Option value="placed">已下订</Option>
              </Select>
            </Col>
            <Col>
              <Input
                value={postingNumber}
                onChange={(e) => setPostingNumber(e.target.value)}
                placeholder="货件编号"
                style={{ width: 180 }}
                allowClear
                onPressEnter={async () => {
                  setPage(1);
                  if (activeTab === "details") {
                    const result = await refetchPostings();
                    if (result.data?.data) {
                      setAllLoadedData(result.data.data);
                      setHasMore(1 < (result.data.total_pages || 1));
                    }
                  }
                }}
              />
            </Col>
            <Col>
              <Checkbox
                checked={noCommissionFilter}
                onChange={(e) => {
                  setNoCommissionFilter(e.target.checked);
                  setPage(1);
                  setAllLoadedData([]);
                }}
              >
                无Ozon佣金
              </Checkbox>
            </Col>
            <Col>
              <Button
                type="primary"
                onClick={async () => {
                  setPage(1);
                  if (activeTab === "details") {
                    const result = await refetchPostings();
                    if (result.data?.data) {
                      setAllLoadedData(result.data.data);
                      setHasMore(1 < (result.data.total_pages || 1));
                    }
                  } else {
                    refetchSummary();
                  }
                }}
              >
                查询
              </Button>
            </Col>
            <Col>
              <Tooltip title={!selectedShop ? "请先选择店铺" : "同步最近7天签收但未同步财务的订单"}>
                <Button
                  type="default"
                  onClick={handleBatchSync}
                  loading={isBatchSyncing}
                  disabled={isBatchSyncing || !selectedShop}
                >
                  {isBatchSyncing
                    ? `同步中 ${batchSyncProgress?.total > 0 ? Math.round((batchSyncProgress?.current || 0) / batchSyncProgress.total * 100) : 0}%`
                    : '同步佣金'}
                </Button>
              </Tooltip>
            </Col>
          </Row>
        </div>
      </div>

      {/* 内容区域 */}
      <Card className={styles.mainCard}>
        <div className={styles.contentContainer}>
          {/* Tab切换 */}
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              // 切换Tab时重置页码（保留已加载数据，避免闪烁）
              setPage(1);
            }}
            className={styles.reportTabs}
            destroyInactiveTabPane
          >
            {/* 订单明细Tab */}
            <Tabs.TabPane
              tab={<span><UnorderedListOutlined /> 订单明细 ({postingReportData?.total || 0})</span>}
              key="details"
            >
              <Spin spinning={isLoadingPostings}>
                <Table
                  dataSource={postingRows}
                  columns={detailColumns}
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 1400 }}
                  loading={false}
                  size="small"
                  sticky={{ offsetHeader: 100 }}
                />
                {/* 加载更多提示 */}
                {isFetching && (
                  <div className={styles.loadingHint}>加载中...</div>
                )}
                {!hasMore && allLoadedData.length > 0 && (
                  <div className={styles.loadedAllHint}>已加载全部数据</div>
                )}
              </Spin>
            </Tabs.TabPane>

            {/* 订单汇总Tab */}
            <Tabs.TabPane tab={<span><PieChartOutlined /> 订单汇总</span>} key="summary">
              <Spin spinning={isLoadingSummary}>
                {summaryData && (
                  <>
                    {/* 统计卡片行 */}
                    <Row gutter={16} className={styles.summaryCards}>
                      <Col span={statusFilter === "delivered" ? 4 : 6}>
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
                      <Col span={statusFilter === "delivered" ? 4 : 6}>
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
                      <Col span={statusFilter === "delivered" ? 4 : 6}>
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
                      {/* 已下订状态不显示利润数据 */}
                      {statusFilter === "delivered" && (
                        <>
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
                        </>
                      )}
                      <Col span={statusFilter === "delivered" ? 4 : 6}>
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
                              ? statusFilter === "delivered" ? "销售额分解" : "成本分解"
                              : "店铺销售占比"
                          }
                          className={styles.chartCard}
                        >
                          <div className={styles.chartContainer}>
                            {selectedShop !== null ? (
                              <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <PieChart>
                                  <Pie
                                    data={summaryData.cost_breakdown}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label={renderPieLabel}
                                    labelLine={true}
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
                              <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <PieChart>
                                  <Pie
                                    data={summaryData.shop_breakdown}
                                    dataKey="sales"
                                    nameKey="shop_name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label={renderPieLabel}
                                    labelLine={true}
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
                              <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <PieChart>
                                  <Pie
                                    data={summaryData.shop_breakdown}
                                    dataKey="profit"
                                    nameKey="shop_name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    label={renderPieLabel}
                                    labelLine={true}
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
                              <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <BarChart
                                  data={[
                                    {
                                      month: "上月",
                                      sales: parseFloat(
                                        summaryData.previous_month.total_sales,
                                      ),
                                      ...(statusFilter === "delivered" && {
                                        profit: parseFloat(
                                          summaryData.previous_month.total_profit,
                                        ),
                                      }),
                                    },
                                    {
                                      month: "本月",
                                      sales: parseFloat(
                                        summaryData.statistics.total_sales,
                                      ),
                                      ...(statusFilter === "delivered" && {
                                        profit: parseFloat(
                                          summaryData.statistics.total_profit,
                                        ),
                                      }),
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
                                  {statusFilter === "delivered" && (
                                    <Bar
                                      dataKey="profit"
                                      fill="#52c41a"
                                      name="利润"
                                    />
                                  )}
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
                            <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                              <LineChart data={summaryData.daily_trend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis />
                                <RechartsTooltip
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload || !payload.length) return null;

                                    const sales = parseFloat(payload.find(p => p.dataKey === 'sales')?.value || '0');
                                    const profit = parseFloat(payload.find(p => p.dataKey === 'profit')?.value || '0');
                                    const profitRate = sales > 0 ? (profit / sales * 100) : 0;

                                    return (
                                      <div style={{
                                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                        border: '1px solid #ccc',
                                        padding: '10px',
                                        borderRadius: '4px'
                                      }}>
                                        <p style={{ margin: '0 0 5px 0', fontWeight: 500 }}>{label}</p>
                                        <p style={{ margin: '3px 0', color: '#1890ff' }}>
                                          销售额: ¥{sales.toFixed(2)}
                                        </p>
                                        {statusFilter === "delivered" && (
                                          <>
                                            <p style={{ margin: '3px 0', color: '#52c41a' }}>
                                              利润: ¥{profit.toFixed(2)}
                                            </p>
                                            <p style={{ margin: '3px 0', color: profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
                                              利润率: {profitRate.toFixed(2)}%
                                            </p>
                                          </>
                                        )}
                                      </div>
                                    );
                                  }}
                                />
                                <Legend />
                                <Line
                                  type="monotone"
                                  dataKey="sales"
                                  stroke="#1890ff"
                                  name="销售额"
                                />
                                {statusFilter === "delivered" && (
                                  <Line
                                    type="monotone"
                                    dataKey="profit"
                                    stroke="#52c41a"
                                    name="利润"
                                  />
                                )}
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
                              <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                <BarChart
                                  data={[
                                    {
                                      month: "上月",
                                      sales: parseFloat(
                                        summaryData.previous_month.total_sales,
                                      ),
                                      ...(statusFilter === "delivered" && {
                                        profit: parseFloat(
                                          summaryData.previous_month.total_profit,
                                        ),
                                      }),
                                    },
                                    {
                                      month: "本月",
                                      sales: parseFloat(
                                        summaryData.statistics.total_sales,
                                      ),
                                      ...(statusFilter === "delivered" && {
                                        profit: parseFloat(
                                          summaryData.statistics.total_profit,
                                        ),
                                      }),
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
                                  {statusFilter === "delivered" && (
                                    <Bar
                                      dataKey="profit"
                                      fill="#52c41a"
                                      name="利润"
                                    />
                                  )}
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
                              <div className={styles.productInfoColumn}>
                                <div className={styles.productNameBold}>
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
                          ...(statusFilter === "delivered" ? [{
                            title: "利润",
                            dataIndex: "profit",
                            width: 120,
                            align: "right" as const,
                            render: (value: string) => {
                              const profit = parseFloat(value);
                              return (
                                <span
                                  className={profit >= 0 ? styles.profitPositive : styles.profitNegative}
                                >
                                  ¥{profit.toFixed(2)}
                                </span>
                              );
                            },
                          }] : []),
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
                              <div className={styles.productInfoColumn}>
                                <div className={styles.productNameBold}>
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
                          ...(statusFilter === "delivered" ? [{
                            title: "利润",
                            dataIndex: "profit",
                            width: 120,
                            align: "right" as const,
                            render: (value: string) => {
                              const profit = parseFloat(value);
                              return (
                                <span
                                  className={profit >= 0 ? styles.profitPositive : styles.profitNegative}
                                >
                                  ¥{profit.toFixed(2)}
                                </span>
                              );
                            },
                          }] : []),
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

      {/* 货件详情Modal - 使用统一的 OrderDetailModal */}
      <OrderDetailModal
        visible={detailModalVisible}
        onCancel={() => {
          setDetailModalVisible(false);
          setSelectedPosting(null);
        }}
        selectedOrder={null}
        selectedPosting={selectedPosting}
        statusConfig={statusConfig}
        userCurrency={userCurrency}
        offerIdImageMap={{}}
        formatDeliveryMethodTextWhite={formatDeliveryMethodTextWhite}
      />
    </div>
  );
};

export default OrderReport;
