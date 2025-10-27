/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
/**
 * 选品助手页面
 */
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ShoppingOutlined,
  StarOutlined,
  HistoryOutlined,
  FilterOutlined,
  DeleteOutlined,
  BookOutlined,
  CheckCircleOutlined,
  QuestionCircleOutlined,
  LinkOutlined,
  CodeOutlined,
  RocketOutlined,
  SettingOutlined,
  LoadingOutlined,
  CalculatorOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  Row,
  Col,
  Button,
  Form,
  InputNumber,
  Select,
  Space,
  Alert,
  notification,
  Spin,
  Empty,
  Tag,
  Modal,
  Table,
  Typography,
  Tabs,
  Steps,
  Timeline,
  Collapse,
  DatePicker,
  Tooltip,
  Checkbox,
  Popconfirm,
  Descriptions,
} from "antd";
import dayjs from "dayjs";
import React, { useState, useEffect, useMemo, useRef } from "react";

import { useCurrency } from "../../hooks/useCurrency";

import styles from "./ProductSelection.module.scss";
import { calculateMaxCost, formatMaxCost } from "./profitCalculator";

import ImagePreview from "@/components/ImagePreview";
import FieldConfigModal, {
  type FieldConfig,
  defaultFieldConfig,
} from "@/components/ozon/selection/FieldConfigModal";
import PageTitle from "@/components/PageTitle";
import { getExchangeRate } from "@/services/exchangeRateApi";
import * as api from "@/services/productSelectionApi";
import { getNumberFormatter, getNumberParser } from "@/utils/formatNumber";
import { logger } from "@/utils/logger";
import {
  notifySuccess,
  notifyError,
  notifyWarning,
  notifyInfo,
} from "@/utils/notification";
import { optimizeOzonImageUrl } from "@/utils/ozonImageOptimizer";

import type { FormValues } from "@/types/common";

const { Option } = Select;
const { Text, Link, Paragraph, Title } = Typography;

