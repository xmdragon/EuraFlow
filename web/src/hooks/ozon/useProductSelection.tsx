/**
 * OZON 选品助手 - 业务逻辑 Hook
 *
 * 集中管理选品页面的所有状态和业务逻辑
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, App } from 'antd';
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';

import { calculateMaxCost } from '@/pages/ozon/profitCalculator';
import * as api from '@/services/productSelectionApi';
import { getExchangeRate, type ExchangeRate } from '@/services/exchangeRateApi';
import type { FieldConfig } from '@/components/ozon/selection/FieldConfigModal';
import { defaultFieldConfig } from '@/components/ozon/selection/FieldConfigModal';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';
import { logger } from '@/utils/logger';

/**
 * useProductSelection Hook 返回值接口
 */
export interface UseProductSelectionReturn {
  // 表单实例
  form: FormInstance;
  modal: ReturnType<typeof App.useApp>['modal'];

  // 标签页管理
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // 分页状态
  currentPage: number;
  pageSize: number;
  historyPage: number;
  setHistoryPage: (page: number) => void;

  // 搜索参数
  searchParams: api.ProductSearchParams;

  // 品牌数据
  currentBrands: string[];

  // 商品数据
  allProducts: api.ProductSelectionItem[];
  profitableProducts: api.ProductSelectionItem[];
  productsLoading: boolean;
  refetchProducts: () => void;
  totalCount: number;

  // 汇率
  exchangeRate: number | null;

  // 导入历史
  historyData?: api.ImportHistoryResponse;
  refetchHistory: () => void;

  // 加载状态
  isLoadingMore: boolean;
  hasMoreData: boolean;

  // 选择状态
  selectedProductIds: Set<number>;
  toggleProductSelection: (productId: number) => void;
  markingAsRead: boolean;
  handleMarkAsRead: () => Promise<void>;

  // Modal 状态
  competitorModalVisible: boolean;
  setCompetitorModalVisible: (visible: boolean) => void;
  selectedProductCompetitors: api.ProductSelectionItem | null;
  imageModalVisible: boolean;
  setImageModalVisible: (visible: boolean) => void;
  selectedProductImages: string[];
  currentImageIndex: number;

  // 字段配置
  fieldConfig: FieldConfig;
  fieldConfigVisible: boolean;
  setFieldConfigVisible: (visible: boolean) => void;
  saveFieldConfig: (config: FieldConfig) => void;
  resetFieldConfig: () => void;

  // 成本估算
  enableCostEstimation: boolean;
  setEnableCostEstimation: (val: boolean) => void;
  targetProfitRate: number;
  setTargetProfitRate: (val: number) => void;
  packingFee: number;
  setPackingFee: (val: number) => void;

  // 记住选择
  rememberFilters: boolean;
  setRememberFilters: (val: boolean) => void;

  // 事件处理
  handleSearch: (values: any) => void;
  handleReset: () => void;
  handleClearData: () => void;
  showCompetitorsList: (product: api.ProductSelectionItem) => void;
  showProductImages: (product: api.ProductSelectionItem) => Promise<void>;

  // 批次操作
  handleDeleteBatch: (batchId: number) => void;
  handleBatchDelete: (batchIds: number[]) => void;
  handleViewBatch: (batchId: number) => void;

  // 动态布局
  itemsPerRow: number;
  initialPageSize: number;
}

/**
 * 选品助手业务逻辑 Hook
 */