const ProductSelection: React.FC = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const { symbol: userSymbol } = useCurrency();

  // 状态管理
  const [activeTab, setActiveTab] = useState("search");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(24); // 初始值，会根据容器宽度动态调整
  const [historyPage, setHistoryPage] = useState(1); // 导入历史分页
  const [searchParams, setSearchParams] = useState<api.ProductSearchParams>({});
  const [competitorModalVisible, setCompetitorModalVisible] = useState(false);
  const [selectedProductCompetitors, setSelectedProductCompetitors] =
    useState<any>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedProductImages, setSelectedProductImages] = useState<string[]>(
    [],
  );
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // 批次管理和选择状态
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(
    new Set(),
  );
  const [markingAsRead, setMarkingAsRead] = useState(false);

  // 无限滚动相关状态（游标分页）
  const [allProducts, setAllProducts] = useState<api.ProductSelectionItem[]>(
    [],
  ); // 累积所有已加载的商品
  const [itemsPerRow, setItemsPerRow] = useState(6); // 每行显示数量（动态计算）
  const [initialPageSize, setInitialPageSize] = useState(24); // 初始加载数量（itemsPerRow * 4）
  const [loadMoreSize, setLoadMoreSize] = useState(14); // 后续每次加载数量（itemsPerRow * 2）
  const [isLoadingMore, setIsLoadingMore] = useState(false); // 是否正在加载更多
  const [hasMoreData, setHasMoreData] = useState(true); // 是否还有更多数据
  const [isCalculated, setIsCalculated] = useState(false); // 是否已完成初始计算（避免重复请求）
  const loadingLockRef = useRef(false); // 请求锁，防止并发请求
  const [lastId, setLastId] = useState<number>(0); // 游标：上次最后一个商品的ID

  // 字段配置状态
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>(() => {
    const saved = localStorage.getItem("productFieldConfig");
    return saved ? JSON.parse(saved) : defaultFieldConfig;
  });
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);

  // 成本计算相关状态（从localStorage读取默认值）
  const [enableCostEstimation, setEnableCostEstimation] = useState<boolean>(() => {
    const saved = localStorage.getItem("productSelectionEnableCostEstimation");
    return saved ? JSON.parse(saved) : true; // 默认勾选
  });
  const [targetProfitRate, setTargetProfitRate] = useState<number>(() => {
    const saved = localStorage.getItem("productSelectionProfitRate");
    return saved ? parseFloat(saved) : 20; // 默认20%
  });
  const [packingFee, setPackingFee] = useState<number>(() => {
    const saved = localStorage.getItem("productSelectionPackingFee");
    return saved ? parseFloat(saved) : 2.0; // 默认2.0 RMB
  });

  // 记住我的选择状态
  const [rememberFilters, setRememberFilters] = useState<boolean>(() => {
    const saved = localStorage.getItem("productSelectionRememberFilters");
    return saved ? JSON.parse(saved) : false; // 默认不记住
  });

  // 保存成本估算开关到localStorage
  useEffect(() => {
    localStorage.setItem(
      "productSelectionEnableCostEstimation",
      JSON.stringify(enableCostEstimation),
    );
  }, [enableCostEstimation]);

  // 保存利润率到localStorage
  useEffect(() => {
    localStorage.setItem(
      "productSelectionProfitRate",
      targetProfitRate.toString(),
    );
  }, [targetProfitRate]);

  // 保存打包费到localStorage
  useEffect(() => {
    localStorage.setItem("productSelectionPackingFee", packingFee.toString());
  }, [packingFee]);

  // 保存"记住选择"设置到localStorage
  useEffect(() => {
    localStorage.setItem(
      "productSelectionRememberFilters",
      JSON.stringify(rememberFilters),
    );
  }, [rememberFilters]);

  // 处理URL参数（批次ID和已读状态）+ 恢复保存的筛选条件
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batchId = params.get("batch_id");
    const isReadParam = params.get("is_read");

    // 从localStorage恢复保存的筛选条件（仅在rememberFilters为true时）
    const savedFilters = localStorage.getItem("productSelectionFilters");
    const shouldRemember = localStorage.getItem(
      "productSelectionRememberFilters",
    );
    let restoredParams: api.ProductSearchParams = {};

    if (savedFilters && shouldRemember === "true") {
      try {
        const parsed = JSON.parse(savedFilters);
        // 排除batch_id和is_read，这两个由URL参数或默认值控制

        const { _batch_id, _is_read, ...filters } = parsed;
        restoredParams = filters;

        // 恢复表单字段
        if (parsed.listing_date) {
          // DatePicker需要dayjs对象
          form.setFieldsValue({
            ...parsed,
            listing_date: parsed.listing_date
              ? dayjs(parsed.listing_date)
              : undefined,
          });
        } else {
          form.setFieldsValue(parsed);
        }
      } catch (e) {
        logger.error("恢复筛选条件失败:", e);
      }
    }

    if (batchId) {
      // 从批次链接进来，显示该批次所有商品
      setSearchParams({
        ...restoredParams,
        batch_id: parseInt(batchId),
      });
    } else if (isReadParam === null || isReadParam === "false") {
      // 默认或明确指定只显示未读商品
      setSearchParams({ ...restoredParams, is_read: false });
    } else {
      // 仅应用恢复的筛选条件（如果有）
      if (Object.keys(restoredParams).length > 0) {
        setSearchParams((prev) => ({ ...prev, ...restoredParams }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在挂载时运行一次，form 实例在组件生命周期内稳定

  // 查询品牌列表
  const { data: brandsData } = useQuery({
    queryKey: ["productSelectionBrands"],
    queryFn: api.getBrands,
  });

  // 从当前商品列表提取品牌（动态更新）
  const currentBrands = useMemo(() => {
    if (allProducts.length > 0) {
      const brands = new Set(allProducts.map((p) => p.brand).filter(Boolean));
      return Array.from(brands).sort();
    }
    // 如果没有商品数据，使用全局品牌列表
    return brandsData?.data || [];
  }, [allProducts, brandsData]);

  // 查询商品列表
  const {
    data: productsData,
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ["productSelectionProducts", searchParams, currentPage, lastId],
    queryFn: () =>
      api.searchProducts({
        ...searchParams,
        after_id: currentPage === 1 ? 0 : lastId,
        limit: currentPage === 1 ? initialPageSize : loadMoreSize,
      }),
    enabled: activeTab === "search" && isCalculated, // 等待初始计算完成后才允许请求
  });

  // 查询汇率（CNY → RUB），用于正确匹配场景
  // 场景配置中的价格范围是RUB，需要汇率来转换为RMB后匹配
  const { data: exchangeRateData } = useQuery({
    queryKey: ["exchangeRate", "CNY", "RUB"],
    queryFn: () => getExchangeRate("CNY", "RUB", false),
    staleTime: 30 * 60 * 1000, // 30分钟
    gcTime: 60 * 60 * 1000, // 1小时
  });
  const exchangeRate = exchangeRateData
    ? parseFloat((exchangeRateData as any).rate)
    : null;

  // 查询导入历史
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["productSelectionHistory", historyPage],
    queryFn: () => api.getImportHistory(historyPage, 10),
    enabled: activeTab === "history",
  });

  // 计算每行显示数量（根据屏幕宽度-左边菜单宽度），并动态设置加载数量
  useEffect(() => {
    const calculateItemsPerRow = () => {
      // 获取侧边栏实际宽度
      const sider = document.querySelector('.ant-layout-sider');
      const siderWidth = sider ? sider.clientWidth : 240; // 默认240px（展开），收缩时80px

      // 使用屏幕宽度 - 侧边栏宽度
      const availableWidth = window.innerWidth - siderWidth;
      const itemWidth = 180; // 每个商品卡片宽度

      const columns = Math.max(
        1,
        Math.floor(availableWidth / itemWidth),
      );
      setItemsPerRow(columns);

      // 设置初始加载数量：列数 × 4行，但不超过后端限制100
      const calculatedInitialSize = Math.min(columns * 4, 100);
      setInitialPageSize(calculatedInitialSize);

      // 设置后续加载数量：列数 × 2行
      const calculatedLoadMoreSize = Math.min(columns * 2, 50);
      setLoadMoreSize(calculatedLoadMoreSize);

      setIsCalculated(true); // 标记计算完成，允许查询
    };

    calculateItemsPerRow();
    window.addEventListener("resize", calculateItemsPerRow);
    return () => window.removeEventListener("resize", calculateItemsPerRow);
  }, []);

  // 当收到新数据时，累积到 allProducts
  useEffect(() => {
    if (!productsData?.data) return;

    const { items = [], next_cursor, has_more } = productsData.data;

    if (currentPage === 1) {
      // 第一页，替换数据
      setAllProducts(items);
      setHasMoreData(has_more ?? false);
      // 更新游标为第一页最后一个商品的ID
      if (items.length > 0) {
        setLastId(items[items.length - 1].id);
      }
    } else if (items.length > 0) {
      // 后续页，追加数据（游标分页不会有重复）
      setAllProducts((prev) => [...prev, ...items]);
      setHasMoreData(has_more ?? false);
      // 更新游标为当前页最后一个商品的ID
      setLastId(items[items.length - 1].id);
    } else {
      // API返回空数组，说明没有更多数据了
      setHasMoreData(false);
    }

    // 释放请求锁
    loadingLockRef.current = false;
    setIsLoadingMore(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsData?.data]); // 移除 currentPage 依赖，避免循环

  // 滚动监听：滚动到80%加载下一页（pageSize为初始值的一半）
  useEffect(() => {
    let scrollTimeout: NodeJS.Timeout | null = null;

    const handleScroll = () => {
      // 防抖：200ms内只处理最后一次滚动事件
      if (scrollTimeout) clearTimeout(scrollTimeout);

      scrollTimeout = setTimeout(() => {
        // 双重检查：状态锁 + Ref锁
        if (isLoadingMore || !hasMoreData || loadingLockRef.current) return;

        const scrollTop =
          window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrollPercent = (scrollTop + windowHeight) / documentHeight;

        if (scrollPercent > 0.8) {
          // 加锁，防止并发请求
          loadingLockRef.current = true;
          setIsLoadingMore(true);

          // 保持pageSize不变，避免offset计算错误导致数据重复
          // 问题：如果第1页用pageSize=28，第2页改为14，后端计算offset=(2-1)*14=14，实际应该是28
          // 解决：所有分页使用相同的pageSize
          setCurrentPage((prev) => prev + 1);
        }
      }, 200);
    };

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [isLoadingMore, hasMoreData, initialPageSize, itemsPerRow]);

  // 过滤可盈利商品：根据成本估算开关决定是否过滤
  const profitableProducts = useMemo(() => {
    // 如果未启用成本估算，返回所有商品
    if (!enableCostEstimation) {
      return allProducts;
    }

    // 启用成本估算时，过滤掉无法达到目标利润率的商品
    return allProducts.filter((product) => {
      // 价格单位：CNY分，÷100 = CNY元 = RMB元
      const currentPriceRMB = product.current_price / 100; // 分 → RMB
      const competitorPriceRMB = product.competitor_min_price
        ? product.competitor_min_price / 100
        : null;
      const priceRMB = competitorPriceRMB
        ? Math.min(currentPriceRMB, competitorPriceRMB)
        : currentPriceRMB;

      const weight = product.package_weight || 0;

      // 缺少必要数据的商品保留（避免误删）
      if (weight <= 0 || priceRMB <= 0) return true;

      // 构建商品佣金率数据
      const commissionRates = {
        rfbs_low: product.rfbs_commission_low || undefined,
        rfbs_mid: product.rfbs_commission_mid || undefined,
        rfbs_high: product.rfbs_commission_high || undefined,
      };

      // 计算成本上限（RMB），传入汇率和佣金率数据
      const maxCost = calculateMaxCost(
        priceRMB,
        weight,
        targetProfitRate / 100,
        packingFee,
        exchangeRate || undefined,
        commissionRates,
      );

      // 过滤掉无法达到目标利润率的商品（maxCost < 0）
      return maxCost !== null && maxCost >= 0;
    });
  }, [allProducts, targetProfitRate, packingFee, exchangeRate, enableCostEstimation]);

  // 删除批次mutation
  const deleteBatchMutation = useMutation({
    mutationFn: api.deleteBatch,
    onSuccess: (data) => {
      if (data.success) {
        notification.success({
          message: "批次删除成功",
          description: `已删除批次 #${data.data.batch_id}，共 ${data.data.deleted_products} 个商品`,
          duration: 3,
        });
        // 刷新所有相关数据
        refetchProducts();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ["productSelectionBrands"] });
      }
    },
    onError: (error: Error) => {
      notifyError("删除失败", "删除批次失败: " + error.message);
    },
  });

  // 清空数据mutation
  const clearDataMutation = useMutation({
    mutationFn: api.clearAllData,
    onSuccess: (data) => {
      if (data.success) {
        notification.success({
          message: "数据清空成功",
          description: `已清空 ${data.data.deleted_products} 个商品和 ${data.data.deleted_history} 条导入历史`,
          duration: 3,
        });
        // 刷新所有相关数据
        refetchProducts();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ["productSelectionBrands"] });
      } else {
        notifyError("清空失败", data.error || "清空数据失败");
      }
    },
    onError: (error: Error) => {
      notifyError("清空失败", "清空数据失败: " + error.message);
    },
  });

  // 处理清空数据
  const handleClearData = () => {
    Modal.confirm({
      title: "确认清空所有数据？",
      content: (
        <div>
          <p className={styles.dangerText}>
            ⚠️ 此操作将永久删除您账号下的所有选品数据，无法恢复！
          </p>
          <p>包括：</p>
          <ul>
            <li>所有商品选品记录</li>
            <li>所有导入历史记录</li>
          </ul>
          <p>请确认是否继续？</p>
        </div>
      ),
      okText: "确认清空",
      cancelText: "取消",
      okType: "danger",
      onOk: () => {
        clearDataMutation.mutate();
      },
    });
  };

  // 处理搜索
  const handleSearch = (values: FormValues) => {
    const params: api.ProductSearchParams = {};

    if (values.brand) params.brand = values.brand;
    if (values.monthly_sales_min)
      params.monthly_sales_min = values.monthly_sales_min;
    if (values.monthly_sales_max)
      params.monthly_sales_max = values.monthly_sales_max;
    if (values.weight_max) params.weight_max = values.weight_max;
    if (values.competitor_count_min)
      params.competitor_count_min = values.competitor_count_min;
    if (values.competitor_count_max)
      params.competitor_count_max = values.competitor_count_max;
    if (values.competitor_min_price_min)
      params.competitor_min_price_min = values.competitor_min_price_min;
    if (values.competitor_min_price_max)
      params.competitor_min_price_max = values.competitor_min_price_max;
    // 上架时间：搜索晚于该日期的商品
    if (values.listing_date) {
      params.created_at_start = values.listing_date.format("YYYY-MM-DD");
    }
    if (values.sort_by) params.sort_by = values.sort_by;

    // 保留is_read过滤（默认只显示未读商品），除非有batch_id过滤
    if (!searchParams.batch_id) {
      params.is_read = false;
    }

    // 保存筛选条件到localStorage（仅在勾选"记住我的选择"时）
    if (rememberFilters) {
      const filtersToSave = {
        ...values,
        listing_date: values.listing_date
          ? values.listing_date.format("YYYY-MM-DD")
          : undefined,
      };
      localStorage.setItem(
        "productSelectionFilters",
        JSON.stringify(filtersToSave),
      );
    }

    setSearchParams(params);
    setCurrentPage(1);
    setAllProducts([]); // 清空已加载的商品
    setHasMoreData(true); // 重置标志
    setPageSize(initialPageSize); // 重置为初始pageSize
    loadingLockRef.current = false; // 重置请求锁
    lastRequestPageRef.current = 0; // 重置页码引用
    // 注意：不需要重置 isCalculated，因为只需计算一次
  };

  // 处理重置
  const handleReset = () => {
    form.resetFields();
    localStorage.removeItem("productSelectionFilters"); // 清除保存的筛选条件
    setSearchParams({ is_read: false }); // 重置时默认显示未读商品
    setCurrentPage(1);
    setAllProducts([]); // 清空已加载的商品
    setHasMoreData(true); // 重置标志
    setPageSize(initialPageSize); // 重置为初始pageSize
    setSelectedProductIds(new Set()); // 清空选择
  };

  // 切换商品选择状态
  const toggleProductSelection = (productId: number) => {
    setSelectedProductIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  // 批量标记已读
  const handleMarkAsRead = async () => {
    if (selectedProductIds.size === 0) {
      notifyWarning("操作失败", "请先选择商品");
      return;
    }

    setMarkingAsRead(true);
    try {
      const result = await api.markProductsAsRead(
        Array.from(selectedProductIds),
      );
      if (result.success) {
        notifySuccess(
          "标记成功",
          `成功标记 ${result.marked_count} 个商品为已读`,
        );

        // 如果当前是"仅显示未读"模式，立即从列表中移除已标记的商品
        if (searchParams.is_read === false) {
          setAllProducts((prev) =>
            prev.filter((p) => !selectedProductIds.has(p.id)),
          );
        }

        setSelectedProductIds(new Set()); // 清空选择
        refetchProducts(); // 刷新商品列表以确保数据一致性
      } else {
        notifyError("标记失败", "标记失败");
      }
    } catch (error) {
      notifyError("标记失败", "标记失败: " + error.message);
    } finally {
      setMarkingAsRead(false);
    }
  };

  // 显示跟卖者列表
  const showCompetitorsList = (product: api.ProductSelectionItem) => {
    setSelectedProductCompetitors(product);
    setCompetitorModalVisible(true);
  };

  // 显示商品图片
  const showProductImages = async (product: api.ProductSelectionItem) => {
    // 立即打开Modal，显示加载状态
    setSelectedProductImages([]);
    setCurrentImageIndex(0);
    setImageModalVisible(true);

    // 异步加载图片
    try {
      const response = await api.getProductDetail(product.product_id);
      if (response.success && response.data.images.length > 0) {
        // 提取图片URL数组
        const imageUrls = response.data.images.map((img) => img.url);
        setSelectedProductImages(imageUrls);
      } else {
        // 如果没有图片，关闭Modal并提示
        setImageModalVisible(false);
        notifyInfo("提示", "该商品暂无更多图片");
      }
    } catch (error) {
      // 出错时关闭Modal并提示
      setImageModalVisible(false);
      notifyError("获取失败", "获取商品图片失败");
      logger.error("获取商品图片失败:", error);
    }
  };

  // 格式化价格（OZON采集的是分，需要除以100转换为元）
  const formatPrice = (priceInFen: number | null | undefined): string => {
    if (priceInFen === null || priceInFen === undefined) return "0.00";
    return (priceInFen / 100).toFixed(2);
  };

  // 格式化百分比显示（不显示%符号）
  const formatPercentage = (value: number | null | undefined): string => {
    if (value === null || value === undefined || value === 0) return "-";
    return `${value}`;
  };

  // 格式化数量显示
  const formatNumber = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-";
    return value.toString();
  };

  // 格式化重量显示
  const formatWeight = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-";
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}kg`;
    }
    return `${value}g`;
  };

  // 格式化货币（RUB → CNY）
  const formatCurrency = (
    rubAmount: number | null | undefined,
    rate: number | null
  ): string => {
    if (!rubAmount || !rate) return "-";
    const cny = rubAmount / rate;
    if (cny >= 10000) {
      return `${(cny / 10000).toFixed(2)}万¥`;
    }
    return `${cny.toFixed(2)}¥`;
  };

  // 格式化百分比（带%符号，智能去除无意义的小数）
  const formatPercent = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-";

    // 100及以上只显示整数
    if (value >= 100) {
      return `${Math.round(value)}%`;
    }

    // 去掉无意义的小数（92.00 → 92，92.80 → 92.8）
    const formatted = value.toFixed(2);
    const trimmed = parseFloat(formatted).toString();
    return `${trimmed}%`;
  };

  // 格式化普通数字（带千分位）
  const formatNum = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-";
    return value.toLocaleString();
  };

  // 格式化日期显示
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return "-";
    return new Date(dateStr)
      .toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");
  };

  // 下载用户脚本
  const handleDownloadScript = () => {
    // 创建一个虚拟链接触发下载，添加时间戳防止浏览器缓存
    const scriptUrl =
      window.location.origin +
      `/scripts/ozon_product_selector.user.js?t=${Date.now()}`;
    const link = document.createElement("a");
    link.href = scriptUrl;
    link.download = "ozon_product_selector.user.js";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    notifySuccess("下载开始", "脚本下载已开始");
  };

  // 保存字段配置
  const saveFieldConfig = (config: FieldConfig) => {
    setFieldConfig(config);
    localStorage.setItem("productFieldConfig", JSON.stringify(config));
    notifySuccess("配置已保存", "字段配置已保存");
    setFieldConfigVisible(false);
  };

  // 重置字段配置
  const resetFieldConfig = () => {
    setFieldConfig(defaultFieldConfig);
    localStorage.removeItem("productFieldConfig");
    notifySuccess("恢复成功", "已恢复默认配置");
  };

  // 渲染商品卡片
  const renderProductCard = (product: api.ProductSelectionItem) => {
    const discount = product.original_price
      ? Math.round((1 - product.current_price / product.original_price) * 100)
      : 0;

    return (
      <Card
        key={product.id}
        hoverable
        size="small"
        className={styles.productCard}
        cover={
          product.image_url ? (
            <div
              className={styles.productCover}
              onClick={() => showProductImages(product)}
            >
              {/* 复选框 - 左上角 */}
              <Checkbox
                className={styles.productCheckbox}
                checked={selectedProductIds.has(product.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleProductSelection(product.id);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <img
                alt={product.product_name_cn}
                src={optimizeOzonImageUrl(product.image_url, 160)}
                className={styles.productImage}
              />
              <Tooltip title="打开OZON链接">
                <div
                  className={styles.linkIconOverlay}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(product.ozon_link, "_blank");
                  }}
                >
                  <LinkOutlined />
                </div>
              </Tooltip>
            </div>
          ) : (
            <div
              className={styles.productImagePlaceholder}
              onClick={() => window.open(product.ozon_link, "_blank")}
            >
              {/* 复选框 - 左上角 */}
              <Checkbox
                className={styles.productCheckbox}
                checked={selectedProductIds.has(product.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleProductSelection(product.id);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <ShoppingOutlined />
            </div>
          )
        }
      >
        <div className={styles.productCardBody}>
          {/* 商品名称 - 始终显示 */}
          <Paragraph
            ellipsis={{ rows: 2, tooltip: product.product_name_cn }}
            className={styles.productName}
          >
            {product.product_name_cn || product.product_name_ru}
          </Paragraph>

          {/* SKU - 可复制 */}
          <div className={styles.skuRow}>
            <Text type="secondary" className={styles.skuLabel}>
              SKU:{" "}
            </Text>
            <Text
              copyable={{ text: product.product_id }}
              className={styles.skuValue}
              ellipsis
            >
              {product.product_id}
            </Text>
          </div>

          {/* 价格信息 - 始终显示当前价 */}
          <div className={styles.priceContainer}>
            <div className={styles.priceRow}>
              <Text strong className={styles.currentPrice}>
                {userSymbol}
                {formatPrice(product.current_price)}
              </Text>
              {fieldConfig.originalPrice && product.original_price && (
                <Text delete className={styles.originalPrice}>
                  {userSymbol}
                  {formatPrice(product.original_price)}
                </Text>
              )}
            </div>
          </div>

          {/* 品牌 */}
          {fieldConfig.brand && (
            <div className={styles.brandInfo}>
              <Text type="secondary">品牌: </Text>
              <Text>{product.brand || "无品牌"}</Text>
            </div>
          )}

          {/* rFBS佣金 - 横向三标签 */}
          {fieldConfig.rfbsCommission && (
            <div className={styles.commissionRow}>
              <Text type="secondary">rFBS: </Text>
              <Space size={4}>
                <Tag color="success">
                  {product.rfbs_commission_low ?? "-"}
                </Tag>
                <Tag color="warning">
                  {product.rfbs_commission_mid ?? "-"}
                </Tag>
                <Tag color="error">
                  {product.rfbs_commission_high ?? "-"}
                </Tag>
              </Space>
            </div>
          )}

          {/* FBP佣金 - 横向三标签 */}
          {fieldConfig.fbpCommission && (
            <div className={styles.commissionRow}>
              <Text type="secondary">FBP: </Text>
              <Space size={4}>
                <Tag color="success">
                  {product.fbp_commission_low ?? "-"}
                </Tag>
                <Tag color="warning">
                  {product.fbp_commission_mid ?? "-"}
                </Tag>
                <Tag color="error">
                  {product.fbp_commission_high ?? "-"}
                </Tag>
              </Space>
            </div>
          )}

          {/* 月销量+月销售额 */}
          {(fieldConfig.monthlySales || fieldConfig.monthlySalesRevenue) && (
            <div className={styles.statsItem}>
              <Text type="secondary">月销: </Text>
              <Text strong>
                {product.monthly_sales_volume ? `${formatNum(product.monthly_sales_volume)} 件` : ""}{" "}
                {formatCurrency(product.monthly_sales_revenue, exchangeRate)}
              </Text>
            </div>
          )}

          {/* 日销量+日销售额 */}
          {fieldConfig.dailySales && (
            <div className={styles.statsItem}>
              <Text type="secondary">日销: </Text>
              <Text strong>
                {product.daily_sales_volume ? `${formatNum(product.daily_sales_volume)} 件` : ""}{" "}
                {formatCurrency(product.daily_sales_revenue, exchangeRate)}
              </Text>
            </div>
          )}

          {/* 销售动态+点击率 - 两列布局 */}
          {fieldConfig.salesDynamic && (
            <Row gutter={1} className={styles.statsItem}>
              <Col span={12}>
                <Text type="secondary">动态: </Text>
                <Text strong>{formatPercent(product.sales_dynamic_percent)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">点击: </Text>
                <Text strong>{formatPercent(product.click_through_rate)}</Text>
              </Col>
            </Row>
          )}

          {/* 卡片浏览量+加购率 - 两列布局 */}
          {fieldConfig.cardMetrics && (
            <Row gutter={1} className={styles.statsItem}>
              <Col span={12}>
                <Text type="secondary">卡片: </Text>
                <Text strong>{formatNum(product.card_views)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">加购: </Text>
                <Text strong>{formatPercent(product.card_add_to_cart_rate)}</Text>
              </Col>
            </Row>
          )}

          {/* 搜索浏览量+加购率 - 两列布局 */}
          {fieldConfig.searchMetrics && (
            <Row gutter={1} className={styles.statsItem}>
              <Col span={12}>
                <Text type="secondary">搜索: </Text>
                <Text strong>{formatNum(product.search_views)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">加购: </Text>
                <Text strong>{formatPercent(product.search_add_to_cart_rate)}</Text>
              </Col>
            </Row>
          )}

          {/* 促销天数+折扣+转化率 - 单行布局 */}
          {fieldConfig.promoMetrics && (
            <Row gutter={1} className={styles.statsItem}>
              <Col span={24}>
                <Text type="secondary">促销: </Text>
                <Text strong>
                  {product.promo_days ? `${product.promo_days}天` : "-"}{" "}
                  {formatPercent(product.promo_discount_percent)}{" "}
                  {formatPercent(product.promo_conversion_rate)}
                </Text>
              </Col>
            </Row>
          )}

          {/* 付费推广+份额 - 两列布局 */}
          {fieldConfig.paidPromo && (
            <Row gutter={1} className={styles.statsItem}>
              <Col span={12}>
                <Text type="secondary">付费: </Text>
                <Text strong>
                  {product.paid_promo_days ? `${product.paid_promo_days}天` : "-"}
                </Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">份额: </Text>
                <Text strong>{formatPercent(product.ad_cost_share)}</Text>
              </Col>
            </Row>
          )}

          {/* 成交率+退货率 - 两列布局 */}
          {fieldConfig.conversionMetrics && (
            <Row gutter={1} className={styles.statsItem}>
              <Col span={12}>
                <Text type="secondary">成交: </Text>
                <Text strong>{formatPercent(product.conversion_rate)}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary">退取: </Text>
                <Text strong>{formatPercent(product.return_cancel_rate)}</Text>
              </Col>
            </Row>
          )}

          {/* 平均价格+重量 - 两列布局 */}
          {(fieldConfig.avgPrice || fieldConfig.weight) && (
            <Row gutter={1} className={styles.statsItem}>
              {fieldConfig.avgPrice && (
                <Col span={12}>
                  <Text type="secondary">均价: </Text>
                  <Text strong>
                    {formatCurrency(product.avg_price, exchangeRate)}
                  </Text>
                </Col>
              )}
              {fieldConfig.weight && (
                <Col span={12}>
                  <Text type="secondary">重量: </Text>
                  <Text strong>{formatWeight(product.package_weight)}</Text>
                </Col>
              )}
            </Row>
          )}

          {/* 包装尺寸 */}
          {fieldConfig.dimensions && (
            <div className={styles.statsItem}>
              <Text type="secondary">尺寸: </Text>
              <Text strong>
                {product.package_length &&
                product.package_width &&
                product.package_height
                  ? `${product.package_length}×${product.package_width}×${product.package_height}`
                  : "-"}
              </Text>
            </div>
          )}

          {/* 发货模式 */}
          {fieldConfig.sellerMode && (
            <div className={styles.statsItem}>
              <Text type="secondary">模式: </Text>
              <Text strong>{product.seller_mode || "-"}</Text>
            </div>
          )}

          {/* 竞争对手数据 */}
          {fieldConfig.competitors && (
            <div className={styles.statsItem}>
              <Text type="secondary">跟卖: </Text>
              {product.competitor_count !== null &&
              product.competitor_count !== undefined ? (
                product.competitor_count > 0 ? (
                  <Text
                    strong
                    className={styles.competitorCount}
                    onClick={() => showCompetitorsList(product)}
                  >
                    {product.competitor_count}
                    {product.competitor_min_price !== null &&
                      product.competitor_min_price !== undefined && (
                        <>
                          （{userSymbol}
                          {formatPrice(product.competitor_min_price)}）
                        </>
                      )}
                  </Text>
                ) : (
                  <Text className={styles.placeholderText}>无跟卖</Text>
                )
              ) : (
                <Text className={styles.placeholderText}>无数据</Text>
              )}
            </div>
          )}

          {/* 评分和上架时间 - 合并为一行 */}
          {(fieldConfig.rating || fieldConfig.listingDate) && (
            <div className={styles.ratingAndDateRow}>
              {fieldConfig.rating && (
                <div className={styles.ratingSection}>
                  {product.rating ? (
                    <>
                      <StarOutlined />
                      <Text strong className={styles.ratingValue}>
                        {product.rating}
                      </Text>
                      <Text type="secondary" className={styles.reviewCount}>
                        ({product.review_count})
                      </Text>
                    </>
                  ) : (
                    <Text type="secondary" style={{ fontSize: "11px" }}>
                      -
                    </Text>
                  )}
                </div>
              )}
              {fieldConfig.listingDate && (
                <div className={styles.listingDate}>
                  <Text type="secondary" style={{ fontSize: "11px" }}>
                    {product.product_created_date
                      ? formatDate(product.product_created_date)
                      : "-"}
                  </Text>
                </div>
              )}
            </div>
          )}

          {/* 成本上限计算 - 仅在启用成本估算时显示 */}
          {enableCostEstimation && (() => {
            // 价格单位：CNY分，÷100 = CNY元 = RMB元
            const currentPriceRMB = product.current_price / 100; // 分 → RMB
            const competitorPriceRMB =
              product.competitor_min_price !== null &&
              product.competitor_min_price !== undefined
                ? product.competitor_min_price / 100
                : null;

            // 如果有跟卖价，取两者中较低的；否则取当前价
            const priceRMB =
              competitorPriceRMB !== null
                ? Math.min(currentPriceRMB, competitorPriceRMB)
                : currentPriceRMB;

            const weight = product.package_weight || 0;

            // 构建商品佣金率数据
            const commissionRates = {
              rfbs_low: product.rfbs_commission_low || undefined,
              rfbs_mid: product.rfbs_commission_mid || undefined,
              rfbs_high: product.rfbs_commission_high || undefined,
            };

            // 计算成本上限（RMB），传入汇率和佣金率数据
            const maxCost =
              weight > 0 && priceRMB > 0
                ? calculateMaxCost(
                    priceRMB,
                    weight,
                    targetProfitRate / 100,
                    packingFee,
                    exchangeRate || undefined,
                    commissionRates,
                  )
                : null;

            // 根据成本上限值确定样式
            let costClassName = styles.maxCostRow;
            if (maxCost === null) {
              costClassName = `${styles.maxCostRow} ${styles.maxCostUnavailable}`;
            } else if (maxCost < 0) {
              costClassName = `${styles.maxCostRow} ${styles.maxCostNegative}`;
            } else {
              costClassName = `${styles.maxCostRow} ${styles.maxCostPositive}`;
            }

            return (
              <div className={costClassName}>
                <Text type="secondary">成本上限: </Text>
                <Text strong>{formatMaxCost(maxCost)}</Text>
              </div>
            );
          })()}
        </div>
      </Card>
    );
  };

  return (
    <div>
      <PageTitle icon={<FilterOutlined />} title="选品助手" />
      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "search",
              label: (
                <span>
                  <SearchOutlined /> 商品搜索
                </span>
              ),
              children: (
                <>
                  {/* 搜索表单 */}
                  <Card className={styles.searchFormCard}>
                    <Form
                      form={form}
                      layout="inline"
                      onFinish={handleSearch}
                      initialValues={{ sort_by: "source_order" }}
                    >
                      <Row gutter={[16, 0]} wrap>
                        {/* 所有搜索项在同一行，根据屏幕宽度自适应换行 */}
                        <Col flex="auto" style={{ minWidth: "150px" }}>
                          <Form.Item label="品牌" name="brand">
                            <Select
                              placeholder="品牌"
                              allowClear
                              showSearch
                              style={{ width: "100%" }}
                              filterOption={(input, option) =>
                                String(option?.value ?? "")
                                  .toLowerCase()
                                  .includes(input.toLowerCase())
                              }
                            >
                              {currentBrands.map((brand) => (
                                <Option key={brand} value={brand}>
                                  {brand}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                        </Col>

                        <Col>
                          <Form.Item
                            label="上架晚于"
                            name="listing_date"
                            style={{ marginBottom: 0 }}
                          >
                            <DatePicker
                              style={{ width: "110px" }}
                              format="YYYY-MM-DD"
                              placeholder="选择日期"
                            />
                          </Form.Item>
                        </Col>

                        <Col flex="auto" style={{ minWidth: "150px" }}>
                          <Form.Item label="排序" name="sort_by">
                            <Select
                              placeholder="原始顺序"
                              style={{ width: "100%" }}
                            >
                              <Option value="source_order">原始顺序</Option>
                              <Option value="created_asc">最早导入</Option>
                              <Option value="created_desc">最新导入</Option>
                              <Option value="sales_desc">销量↓</Option>
                              <Option value="sales_asc">销量↑</Option>
                              <Option value="weight_asc">重量↑</Option>
                              <Option value="price_asc">价格↑</Option>
                              <Option value="price_desc">价格↓</Option>
                            </Select>
                          </Form.Item>
                        </Col>

                        <Col>
                          <Form.Item label="月销量" style={{ marginBottom: 0 }}>
                            <Space.Compact>
                              <Form.Item name="monthly_sales_min" noStyle>
                                <InputNumber
                                  min={0}
                                  controls={false}
                                  style={{ width: "70px" }}
                                  placeholder="最小"
                                />
                              </Form.Item>
                              <Form.Item name="monthly_sales_max" noStyle>
                                <InputNumber
                                  min={0}
                                  controls={false}
                                  style={{ width: "70px" }}
                                  placeholder="最大"
                                />
                              </Form.Item>
                            </Space.Compact>
                          </Form.Item>
                        </Col>

                        <Col>
                          <Form.Item
                            label="重量≤"
                            name="weight_max"
                            style={{ marginBottom: 0 }}
                          >
                            <InputNumber
                              min={0}
                              controls={false}
                              style={{ width: "70px" }}
                              placeholder="g"
                              suffix="g"
                            />
                          </Form.Item>
                        </Col>

                        <Col>
                          <Form.Item
                            label="跟卖者数量"
                            style={{ marginBottom: 0 }}
                          >
                            <Space.Compact>
                              <Form.Item name="competitor_count_min" noStyle>
                                <InputNumber
                                  min={0}
                                  controls={false}
                                  style={{ width: "70px" }}
                                  placeholder="最小"
                                />
                              </Form.Item>
                              <Form.Item name="competitor_count_max" noStyle>
                                <InputNumber
                                  min={0}
                                  controls={false}
                                  style={{ width: "70px" }}
                                  placeholder="最大"
                                />
                              </Form.Item>
                            </Space.Compact>
                          </Form.Item>
                        </Col>

                        <Col>
                          <Form.Item
                            label="最低跟卖价"
                            style={{ marginBottom: 0 }}
                          >
                            <Space.Compact>
                              <Form.Item
                                name="competitor_min_price_min"
                                noStyle
                              >
                                <InputNumber
                                  min={0}
                                  controls={false}
                                  style={{ width: "70px" }}
                                  placeholder={`最小`}
                                />
                              </Form.Item>
                              <Form.Item
                                name="competitor_min_price_max"
                                noStyle
                              >
                                <InputNumber
                                  min={0}
                                  controls={false}
                                  style={{ width: "70px" }}
                                  placeholder={`最大`}
                                />
                              </Form.Item>
                            </Space.Compact>
                          </Form.Item>
                        </Col>

                        {/* 成本计算参数（不参与搜索筛选） */}
                        <Col>
                          <Space>
                            <Checkbox
                              checked={enableCostEstimation}
                              onChange={(e) => setEnableCostEstimation(e.target.checked)}
                            >
                              成本估算
                            </Checkbox>
                            <Space.Compact>
                              <InputNumber
                                value={targetProfitRate}
                                onChange={(val) =>
                                  setTargetProfitRate((val as number) || 20)
                                }
                                min={0}
                                max={100}
                                formatter={getNumberFormatter(2)}
                                parser={getNumberParser()}
                                controls={false}
                                addonBefore="利润率"
                                addonAfter="%"
                                style={{ width: "150px" }}
                                disabled={!enableCostEstimation}
                              />
                            </Space.Compact>
                          </Space>
                        </Col>

                        <Col>
                          <Space.Compact>
                            <InputNumber
                              value={packingFee}
                              onChange={(val) => setPackingFee(val || 2)}
                              min={0}
                              precision={1}
                              controls={false}
                              addonBefore="打包费"
                              addonAfter="RMB"
                              style={{ width: "150px" }}
                              disabled={!enableCostEstimation}
                            />
                          </Space.Compact>
                        </Col>

                        <Col span={24}>
                          <Space>
                            <Button
                              type="primary"
                              htmlType="submit"
                              icon={<SearchOutlined />}
                            >
                              搜索
                            </Button>
                            <Button
                              onClick={handleReset}
                              icon={<ReloadOutlined />}
                            >
                              重置
                            </Button>
                            <Checkbox
                              checked={rememberFilters}
                              onChange={(e) =>
                                setRememberFilters(e.target.checked)
                              }
                            >
                              记住我的选择
                            </Checkbox>
                          </Space>
                        </Col>
                      </Row>
                    </Form>
                  </Card>

                  {/* 搜索结果统计和配置按钮 */}
                  {productsData?.data && (
                    <Row
                      justify="space-between"
                      align="middle"
                      className={styles.searchStats}
                    >
                      <Col>
                        <Space>
                          <Text>
                            已加载{" "}
                            <Text strong>{profitableProducts.length}</Text> /{" "}
                            {productsData.data.total} 件商品
                          </Text>
                          {selectedProductIds.size > 0 && (
                            <Button
                              type="primary"
                              icon={<CheckCircleOutlined />}
                              onClick={handleMarkAsRead}
                              loading={markingAsRead}
                            >
                              已阅 ({selectedProductIds.size})
                            </Button>
                          )}
                        </Space>
                      </Col>
                      <Col>
                        <Tooltip title="配置字段">
                          <Button
                            icon={<SettingOutlined />}
                            onClick={() => setFieldConfigVisible(true)}
                          />
                        </Tooltip>
                      </Col>
                    </Row>
                  )}

                  {/* 商品列表 - CSS Grid布局 */}
                  <Spin spinning={productsLoading && currentPage === 1}>
                    {profitableProducts.length > 0 ? (
                      <>
                        <div className={styles.productGrid}>
                          {profitableProducts.map((product) => (
                            <div key={product.id}>
                              {renderProductCard(product)}
                            </div>
                          ))}
                        </div>
                        {/* 加载更多提示 */}
                        {isLoadingMore && (
                          <div className={styles.loadingMore}>
                            <Spin
                              indicator={
                                <LoadingOutlined
                                  style={{ fontSize: 24 }}
                                  spin
                                />
                              }
                            />
                            <Text type="secondary" style={{ marginLeft: 12 }}>
                              加载中...
                            </Text>
                          </div>
                        )}
                        {/* 已加载完所有数据 */}
                        {!hasMoreData && profitableProducts.length > 0 && (
                          <div className={styles.loadingMore}>
                            <Text type="secondary">
                              {enableCostEstimation ? (
                                <>
                                  已加载 {allProducts.length} 件商品，显示 {profitableProducts.length} 件
                                  （已过滤 {allProducts.length - profitableProducts.length} 件利润率不达标商品）
                                </>
                              ) : (
                                <>已显示全部 {allProducts.length} 件商品</>
                              )}
                            </Text>
                          </div>
                        )}
                      </>
                    ) : (
                      <Empty description="暂无商品数据" />
                    )}
                  </Spin>
                </>
              ),
            },
            {
              key: "history",
              label: (
                <span>
                  <HistoryOutlined /> 导入历史
                </span>
              ),
              children: (
                <Table
                  dataSource={historyData?.data?.items}
                  rowKey="id"
                  pagination={{
                    current: historyPage,
                    pageSize: 10,
                    total: historyData?.data?.total,
                    onChange: (page) => setHistoryPage(page),
                  }}
                  columns={[
                    {
                      title: "文件名",
                      dataIndex: "file_name",
                      key: "file_name",
                    },
                    {
                      title: "批次链接",
                      dataIndex: "id",
                      key: "batch_link",
                      render: (id: number, record: api.ImportHistory) => (
                        <Button
                          type="link"
                          size="small"
                          icon={<LinkOutlined />}
                          onClick={() => {
                            // 切换到商品搜索标签并设置批次过滤
                            setActiveTab("search");
                            setSearchParams({ batch_id: id });
                            setCurrentPage(1);
                            setAllProducts([]);
                            setHasMoreData(true);
                            setPageSize(initialPageSize);
                            // 更新URL
                            window.history.pushState({}, "", `?batch_id=${id}`);
                          }}
                        >
                          查看批次 #{id}
                        </Button>
                      ),
                    },
                    {
                      title: "导入时间",
                      dataIndex: "import_time",
                      key: "import_time",
                      render: (time: string) =>
                        new Date(time).toLocaleString("zh-CN"),
                    },
                    {
                      title: "导入策略",
                      dataIndex: "import_strategy",
                      key: "import_strategy",
                      render: (strategy: string) => {
                        const map: Record<string, string> = {
                          skip: "跳过重复",
                          update: "更新已有",
                          append: "追加记录",
                        };
                        return map[strategy] || strategy;
                      },
                    },
                    {
                      title: "总行数",
                      dataIndex: "total_rows",
                      key: "total_rows",
                    },
                    {
                      title: "成功",
                      dataIndex: "success_rows",
                      key: "success_rows",
                      render: (val: number) => <Tag color="success">{val}</Tag>,
                    },
                    {
                      title: "更新",
                      dataIndex: "updated_rows",
                      key: "updated_rows",
                      render: (val: number) =>
                        val > 0 && <Tag color="blue">{val}</Tag>,
                    },
                    {
                      title: "跳过",
                      dataIndex: "skipped_rows",
                      key: "skipped_rows",
                      render: (val: number) =>
                        val > 0 && <Tag color="warning">{val}</Tag>,
                    },
                    {
                      title: "失败",
                      dataIndex: "failed_rows",
                      key: "failed_rows",
                      render: (val: number) =>
                        val > 0 && <Tag color="error">{val}</Tag>,
                    },
                    {
                      title: "耗时",
                      dataIndex: "process_duration",
                      key: "process_duration",
                      render: (val: number) => `${val}秒`,
                    },
                    {
                      title: "操作",
                      key: "action",
                      width: 120,
                      render: (_: any, record: api.ImportHistory) => (
                        <Popconfirm
                          title="确认删除该批次？"
                          description={`此操作将删除批次 #${record.id} 的所有商品数据，无法恢复！`}
                          onConfirm={() => {
                            deleteBatchMutation.mutate(record.id);
                          }}
                          okText="确认删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                        >
                          <Button
                            type="link"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: "guide",
              label: (
                <span>
                  <BookOutlined /> 使用指南
                </span>
              ),
              children: (
                <Space
                  direction="vertical"
                  size="large"
                  className={styles.fullWidthInput}
                >
                  {/* 工具介绍 */}
                  <Card>
                    <Title level={4}>
                      <RocketOutlined /> Ozon选品助手
                    </Title>
                    <Paragraph>
                      智能采集Ozon商品数据的浏览器工具，支持
                      <Text strong>上品帮</Text>和<Text strong>毛子ERP</Text>
                      数据源融合，自动滚动、虚拟列表适配、自动上传到EuraFlow平台。
                    </Paragraph>
                    <Alert
                      message="推荐使用浏览器扩展"
                      description="浏览器扩展版本更稳定、功能更强大，支持智能数据融合，推荐优先使用。"
                      type="success"
                      showIcon
                    />
                  </Card>

                  {/* 方式选择 */}
                  <Card>
                    <Title level={4}>选择安装方式</Title>
                    <Tabs
                      defaultActiveKey="extension"
                      items={[
                        {
                          key: "extension",
                          label: (
                            <span>
                              <RocketOutlined /> 方式一：浏览器扩展（推荐）
                            </span>
                          ),
                          children: (
                            <Space
                              direction="vertical"
                              size="large"
                              className={styles.fullWidthInput}
                            >
                              <Alert
                                message="✨ 推荐使用"
                                description="支持上品帮和毛子ERP数据融合，智能选择最优数据，更稳定、功能更强大。"
                                type="success"
                                showIcon
                              />

                              {/* 功能特性 */}
                              <Card title="✨ 核心特性" size="small">
                                <Row gutter={[16, 16]}>
                                  <Col span={12}>
                                    <Alert
                                      message="智能数据融合"
                                      description="自动从上品帮和毛子ERP提取数据，数值取最大值，品牌优先毛子ERP"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                  <Col span={12}>
                                    <Alert
                                      message="自适应降级"
                                      description="仅一个工具可用时自动降级为单源模式，确保功能可用"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                  <Col span={12}>
                                    <Alert
                                      message="虚拟滚动支持"
                                      description="完全适配OZON的虚拟滚动机制，采集更稳定"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                  <Col span={12}>
                                    <Alert
                                      message="自动上传"
                                      description="采集完成后自动上传到EuraFlow，无需手动导出"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                </Row>
                              </Card>

                              {/* 安装步骤 */}
                              <Card title="📥 安装步骤" size="small">
                                <Steps
                                  direction="vertical"
                                  current={-1}
                                  items={[
                                    {
                                      title: "下载扩展包",
                                      description: (
                                        <Space direction="vertical">
                                          <Button
                                            type="primary"
                                            icon={<DownloadOutlined />}
                                            href="/downloads/euraflow-ozon-selector-v1.2.3.zip"
                                            download
                                          >
                                            下载
                                            euraflow-ozon-selector-v1.2.3.zip
                                          </Button>
                                          <Text type="secondary">
                                            扩展包大小：约 63 KB
                                          </Text>
                                        </Space>
                                      ),
                                    },
                                    {
                                      title: "解压文件",
                                      description:
                                        "将下载的 .zip 文件解压到任意目录",
                                    },
                                    {
                                      title: "加载扩展",
                                      description: (
                                        <div>
                                          <Paragraph>
                                            1. 打开 Chrome/Edge 浏览器
                                          </Paragraph>
                                          <Paragraph>
                                            2. 访问{" "}
                                            <Text code>
                                              chrome://extensions/
                                            </Text>
                                            （Edge:{" "}
                                            <Text code>edge://extensions/</Text>
                                            ）
                                          </Paragraph>
                                          <Paragraph>
                                            3. 开启右上角的"开发者模式"
                                          </Paragraph>
                                          <Paragraph>
                                            4. 点击"加载已解压的扩展程序"
                                          </Paragraph>
                                          <Paragraph>
                                            5. 选择解压后的{" "}
                                            <Text code>dist/</Text> 目录
                                          </Paragraph>
                                        </div>
                                      ),
                                    },
                                    {
                                      title: "配置API",
                                      description: (
                                        <div>
                                          <Paragraph>
                                            点击扩展图标，配置API连接信息：
                                          </Paragraph>
                                          <Paragraph>
                                            <Text strong>API地址：</Text>
                                            <Text code>
                                              {window.location.origin}
                                            </Text>
                                          </Paragraph>
                                          <Paragraph>
                                            <Text strong>API Key：</Text>
                                            <Link href="/dashboard/ozon/api-keys">
                                              前往获取 →
                                            </Link>
                                          </Paragraph>
                                        </div>
                                      ),
                                    },
                                  ]}
                                />
                              </Card>

                              {/* 使用方法 */}
                              <Card title="🚀 使用方法" size="small">
                                <Timeline
                                  items={[
                                    {
                                      children:
                                        "访问 https://www.ozon.ru 并搜索商品",
                                      color: "blue",
                                    },
                                    {
                                      children:
                                        "确保上品帮或毛子ERP插件已安装并工作",
                                      color: "blue",
                                    },
                                    {
                                      children: "页面右上角会出现控制面板",
                                      color: "blue",
                                    },
                                    {
                                      children: "设置目标采集数量（默认100）",
                                      color: "green",
                                    },
                                    {
                                      children: '点击"开始采集"按钮',
                                      color: "green",
                                    },
                                    {
                                      children: "等待自动采集完成",
                                      color: "green",
                                    },
                                    {
                                      children: "数据自动上传到EuraFlow",
                                      color: "green",
                                    },
                                  ]}
                                />
                              </Card>
                            </Space>
                          ),
                        },
                        {
                          key: "price-calculator",
                          label: (
                            <span>
                              <CalculatorOutlined /> 真实售价计算器
                            </span>
                          ),
                          children: (
                            <Space
                              direction="vertical"
                              size="large"
                              className={styles.fullWidthInput}
                            >
                              <Alert
                                message="💰 OZON真实售价计算器"
                                description="在OZON商品页面自动计算并显示商品的真实售价，帮助您快速评估利润空间。"
                                type="success"
                                showIcon
                              />

                              {/* 功能介绍 */}
                              <Card title="✨ 功能特性" size="small">
                                <Row gutter={[16, 16]}>
                                  <Col span={12}>
                                    <Alert
                                      message="智能计算"
                                      description="根据Ozon Card价格和常规价格，智能计算真实售价"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                  <Col span={12}>
                                    <Alert
                                      message="分级规则"
                                      description="根据价格区间自动应用不同的计算规则"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                  <Col span={12}>
                                    <Alert
                                      message="实时更新"
                                      description="监听页面变化，切换规格或货币时自动更新"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                  <Col span={12}>
                                    <Alert
                                      message="醒目显示"
                                      description="橙色高亮提示框，真实售价一目了然"
                                      type="info"
                                      showIcon
                                    />
                                  </Col>
                                </Row>
                              </Card>

                              {/* 计算规则 */}
                              <Card title="📊 计算规则说明" size="small">
                                <Timeline
                                  items={[
                                    {
                                      children: (
                                        <div>
                                          <Text strong>
                                            低价商品（黑标价 &lt; 90 ¥）
                                          </Text>
                                          <br />
                                          <Text code>真实售价 = 黑标价</Text>
                                          <br />
                                          <Text type="secondary">
                                            示例：黑标价 85¥ → 真实售价 85¥
                                          </Text>
                                        </div>
                                      ),
                                      color: "green",
                                    },
                                    {
                                      children: (
                                        <div>
                                          <Text strong>
                                            中价商品（90 ¥ ≤ 黑标价 ≤ 120 ¥）
                                          </Text>
                                          <br />
                                          <Text code>
                                            真实售价 = 黑标价 + 5
                                          </Text>
                                          <br />
                                          <Text type="secondary">
                                            示例：黑标价 95¥ → 真实售价 100¥
                                          </Text>
                                        </div>
                                      ),
                                      color: "blue",
                                    },
                                    {
                                      children: (
                                        <div>
                                          <Text strong>
                                            高价商品（黑标价 &gt; 120 ¥）
                                          </Text>
                                          <br />
                                          <Text code>
                                            真实售价 =
                                            ceil((黑标价-绿标价)×2.5+黑标价)
                                          </Text>
                                          <br />
                                          <Text type="secondary">
                                            示例：绿标价 1219¥，黑标价 1258¥ →
                                            真实售价 1356¥
                                          </Text>
                                        </div>
                                      ),
                                      color: "orange",
                                    },
                                    {
                                      children: (
                                        <div>
                                          <Text strong>卢布货币（₽）</Text>
                                          <br />
                                          <Text type="warning">
                                            显示提示："⚠️ 请切换货币为CNY"
                                          </Text>
                                        </div>
                                      ),
                                      color: "red",
                                    },
                                  ]}
                                />
                              </Card>

                              {/* 安装步骤 */}
                              <Card title="📥 安装步骤" size="small">
                                <Steps
                                  direction="vertical"
                                  current={-1}
                                  items={[
                                    {
                                      title: "安装 Tampermonkey",
                                      description: (
                                        <Space wrap>
                                          <Link
                                            href="https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo"
                                            target="_blank"
                                          >
                                            <Button
                                              type="link"
                                              icon={<LinkOutlined />}
                                            >
                                              Chrome/Edge 扩展商店
                                            </Button>
                                          </Link>
                                          <Link
                                            href="https://addons.mozilla.org/zh-CN/firefox/addon/tampermonkey/"
                                            target="_blank"
                                          >
                                            <Button
                                              type="link"
                                              icon={<LinkOutlined />}
                                            >
                                              Firefox 扩展商店
                                            </Button>
                                          </Link>
                                        </Space>
                                      ),
                                    },
                                    {
                                      title: "下载脚本",
                                      description: (
                                        <Space direction="vertical">
                                          <Button
                                            type="primary"
                                            icon={<DownloadOutlined />}
                                            href="/scripts/ozon-real-price-calculator.user.js"
                                            download
                                          >
                                            下载
                                            ozon-real-price-calculator.user.js
                                          </Button>
                                          <Text type="secondary">
                                            版本：v1.0.3 | 文件大小：约 10 KB
                                          </Text>
                                        </Space>
                                      ),
                                    },
                                    {
                                      title: "安装脚本",
                                      description: (
                                        <div>
                                          <Paragraph>
                                            方法一：直接拖拽
                                          </Paragraph>
                                          <ul>
                                            <li>
                                              将下载的 .user.js
                                              文件拖拽到浏览器窗口
                                            </li>
                                            <li>
                                              Tampermonkey
                                              会自动识别并弹出安装确认
                                            </li>
                                            <li>点击"安装"按钮完成</li>
                                          </ul>
                                          <Paragraph>
                                            方法二：手动安装
                                          </Paragraph>
                                          <ul>
                                            <li>
                                              点击 Tampermonkey 图标 →
                                              "管理面板"
                                            </li>
                                            <li>点击"+"新建脚本</li>
                                            <li>复制脚本内容并粘贴</li>
                                            <li>按 Ctrl+S（或 Cmd+S）保存</li>
                                          </ul>
                                        </div>
                                      ),
                                    },
                                    {
                                      title: "开始使用",
                                      description: (
                                        <div>
                                          <Paragraph>
                                            访问任意 OZON 商品页面（如：
                                            <Link
                                              href="https://www.ozon.ru/product/"
                                              target="_blank"
                                            >
                                              https://www.ozon.ru/product/...
                                            </Link>
                                            ）
                                          </Paragraph>
                                          <Paragraph>
                                            脚本会自动在价格区域上方显示橙色的真实售价提示框
                                          </Paragraph>
                                        </div>
                                      ),
                                    },
                                  ]}
                                />
                              </Card>

                              {/* 使用示例 */}
                              <Card title="🎨 显示效果" size="small">
                                <Alert
                                  message="真实售价：1356.00 ¥"
                                  type="warning"
                                  showIcon
                                  description="在商品价格上方会显示类似这样的橙色高亮提示框，让您一眼就能看到真实售价。"
                                  style={{
                                    background: "#FFE7BA",
                                    border: "2px solid #FF9800",
                                  }}
                                />
                              </Card>

                              {/* 常见问题 */}
                              <Card title="❓ 常见问题" size="small">
                                <Collapse
                                  items={[
                                    {
                                      key: "calc-faq-1",
                                      label: "Q: 脚本没有运行怎么办？",
                                      children: (
                                        <div>
                                          <Paragraph>请检查：</Paragraph>
                                          <ul>
                                            <li>Tampermonkey 扩展是否已启用</li>
                                            <li>
                                              脚本在管理面板中是否处于"启用"状态
                                            </li>
                                            <li>
                                              访问的 URL 是否为 OZON
                                              商品页面（https://www.ozon.ru/product/...）
                                            </li>
                                            <li>刷新页面（Ctrl+R 或 Cmd+R）</li>
                                          </ul>
                                        </div>
                                      ),
                                    },
                                    {
                                      key: "calc-faq-2",
                                      label: 'Q: 为什么提示"请切换货币为CNY"？',
                                      children: (
                                        <Paragraph>
                                          计算公式基于人民币（¥）价格设计。如果页面显示的是卢布（₽），请在
                                          OZON
                                          页面右上角切换货币为人民币（CNY）后再使用。
                                        </Paragraph>
                                      ),
                                    },
                                    {
                                      key: "calc-faq-3",
                                      label: "Q: 计算结果准确吗？",
                                      children: (
                                        <Paragraph>
                                          真实售价是基于 OZON
                                          平台价格策略估算的参考价格，考虑了会员折扣、平台佣金等因素。实际价格请以最终结算为准。
                                        </Paragraph>
                                      ),
                                    },
                                    {
                                      key: "calc-faq-4",
                                      label: "Q: 价格变化时会自动更新吗？",
                                      children: (
                                        <Paragraph>
                                          是的！脚本会实时监听页面变化，当您切换商品规格或货币时，真实售价会自动重新计算和更新（延迟
                                          500ms）。
                                        </Paragraph>
                                      ),
                                    },
                                  ]}
                                />
                              </Card>
                            </Space>
                          ),
                        },
                        {
                          key: "userscript",
                          label: (
                            <span>
                              <CodeOutlined /> 方式三：用户脚本（旧版）
                            </span>
                          ),
                          children: (
                            <Space
                              direction="vertical"
                              size="large"
                              className={styles.fullWidthInput}
                            >
                              <Alert
                                message="⚠️ 旧版本"
                                description="仅支持上品帮数据源，功能较基础。推荐使用浏览器扩展版本。"
                                type="warning"
                                showIcon
                              />

                              <Card title="📥 安装步骤" size="small">
                                <Steps
                                  direction="vertical"
                                  current={-1}
                                  items={[
                                    {
                                      title: "安装Tampermonkey",
                                      description: (
                                        <Space wrap>
                                          <Link
                                            href="https://www.tampermonkey.net/"
                                            target="_blank"
                                          >
                                            <Button
                                              type="link"
                                              icon={<LinkOutlined />}
                                            >
                                              Chrome/Edge - Tampermonkey
                                            </Button>
                                          </Link>
                                          <Link
                                            href="https://addons.mozilla.org/zh-CN/firefox/addon/greasemonkey/"
                                            target="_blank"
                                          >
                                            <Button
                                              type="link"
                                              icon={<LinkOutlined />}
                                            >
                                              Firefox - Greasemonkey
                                            </Button>
                                          </Link>
                                        </Space>
                                      ),
                                    },
                                    {
                                      title: "下载用户脚本",
                                      description: (
                                        <Button
                                          type="primary"
                                          icon={<DownloadOutlined />}
                                          onClick={handleDownloadScript}
                                        >
                                          下载 ozon_product_selector.user.js
                                        </Button>
                                      ),
                                    },
                                    {
                                      title: "安装脚本",
                                      description:
                                        "将下载的 .user.js 文件拖拽到浏览器，Tampermonkey会自动识别",
                                    },
                                  ]}
                                />
                              </Card>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  </Card>

                  {/* 数据字段说明 */}
                  <Card title="📊 采集字段说明">
                    <Paragraph>
                      选品助手会采集以下<Text strong>42个字段</Text>的商品数据：
                    </Paragraph>
                    <Row gutter={[8, 8]}>
                      {[
                        "商品ID",
                        "商品名称",
                        "商品链接",
                        "商品图片",
                        "品牌",
                        "销售价格",
                        "原价",
                        "商品评分",
                        "评价次数",
                        "rFBS各档佣金",
                        "FBP各档佣金",
                        "月销量",
                        "月销售额",
                        "日销量",
                        "日销售额",
                        "包装重量",
                        "包装尺寸",
                        "商品体积",
                        "跟卖者数量",
                        "最低跟卖价",
                        "成交率",
                        "商品可用性",
                        "广告费用份额",
                        "配送时间",
                        "卖家类型",
                        "商品创建日期",
                      ].map((field) => (
                        <Col span={6} key={field}>
                          <Tag color="blue">{field}</Tag>
                        </Col>
                      ))}
                    </Row>
                  </Card>

                  {/* 常见问题 */}
                  <Card title="❓ 常见问题">
                    <Collapse
                      items={[
                        {
                          key: "faq-0",
                          label: "Q: 浏览器扩展和用户脚本有什么区别？",
                          children: (
                            <div>
                              <Paragraph>
                                <Text strong>浏览器扩展（推荐）：</Text>
                              </Paragraph>
                              <ul>
                                <li>
                                  ✅
                                  支持上品帮和毛子ERP数据融合，智能选择最优数据
                                </li>
                                <li>✅ 更稳定，无需依赖Tampermonkey</li>
                                <li>✅ 功能更强大，适配性更好</li>
                              </ul>
                              <Paragraph>
                                <Text strong>用户脚本（旧版）：</Text>
                              </Paragraph>
                              <ul>
                                <li>仅支持上品帮数据源</li>
                                <li>需要安装Tampermonkey</li>
                                <li>功能较基础，推荐升级到扩展版本</li>
                              </ul>
                            </div>
                          ),
                        },
                        {
                          key: "faq-1",
                          label: "Q: API连接测试失败？",
                          children: (
                            <div>
                              <Paragraph>请检查以下几点：</Paragraph>
                              <ul>
                                <li>API地址是否正确（不要包含 /api 等路径）</li>
                                <li>
                                  API Key是否有效（可在API Keys页面重新生成）
                                </li>
                                <li>网络是否通畅（检查VPN或代理设置）</li>
                                <li>浏览器控制台是否有CORS错误</li>
                              </ul>
                            </div>
                          ),
                        },
                        {
                          key: "faq-2",
                          label: "Q: 数据采集不完整或没有数据？",
                          children: (
                            <div>
                              <Paragraph>请确认：</Paragraph>
                              <ul>
                                <li>
                                  <Text strong>必须</Text>
                                  安装上品帮或毛子ERP插件 -
                                  扩展依赖这些工具提供的数据
                                </li>
                                <li>
                                  等待时间是否足够 -
                                  默认滚动等待1秒，可在配置中调整
                                </li>
                                <li>检查浏览器控制台是否有错误信息</li>
                                <li>
                                  确保在OZON商品列表页面使用（搜索结果或分类页面）
                                </li>
                              </ul>
                            </div>
                          ),
                        },
                        {
                          key: "faq-3",
                          label: "Q: 如何查看采集到的数据？",
                          children: (
                            <Paragraph>
                              数据上传成功后，切换到"商品搜索"标签页即可查看和筛选导入的商品。
                              您也可以在"导入历史"标签页查看每次导入的详细记录。
                            </Paragraph>
                          ),
                        },
                        {
                          key: "faq-4",
                          label: "Q: 扩展无法加载或报错？",
                          children: (
                            <div>
                              <Paragraph>请尝试：</Paragraph>
                              <ul>
                                <li>确认已开启浏览器的"开发者模式"</li>
                                <li>重新加载扩展：移除后重新添加</li>
                                <li>检查是否选择了正确的dist/目录</li>
                                <li>查看浏览器扩展管理页面的错误信息</li>
                              </ul>
                            </div>
                          ),
                        },
                      ]}
                    />
                  </Card>

                  {/* 技术支持 */}
                  <Card>
                    <Alert
                      message="需要帮助？"
                      description={
                        <div>
                          <Paragraph>
                            如果遇到问题或需要技术支持，请联系管理员或查看项目文档。
                          </Paragraph>
                          <Paragraph>
                            <Text type="secondary">
                              浏览器扩展版本：v1.0.0 | 用户脚本版本：v4.3 |
                              更新时间：2024-10-18
                            </Text>
                          </Paragraph>
                        </div>
                      }
                      type="info"
                      showIcon
                      icon={<QuestionCircleOutlined />}
                    />
                  </Card>
                </Space>
              ),
            },
          ]}
        />

        {/* 跟卖者列表弹窗 */}
        <Modal
          title="跟卖者列表"
          open={competitorModalVisible}
          onCancel={() => setCompetitorModalVisible(false)}
          footer={[
            <Button
              key="close"
              onClick={() => setCompetitorModalVisible(false)}
            >
              关闭
            </Button>,
          ]}
          width={600}
        >
          {selectedProductCompetitors && (
            <div>
              <div className={styles.competitorModalHeader}>
                <Text strong>
                  {selectedProductCompetitors.product_name_cn ||
                    selectedProductCompetitors.product_name_ru}
                </Text>
              </div>
              <Alert
                message={`共发现 ${selectedProductCompetitors.competitor_count || 0} 个跟卖者`}
                type="info"
                className={styles.competitorModalAlert}
              />
              <div className={styles.competitorModalContent}>
                {selectedProductCompetitors.competitor_min_price ? (
                  <>
                    <Text type="secondary">跟卖者数据已从选品导入中获取</Text>
                    <div className={styles.competitorMinPrice}>
                      <Text>最低跟卖价: </Text>
                      <Text strong className={styles.competitorMinPriceValue}>
                        {userSymbol}
                        {formatPrice(
                          selectedProductCompetitors.competitor_min_price,
                        )}
                      </Text>
                    </div>
                  </>
                ) : (
                  <Text type="secondary">暂无跟卖者价格数据</Text>
                )}
              </div>
            </div>
          )}
        </Modal>

        {/* 商品图片浏览 */}
        <ImagePreview
          images={selectedProductImages}
          visible={imageModalVisible}
          initialIndex={currentImageIndex}
          onClose={() => setImageModalVisible(false)}
        />

        {/* 字段配置Modal */}
        <FieldConfigModal
          visible={fieldConfigVisible}
          fieldConfig={fieldConfig}
          onFieldConfigChange={setFieldConfig}
          onSave={saveFieldConfig}
          onReset={resetFieldConfig}
          onCancel={() => setFieldConfigVisible(false)}
        />

      </Card>
    </div>
  );
};

export default ProductSelection;