export const useProductSelection = (): UseProductSelectionReturn => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  // ==================== 状态管理 ====================

  // 标签页管理
  const [activeTab, setActiveTab] = useState('search');

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [historyPage, setHistoryPage] = useState(1);

  // 搜索参数
  const [searchParams, setSearchParams] = useState<api.ProductSearchParams>({});

  // Modal 状态
  const [competitorModalVisible, setCompetitorModalVisible] = useState(false);
  const [selectedProductCompetitors, setSelectedProductCompetitors] =
    useState<api.ProductSelectionItem | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedProductImages, setSelectedProductImages] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // 选择状态
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [markingAsRead, setMarkingAsRead] = useState(false);

  // 无限滚动相关状态
  const [allProducts, setAllProducts] = useState<api.ProductSelectionItem[]>([]);
  const [itemsPerRow, setItemsPerRow] = useState(6);
  const [initialPageSize, setInitialPageSize] = useState(24);
  const [loadMoreSize, setLoadMoreSize] = useState(14);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(true);
  const [isCalculated, setIsCalculated] = useState(false);
  const loadingLockRef = useRef(false);
  const lastRequestPageRef = useRef(0);
  const [lastId, setLastId] = useState<number>(0);

  // 字段配置状态
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>(() => {
    const saved = localStorage.getItem('productFieldConfig');
    return saved ? JSON.parse(saved) : defaultFieldConfig;
  });
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);

  // 成本计算相关状态
  const [enableCostEstimation, setEnableCostEstimation] = useState<boolean>(() => {
    const saved = localStorage.getItem('productSelectionEnableCostEstimation');
    return saved ? JSON.parse(saved) : true;
  });
  const [targetProfitRate, setTargetProfitRate] = useState<number>(() => {
    const saved = localStorage.getItem('productSelectionProfitRate');
    return saved ? parseFloat(saved) : 20;
  });
  const [packingFee, setPackingFee] = useState<number>(() => {
    const saved = localStorage.getItem('productSelectionPackingFee');
    return saved ? parseFloat(saved) : 0;
  });

  // 记住我的选择状态
  const [rememberFilters, setRememberFilters] = useState<boolean>(() => {
    const saved = localStorage.getItem('productSelectionRememberFilters');
    return saved ? JSON.parse(saved) : false;
  });

  // ==================== useEffect - localStorage 持久化 ====================

  useEffect(() => {
    localStorage.setItem(
      'productSelectionEnableCostEstimation',
      JSON.stringify(enableCostEstimation)
    );
  }, [enableCostEstimation]);

  useEffect(() => {
    localStorage.setItem('productSelectionProfitRate', targetProfitRate.toString());
  }, [targetProfitRate]);

  useEffect(() => {
    localStorage.setItem('productSelectionPackingFee', packingFee.toString());
  }, [packingFee]);

  useEffect(() => {
    localStorage.setItem('productSelectionRememberFilters', JSON.stringify(rememberFilters));
  }, [rememberFilters]);

  // ==================== useEffect - URL参数和筛选条件恢复 ====================

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batchId = params.get('batch_id');
    const isReadParam = params.get('is_read');

    const savedFilters = localStorage.getItem('productSelectionFilters');
    const shouldRemember = localStorage.getItem('productSelectionRememberFilters');
    let restoredParams: api.ProductSearchParams = {};

    if (savedFilters && shouldRemember === 'true') {
      try {
        const parsed = JSON.parse(savedFilters);
        const { _batch_id, _is_read, ...filters } = parsed;
        restoredParams = filters;

        if (parsed.listing_date) {
          form.setFieldsValue({
            ...parsed,
            listing_date: parsed.listing_date ? dayjs(parsed.listing_date) : undefined,
          });
        } else {
          form.setFieldsValue(parsed);
        }
      } catch (e) {
        logger.error('恢复筛选条件失败:', e);
      }
    }

    if (batchId) {
      setSearchParams({
        ...restoredParams,
        batch_id: parseInt(batchId),
      });
    } else if (isReadParam === null || isReadParam === 'false') {
      setSearchParams({ ...restoredParams, is_read: false });
    } else {
      if (Object.keys(restoredParams).length > 0) {
        setSearchParams((prev) => ({ ...prev, ...restoredParams }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== useEffect - 动态计算布局 ====================

  useEffect(() => {
    const calculateItemsPerRow = () => {
      const sider = document.querySelector('.ant-layout-sider');
      const siderWidth = sider ? sider.clientWidth : 240;
      const availableWidth = window.innerWidth - siderWidth;
      const itemWidth = 180;
      const columns = Math.max(1, Math.floor(availableWidth / itemWidth));
      setItemsPerRow(columns);

      const calculatedInitialSize = Math.min(columns * 4, 100);
      setInitialPageSize(calculatedInitialSize);

      const calculatedLoadMoreSize = Math.min(columns * 2, 50);
      setLoadMoreSize(calculatedLoadMoreSize);

      setIsCalculated(true);
    };

    calculateItemsPerRow();
    window.addEventListener('resize', calculateItemsPerRow);
    return () => window.removeEventListener('resize', calculateItemsPerRow);
  }, []);

  // ==================== useQuery - 数据查询 ====================

  const { data: brandsData } = useQuery({
    queryKey: ['productSelectionBrands'],
    queryFn: api.getBrands,
  });

  const currentBrands = useMemo(() => {
    return brandsData?.data || [];
  }, [brandsData]);

  const {
    data: productsData,
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ['productSelectionProducts', searchParams, currentPage, lastId],
    queryFn: () =>
      api.searchProducts({
        ...searchParams,
        after_id: currentPage === 1 ? 0 : lastId,
        limit: currentPage === 1 ? initialPageSize : loadMoreSize,
      }),
    enabled: activeTab === 'search' && isCalculated,
  });

  const { data: exchangeRateData } = useQuery<ExchangeRate>({
    queryKey: ['exchangeRate', 'CNY', 'RUB'],
    queryFn: () => getExchangeRate('CNY', 'RUB', false),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  const exchangeRate = exchangeRateData ? parseFloat(exchangeRateData.rate) : null;

  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['productSelectionHistory', historyPage],
    queryFn: () => api.getImportHistory(historyPage, 10),
    enabled: activeTab === 'history',
  });

  // ==================== useEffect - 数据累积 ====================

  useEffect(() => {
    if (!productsData?.data) return;

    const { items = [], next_cursor, has_more } = productsData.data;

    if (currentPage === 1) {
      setAllProducts(items);
      setHasMoreData(has_more ?? false);
      if (items.length > 0) {
        setLastId(items[items.length - 1].id);
      }
    } else if (items.length > 0) {
      setAllProducts((prev) => [...prev, ...items]);
      setHasMoreData(has_more ?? false);
      setLastId(items[items.length - 1].id);
    } else {
      setHasMoreData(false);
    }

    loadingLockRef.current = false;
    setIsLoadingMore(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsData?.data]);

  // ==================== useEffect - 无限滚动监听 ====================

  useEffect(() => {
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);

      scrollTimeout = setTimeout(() => {
        if (isLoadingMore || !hasMoreData || loadingLockRef.current) return;

        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrollPercent = (scrollTop + windowHeight) / documentHeight;

        if (scrollPercent > 0.8) {
          loadingLockRef.current = true;
          setIsLoadingMore(true);
          setCurrentPage((prev) => prev + 1);
        }
      }, 200);
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [isLoadingMore, hasMoreData, initialPageSize, itemsPerRow]);

  // ==================== useMemo - 过滤可盈利商品 ====================

  const profitableProducts = useMemo(() => {
    if (!enableCostEstimation) {
      return allProducts;
    }

    return allProducts.filter((product) => {
      const currentPriceRMB = product.current_price / 100;
      const competitorPriceRMB = product.competitor_min_price
        ? product.competitor_min_price / 100
        : null;
      const priceRMB = competitorPriceRMB
        ? Math.min(currentPriceRMB, competitorPriceRMB)
        : currentPriceRMB;

      const weight = product.package_weight || 0;

      if (weight <= 0 || priceRMB <= 0) return true;

      const commissionRates = {
        rfbs_low: product.rfbs_commission_low || undefined,
        rfbs_mid: product.rfbs_commission_mid || undefined,
        rfbs_high: product.rfbs_commission_high || undefined,
      };

      const maxCost = calculateMaxCost(
        priceRMB,
        weight,
        targetProfitRate / 100,
        packingFee,
        exchangeRate || undefined,
        commissionRates
      );

      return maxCost !== null && maxCost >= 0;
    });
  }, [allProducts, targetProfitRate, packingFee, exchangeRate, enableCostEstimation]);

  // ==================== useMutation - 删除批次 ====================

  const deleteBatchMutation = useMutation({
    mutationFn: api.deleteBatch,
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess(
          '批次删除成功',
          `已删除批次 #${data.data.batch_id}，共 ${data.data.deleted_products} 个商品`
        );
        refetchProducts();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ['productSelectionBrands'] });
      }
    },
    onError: (error: Error) => {
      notifyError('删除失败', '删除批次失败: ' + error.message);
    },
  });

  // ==================== useMutation - 批量删除批次 ====================

  const deleteBatchesMutation = useMutation({
    mutationFn: api.deleteBatches,
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess(
          '批量删除成功',
          `已删除 ${data.deleted_batches} 个批次，共 ${data.deleted_products} 个商品`
        );
        refetchProducts();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ['productSelectionBrands'] });
      }
    },
    onError: (error: Error) => {
      notifyError('批量删除失败', error.message);
    },
  });

  // ==================== useMutation - 清空数据 ====================

  const clearDataMutation = useMutation({
    mutationFn: api.clearAllData,
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess(
          '数据清空成功',
          `已清空 ${data.data.deleted_products} 个商品和 ${data.data.deleted_history} 条导入历史`
        );
        refetchProducts();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ['productSelectionBrands'] });
      } else {
        notifyError('清空失败', data.error || '清空数据失败');
      }
    },
    onError: (error: Error) => {
      notifyError('清空失败', '清空数据失败: ' + error.message);
    },
  });

  // ==================== 事件处理函数 ====================

  const handleClearData = () => {
    modal.confirm({
      title: '确认清空所有数据？',
      content: (
        <div>
          <p style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
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
      okText: '确认清空',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => {
        clearDataMutation.mutate();
      },
    });
  };

  const handleSearch = (values: any) => {
    const params: api.ProductSearchParams = {};

    if (values.brand) params.brand = values.brand;
    if (values.monthly_sales_min) params.monthly_sales_min = values.monthly_sales_min;
    if (values.monthly_sales_max) params.monthly_sales_max = values.monthly_sales_max;
    if (values.weight_max) params.weight_max = values.weight_max;
    if (values.competitor_count_min) params.competitor_count_min = values.competitor_count_min;
    if (values.competitor_count_max) params.competitor_count_max = values.competitor_count_max;
    if (values.competitor_min_price_min)
      params.competitor_min_price_min = values.competitor_min_price_min;
    if (values.competitor_min_price_max)
      params.competitor_min_price_max = values.competitor_min_price_max;
    if (values.listing_date) {
      params.created_at_start = values.listing_date.format('YYYY-MM-DD');
    }
    if (values.sort_by) params.sort_by = values.sort_by;

    if (!searchParams.batch_id) {
      params.is_read = false;
    }

    if (rememberFilters) {
      const filtersToSave = {
        ...values,
        listing_date: values.listing_date ? values.listing_date.format('YYYY-MM-DD') : undefined,
      };
      localStorage.setItem('productSelectionFilters', JSON.stringify(filtersToSave));
    }

    setSearchParams(params);
    setCurrentPage(1);
    setAllProducts([]);
    setHasMoreData(true);
    setPageSize(initialPageSize);
    loadingLockRef.current = false;
    lastRequestPageRef.current = 0;
  };

  const handleReset = () => {
    form.resetFields();
    localStorage.removeItem('productSelectionFilters');
    setSearchParams({ is_read: false });
    setCurrentPage(1);
    setAllProducts([]);
    setHasMoreData(true);
    setPageSize(initialPageSize);
    setSelectedProductIds(new Set());
  };

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

  const handleMarkAsRead = async () => {
    if (selectedProductIds.size === 0) {
      notifyWarning('操作失败', '请先选择商品');
      return;
    }

    setMarkingAsRead(true);
    try {
      const result = await api.markProductsAsRead(Array.from(selectedProductIds));
      if (result.success) {
        notifySuccess('标记成功', `成功标记 ${result.marked_count} 个商品为已读`);

        if (searchParams.is_read === false) {
          setAllProducts((prev) => prev.filter((p) => !selectedProductIds.has(p.id)));
        }

        setSelectedProductIds(new Set());
        refetchProducts();
      } else {
        notifyError('标记失败', '标记失败');
      }
    } catch (error: any) {
      notifyError('标记失败', '标记失败: ' + error.message);
    } finally {
      setMarkingAsRead(false);
    }
  };

  const showCompetitorsList = (product: api.ProductSelectionItem) => {
    setSelectedProductCompetitors(product);
    setCompetitorModalVisible(true);
  };

  const showProductImages = async (product: api.ProductSelectionItem) => {
    setSelectedProductImages([]);
    setCurrentImageIndex(0);
    setImageModalVisible(true);

    try {
      const response = await api.getProductDetail(product.product_id);
      if (response.success && response.data.images.length > 0) {
        const imageUrls = response.data.images.map((img) => img.url);
        setSelectedProductImages(imageUrls);
      } else {
        setImageModalVisible(false);
        notifyInfo('提示', '该商品暂无更多图片');
      }
    } catch (error) {
      setImageModalVisible(false);
      notifyError('获取失败', '获取商品图片失败');
      logger.error('获取商品图片失败:', error);
    }
  };

  const saveFieldConfig = (config: FieldConfig) => {
    setFieldConfig(config);
    localStorage.setItem('productFieldConfig', JSON.stringify(config));
    notifySuccess('配置已保存', '字段配置已保存');
    setFieldConfigVisible(false);
  };

  const resetFieldConfig = () => {
    setFieldConfig(defaultFieldConfig);
    localStorage.removeItem('productFieldConfig');
    notifySuccess('恢复成功', '已恢复默认配置');
  };

  const handleDeleteBatch = (batchId: number) => {
    modal.confirm({
      title: '确认删除该批次？',
      content: `此操作将删除批次 #${batchId} 的所有商品数据，无法恢复！`,
      okText: '确认删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => {
        deleteBatchMutation.mutate(batchId);
      },
    });
  };

  const handleBatchDelete = (batchIds: number[]) => {
    if (batchIds.length === 0) {
      notifyWarning('请选择批次', '请至少选择一个批次进行删除');
      return;
    }

    modal.confirm({
      title: `确认删除 ${batchIds.length} 个批次？`,
      content: (
        <div>
          <p style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
            ⚠️ 此操作将删除所选批次的所有商品数据，无法恢复！
          </p>
          <p>批次ID: {batchIds.join(', ')}</p>
        </div>
      ),
      okText: '确认删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => {
        deleteBatchesMutation.mutate(batchIds);
      },
    });
  };

  const handleViewBatch = (batchId: number) => {
    setActiveTab('search');
    setSearchParams({ batch_id: batchId });
    setCurrentPage(1);
    setAllProducts([]);
    setHasMoreData(true);
    setPageSize(initialPageSize);
    window.history.pushState({}, '', `?batch_id=${batchId}`);
  };

  // ==================== 返回值 ====================

  return {
    form,
    modal,
    activeTab,
    setActiveTab,
    currentPage,
    pageSize,
    historyPage,
    setHistoryPage,
    searchParams,
    currentBrands,
    allProducts,
    profitableProducts,
    productsLoading,
    refetchProducts,
    totalCount: productsData?.data?.total || 0,
    exchangeRate,
    historyData,
    refetchHistory,
    isLoadingMore,
    hasMoreData,
    selectedProductIds,
    toggleProductSelection,
    markingAsRead,
    handleMarkAsRead,
    competitorModalVisible,
    setCompetitorModalVisible,
    selectedProductCompetitors,
    imageModalVisible,
    setImageModalVisible,
    selectedProductImages,
    currentImageIndex,
    fieldConfig,
    fieldConfigVisible,
    setFieldConfigVisible,
    saveFieldConfig,
    resetFieldConfig,
    enableCostEstimation,
    setEnableCostEstimation,
    targetProfitRate,
    setTargetProfitRate,
    packingFee,
    setPackingFee,
    rememberFilters,
    setRememberFilters,
    handleSearch,
    handleReset,
    handleClearData,
    showCompetitorsList,
    showProductImages,
    handleDeleteBatch,
    handleBatchDelete,
    handleViewBatch,
    itemsPerRow,
    initialPageSize,
  };
};
