/**
 * Ozon 打包发货页面 - 只显示等待备货的订单
 */
import {
  SyncOutlined,
  PrinterOutlined,
  TruckOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  PlusOutlined,
  RocketOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Space,
  Card,
  Input,
  Select,
  Tabs,
  Form,
  Alert,
  Typography,
  App,
} from 'antd';
import type { InputRef } from 'antd';
import dayjs from 'dayjs';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useCurrency } from '../../hooks/useCurrency';
import {
  statusConfig,
  operationStatusConfig,
  formatPackingPrice,
  formatDeliveryMethodText,
  formatDeliveryMethodTextWhite,
} from '../../utils/packingHelpers';

import styles from './PackingShipment.module.scss';

import DiscardOrderModal from '@/components/ozon/DiscardOrderModal';
import DomesticTrackingModal from '@/components/ozon/DomesticTrackingModal';
import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import OrderCardComponent, { type OrderCard } from '@/components/ozon/packing/OrderCardComponent';
import PackingSearchBar, { type SearchParams } from '@/components/ozon/packing/PackingSearchBar';
import PrepareStockModal from '@/components/ozon/PrepareStockModal';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import UpdateBusinessInfoModal from '@/components/ozon/UpdateBusinessInfoModal';
import PrintErrorModal from '@/components/ozon/packing/PrintErrorModal';
import EditNotesModal from '@/components/ozon/packing/EditNotesModal';
import ImagePreview from '@/components/ImagePreview';
import PrintLabelModal from '@/components/ozon/packing/PrintLabelModal';
import ShipOrderModal from '@/components/ozon/packing/ShipOrderModal';
import ScanResultTable from '@/components/ozon/packing/ScanResultTable';
import PageTitle from '@/components/PageTitle';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import { usePermission } from '@/hooks/usePermission';
import { useQuickMenu } from '@/hooks/useQuickMenu';
import { useBatchPrint } from '@/hooks/useBatchPrint';
import { useBatchSync } from '@/hooks/useBatchSync';
import { readAndValidateClipboard, markClipboardRejected } from '@/hooks/useClipboard';
import * as ozonApi from '@/services/ozon';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';

const { Option } = Select;
const { Text } = Typography;

// 订单商品行数据结构（用于表格展示）
interface _OrderItemRow {
  key: string; // 唯一标识：posting_number + item_index
  item: ozonApi.OrderItem; // 商品明细
  itemIndex: number; // 商品索引（从0开始）
  posting: ozonApi.PostingWithOrder; // 货件信息
  order: ozonApi.Order; // 订单信息
  isFirstItem: boolean; // 是否是第一个商品（用于rowSpan）
  itemCount: number; // 该posting的商品总数（用于rowSpan）
}

// 格式化标签统计信息，只显示非零值
const formatLabelStats = (total: number, cached: number, fetched: number): string => {
  const parts: string[] = [];
  if (cached > 0) parts.push(`缓存:${cached}`);
  if (fetched > 0) parts.push(`新获取:${fetched}`);
  const statsStr = parts.length > 0 ? `（${parts.join(', ')}）` : '';
  return `成功加载${total}个标签${statsStr}`;
};

const PackingShipment: React.FC = () => {
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const { currency: userCurrency } = useCurrency();
  const { copyToClipboard } = useCopy();
  const { formatDateTime } = useDateTime();
  const { canOperate, canSync } = usePermission();
  const [urlSearchParams] = useSearchParams();
  const { addQuickMenu, isInQuickMenu } = useQuickMenu();

  // 批量打印Hook
  const {
    isPrinting,
    printErrors,
    printSuccessPostings,
    printErrorModalVisible,
    batchPrint,
    closePrintErrorModal,
  } = useBatchPrint({
    maxPostings: 20,
  });

  // 批量同步Hook
  const { isSyncing: isBatchSyncing, syncProgress, batchSync } = useBatchSync({
    onComplete: (_successCount, _failedCount) => {
      // 刷新数据
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
      resetAndRefresh();
    },
  });

  // 状态管理 - 分页和滚动加载
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = React.useRef(1); // 使用 ref 跟踪当前页，避免 useEffect 依赖
  const [itemsPerRow, setItemsPerRow] = useState(6); // 每行显示数量
  const [allPostings, setAllPostings] = useState<ozonApi.PostingWithOrder[]>([]); // 累积所有已加载的posting
  const [isLoadingMore, setIsLoadingMore] = useState(false); // 是否正在加载更多
  const [hasMoreData, setHasMoreData] = useState(true); // 是否还有更多数据
  const [accumulatedImageMap, setAccumulatedImageMap] = useState<Record<string, string>>({}); // 累积的图片映射
  // 始终默认为null（全部店铺），不从localStorage读取
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [filterForm] = Form.useForm();
  const [shipForm] = Form.useForm();
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [shipModalVisible, setShipModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.PostingWithOrder | null>(null);

  // 操作状态Tab（4个状态：等待备货、分配中、已分配、单号确认）
  const [operationStatus, setOperationStatus] = useState<string>('awaiting_stock');

  // 追踪用户访问过的标签（用于按需加载统计数据）
  const [, setVisitedTabs] = useState<Set<string>>(new Set(['awaiting_stock']));

  // 操作弹窗状态
  const [prepareStockModalVisible, setPrepareStockModalVisible] = useState(false);
  const [updateBusinessInfoModalVisible, setUpdateBusinessInfoModalVisible] = useState(false);
  const [domesticTrackingModalVisible, setDomesticTrackingModalVisible] = useState(false);
  const [discardOrderModalVisible, setDiscardOrderModalVisible] = useState(false);
  const [currentPosting, setCurrentPosting] = useState<ozonApi.PostingWithOrder | null>(null);

  // 进货价格历史弹窗状态
  const [priceHistoryModalVisible, setPriceHistoryModalVisible] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [selectedProductName, setSelectedProductName] = useState<string>('');

  // 搜索参数状态（只支持 posting_number 搜索）
  const [searchParams, setSearchParams] = useState<SearchParams>({});

  // 排序状态（desc=倒序/新订单在前，asc=顺序/旧订单在前）
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // 批量打印标签状态
  const [selectedPostingNumbers, setSelectedPostingNumbers] = useState<string[]>([]);

  // 扫描单号状态
  const [scanTrackingNumber, setScanTrackingNumber] = useState<string>('');
  const [scanResults, setScanResults] = useState<ozonApi.PostingWithOrder[]>([]); // 改为数组，支持多个结果
  const [scanError, setScanError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  // 扫描结果分页状态
  const [scanOffset, setScanOffset] = useState(0);
  const [scanHasMore, setScanHasMore] = useState(false);
  const [scanTotal, setScanTotal] = useState(0);
  const [currentScanTrackingNumber, setCurrentScanTrackingNumber] = useState<string>(''); // 当前搜索的单号
  const [isLoadingScanMore, setIsLoadingScanMore] = useState(false);
  // 扫描结果的批量打印状态
  const [scanSelectedPostings, setScanSelectedPostings] = useState<string[]>([]);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  // 扫描结果的打印状态过滤
  const [scanPrintStatusFilter, setScanPrintStatusFilter] = useState<'all' | 'printed' | 'unprinted'>('all');
  // 扫描输入框自动填充状态
  const [isScanAutoFilled, setIsScanAutoFilled] = useState(false);
  // 记录上次自动填充的内容（避免重复填充）
  const [lastAutoFilledContent, setLastAutoFilledContent] = useState<string>('');
  // 编辑备注弹窗状态
  const [editNotesModalVisible, setEditNotesModalVisible] = useState(false);
  const [editingPosting, setEditingPosting] = useState<ozonApi.PostingWithOrder | null>(null);

  // 采购平台筛选状态（单选）
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  // 采购信息筛选状态（用于待备货标签页）
  const [selectedPurchaseInfo, setSelectedPurchaseInfo] = useState<string>('all');

  // 打印标签弹窗状态（保留用于其他tab）
  const [showPrintLabelModal, setShowPrintLabelModal] = useState(false);
  const [printLabelUrl, setPrintLabelUrl] = useState<string>('');
  const [currentPrintingPosting, setCurrentPrintingPosting] = useState<string>('');
  const [currentPrintingPostings, setCurrentPrintingPostings] = useState<string[]>([]); // 批量打印的postings

  // 扫描输入框的 ref，用于重新聚焦
  const scanInputRef = React.useRef<InputRef>(null);

  // 图片预览状态
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');

  // 打印状态过滤现在由后端处理，前端直接使用 scanResults
  // 但为了兼容性，我们仍然保留 filteredScanResults 变量名
  const filteredScanResults = scanResults;

  // 固定的行数配置
  const INITIAL_ROWS = 4; // 第一次加载4行
  const LOAD_MORE_ROWS = 2; // 后续每次加载2行

  // 计算每行显示数量（根据屏幕宽度预估）
  const calculateItemsPerRow = React.useCallback(() => {
    const screenWidth = window.innerWidth;
    const menuWidth = 250; // 左边菜单宽度（估计值）
    const columns = Math.max(1, Math.floor((screenWidth - menuWidth - 10) / 170));
    setItemsPerRow(columns);
  }, []);

  // 组件挂载时立即计算，并监听窗口大小变化
  useEffect(() => {
    calculateItemsPerRow();
    window.addEventListener('resize', calculateItemsPerRow);
    return () => window.removeEventListener('resize', calculateItemsPerRow);
  }, [calculateItemsPerRow]);

  // 从 URL 参数初始化状态（用于通知点击跳转）
  useEffect(() => {
    const tab = urlSearchParams.get('tab');
    const postingNumber = urlSearchParams.get('posting_number');

    // 如果 URL 有 tab 参数，设置操作状态
    if (tab && ['awaiting_stock', 'allocating', 'allocated', 'tracking_confirmed', 'shipping', 'printed', 'scan'].includes(tab)) {
      setOperationStatus(tab);
    }

    // 如果 URL 有 posting_number 参数，设置搜索过滤
    if (postingNumber) {
      setSearchParams({ posting_number: postingNumber });
    }
  }, []); // 仅在组件挂载时执行一次

  // 标签切换时滚动到页面顶部
  const isInitialMount = useRef(true);
  useEffect(() => {
    // 跳过初始挂载
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // 标签切换时，平滑滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [operationStatus]);

  // 查询店铺列表（用于显示店铺名称）
  const { data: shopsData } = useQuery({
    queryKey: ['ozonShops'],
    queryFn: () => ozonApi.getShops(),
    staleTime: 300000, // 5分钟缓存
  });

  // 建立 shop_id → shop_name 的映射（显示格式：俄文 [中文]）
  const shopNameMap = React.useMemo(() => {
    const map: Record<number, string> = {};
    if (shopsData?.data) {
      shopsData.data.forEach((shop) => {
        map[shop.id] = shop.shop_name + (shop.shop_name_cn ? ` [${shop.shop_name_cn}]` : '');
      });
    }
    return map;
  }, [shopsData]);

  // 查询打包发货订单列表
  // 第一个标签"等待备货"使用OZON原生状态，其他标签使用operation_status
  const {
    data: ordersData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['packingOrders', selectedShop, operationStatus, searchParams, currentPage, itemsPerRow, selectedPlatform, selectedPurchaseInfo, sortOrder],
    queryFn: () => {
      // 计算当前请求的pageSize和offset
      const isFirstPage = currentPageRef.current === 1;
      const pageSize = isFirstPage ? itemsPerRow * INITIAL_ROWS : itemsPerRow * LOAD_MORE_ROWS;

      // 计算offset：第一页为0，后续页为 初始行数 + (当前页-2) × 加载行数
      const offset = isFirstPage
        ? 0
        : itemsPerRow * INITIAL_ROWS + (currentPageRef.current - 2) * itemsPerRow * LOAD_MORE_ROWS;

      // 第一个标签使用OZON原生状态，其他标签使用operation_status
      const queryParams: Record<string, string | number | undefined | null> = {
        shop_id: selectedShop,
        ...searchParams, // 展开所有搜索参数（posting_number/sku/tracking_number/domestic_tracking_number）
        offset, // 传递计算好的offset
        sort_order: sortOrder, // 排序顺序
      };

      if (operationStatus === 'awaiting_stock') {
        // 同时检查 OZON 状态和操作状态，确保已经点了"备货"的订单不会重复出现
        queryParams.ozon_status = 'awaiting_packaging,awaiting_deliver';
        queryParams.operation_status = 'awaiting_stock';
      } else {
        queryParams.operation_status = operationStatus;
      }

      // 已分配和单号确认页面的采购平台筛选
      if ((operationStatus === 'allocated' || operationStatus === 'tracking_confirmed') && selectedPlatform !== 'all') {
        queryParams.source_platform = selectedPlatform;
      }

      // 待备货页面的采购信息筛选
      if (operationStatus === 'awaiting_stock' && selectedPurchaseInfo !== 'all') {
        queryParams.has_purchase_info = selectedPurchaseInfo;
      }

      return ozonApi.getPackingOrders(1, pageSize, queryParams);
    },
    enabled: operationStatus !== 'scan', // 扫描标签页不使用此查询，使用 searchPostingByTracking
    refetchOnMount: 'always', // 每次切换标签页都重新请求API，避免缓存导致数据不一致
    // 禁用自动刷新，避免与无限滚动冲突
    // refetchInterval: 60000,
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
    staleTime: 30000, // 数据30秒内不会被认为是过期的
  });

  // 当店铺、状态、搜索参数、平台筛选、采购信息筛选或排序变化时，重置分页并强制刷新
  useEffect(() => {
    setCurrentPage(1);
    currentPageRef.current = 1; // 同步更新 ref
    setAllPostings([]);
    setHasMoreData(true);
    setAccumulatedImageMap({}); // 重置图片映射
    // 强制使缓存失效，确保重新请求
    queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
  }, [selectedShop, operationStatus, searchParams, selectedPlatform, selectedPurchaseInfo, sortOrder, queryClient]);

  // 当收到新数据时，累积到 allPostings
  useEffect(() => {
    if (ordersData?.data) {
      // 累积图片映射
      const newImageMap: Record<string, string> = {};

      // 从后端返回的 offer_id_images 中提取
      if (ordersData.offer_id_images) {
        Object.assign(newImageMap, ordersData.offer_id_images);
      }

      // 从订单项中提取图片作为备用
      ordersData.data.forEach((order) => {
        if (order.items) {
          order.items.forEach((item) => {
            if (item.offer_id && item.image && !newImageMap[item.offer_id]) {
              newImageMap[item.offer_id] = item.image;
            }
          });
        }
      });

      // 合并到累积的映射中
      setAccumulatedImageMap((prev) => ({ ...prev, ...newImageMap }));

      // 展开订单为货件
      const flattened: ozonApi.PostingWithOrder[] = [];
      ordersData.data.forEach((order: ozonApi.Order) => {
        // 如果订单有 postings，展开每个 posting
        if (order.postings && order.postings.length > 0) {
          order.postings.forEach((posting) => {
            flattened.push({
              ...posting,
              order: order, // 关联完整的订单信息
              shop_id: order.shop_id,
              items: posting.items || order.items,
              tracking_number: posting.tracking_number || order.tracking_number,
            });
          });
        } else {
          // 如果订单没有 postings，使用订单本身的 posting_number 创建一个虚拟 posting
          if (order.posting_number) {
            flattened.push({
              id: order.id,
              posting_number: order.posting_number,
              status: order.status,
              shipment_date: order.shipment_date,
              delivery_method_name: order.delivery_method,
              warehouse_name: order.warehouse_name,
              packages_count: 1,
              is_cancelled: order.status === 'cancelled',
              order: order,
            } as ozonApi.PostingWithOrder);
          }
        }
      });

      // 后端已做精确匹配，无需前端二次过滤

      // 批量更新状态 - 使用 ref 避免依赖循环
      // React 18 会自动批处理所有 setState，只触发一次渲染
      let newPostingsLength = 0;
      setAllPostings((prev) => {
        if (currentPageRef.current === 1) {
          // 第一页，直接使用新数据
          newPostingsLength = flattened.length;
          return flattened;
        }

        // 构建已有posting的Set（使用posting_number作为唯一标识）
        const existingNumbers = new Set(prev.map((p) => p.posting_number));

        // 过滤掉已存在的posting（去重）
        const newPostings = flattened.filter((p) => !existingNumbers.has(p.posting_number));

        // 合并数据
        const result = [...prev, ...newPostings];
        newPostingsLength = result.length;
        return result;
      });

      // 这些 setState 会和上面的 setAllPostings 批处理，只触发一次渲染
      // 判断是否还有更多数据：累积的数据量小于总数
      const hasMore = newPostingsLength < (ordersData.total || 0);
      setHasMoreData(hasMore);
      setIsLoadingMore(false);
    }
  }, [ordersData]); // 仅依赖 ordersData 对象

  // 滚动监听：滚动到底部加载下一页
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollPercent = (scrollTop + windowHeight) / documentHeight;

      // 滚动到80%时触发加载
      if (scrollPercent > 0.8) {
        // 扫描模式使用专用的加载函数
        if (operationStatus === 'scan') {
          if (!isLoadingScanMore && scanHasMore && currentScanTrackingNumber) {
            handleLoadMoreScanResults();
          }
        } else {
          // 非扫描模式使用原有的分页逻辑
          if (!isLoadingMore && hasMoreData) {
            setIsLoadingMore(true);
            setCurrentPage((prev) => {
              const next = prev + 1;
              currentPageRef.current = next; // 同步更新 ref
              return next;
            });
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isLoadingMore, hasMoreData, operationStatus, isLoadingScanMore, scanHasMore, currentScanTrackingNumber]);

  // 展开订单数据为货件维度（PostingWithOrder 数组）- 使用累积的数据
  const postingsData = React.useMemo<ozonApi.PostingWithOrder[]>(() => {
    return allPostings;
  }, [allPostings]);

  // 重置分页并刷新数据的辅助函数
  const resetAndRefresh = React.useCallback(() => {
    setCurrentPage(1);
    currentPageRef.current = 1; // 同步更新 ref
    setAllPostings([]);
    setHasMoreData(true);
    setAccumulatedImageMap({});
    // 延迟执行 refetch，确保状态已更新
    setTimeout(() => refetch(), 0);
  }, [refetch]);

  // 查询各操作状态的数量统计（合并为单个请求）
  const { data: statsData } = useQuery({
    queryKey: ['packingStats', selectedShop, searchParams],
    queryFn: () =>
      ozonApi.getPackingStats({
        shop_id: selectedShop,
        ...searchParams, // 展开所有搜索参数
      }),
    staleTime: 30000, // 30秒缓存
  });

  // 各状态的数量
  const statusCounts = {
    awaiting_stock: statsData?.data?.awaiting_stock || 0,
    allocating: statsData?.data?.allocating || 0,
    allocated: statsData?.data?.allocated || 0,
    tracking_confirmed: statsData?.data?.tracking_confirmed || 0,
    shipping: statsData?.data?.shipping || 0,
    printed: statsData?.data?.printed || 0,
  };

  // 缓存已创建的 OrderCard 对象，避免重复创建导致 memo 失效
  const orderCardsCache = React.useRef<Map<string, OrderCard>>(new Map());

  // 将 PostingWithOrder 数组转换为 OrderCard 数组（每个商品一张卡片）
  const orderCards = React.useMemo<OrderCard[]>(() => {
    const cards: OrderCard[] = [];
    const newCache = new Map<string, OrderCard>();

    postingsData.forEach((posting) => {
      // 优先使用 posting.products（从 raw_payload 提取的该 posting 的商品）
      // 如果不存在，降级使用 posting.order.items（订单级别的商品汇总）
      const products =
        posting.products && posting.products.length > 0
          ? posting.products
          : posting.order.items || [];

      if (products.length === 0) {
        // 如果没有商品，创建一张空卡片
        const key = `${posting.posting_number}_0`;
        const existingCard = orderCardsCache.current.get(key);

        // 检查是否可以复用缓存的 card（posting 引用相同）
        if (existingCard && existingCard.posting === posting) {
          cards.push(existingCard);
          newCache.set(key, existingCard);
        } else {
          const newCard: OrderCard = {
            key,
            posting: posting,
            product: null,
            order: posting.order,
          };
          cards.push(newCard);
          newCache.set(key, newCard);
        }
      } else {
        // 为每个商品创建一张卡片
        products.forEach((product, index) => {
          const key = `${posting.posting_number}_${index}`;
          const existingCard = orderCardsCache.current.get(key);

          // 检查是否可以复用缓存的 card（posting 和 product 引用相同）
          if (existingCard && existingCard.posting === posting && existingCard.product === product) {
            cards.push(existingCard);
            newCache.set(key, existingCard);
          } else {
            const newCard: OrderCard = {
              key,
              posting: posting,
              product: product,
              order: posting.order,
            };
            cards.push(newCard);
            newCache.set(key, newCard);
          }
        });
      }
    });

    // 更新缓存
    orderCardsCache.current = newCache;

    return cards;
  }, [postingsData]);

  // offer_id到图片的映射，使用累积的映射
  const offerIdImageMap = accumulatedImageMap;

  // 使用统一的价格格式化函数 - 使用 useCallback 稳定引用
  const formatPrice = React.useCallback(
    (price: string | number): string => {
      return formatPackingPrice(price, userCurrency);
    },
    [userCurrency]
  );

  // 发货
  const shipOrderMutation = useMutation({
    mutationFn: ozonApi.shipOrder,
    onSuccess: () => {
      notifySuccess('发货成功', '订单已成功发货');
      setShipModalVisible(false);
      shipForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
    },
    onError: (error: Error) => {
      notifyError('发货失败', `发货失败: ${error.message}`);
    },
  });

  // 取消订单
  const _cancelOrderMutation = useMutation({
    mutationFn: ({ postingNumber, reason }: { postingNumber: string; reason: string }) =>
      ozonApi.cancelOrder(postingNumber, reason),
    onSuccess: () => {
      notifySuccess('订单已取消', '订单已成功取消');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
    },
    onError: (error: Error) => {
      notifyError('取消失败', `取消失败: ${error.message}`);
    },
  });

  // 注意：废弃订单现在使用 DiscardOrderModal 组件处理，不再需要单独的 mutation

  // 异步执行批量同步（后台任务）
  // 批量同步处理函数（直接执行，不弹窗确认）
  const handleBatchSync = () => {
    logger.info('批量同步按钮被点击', { allPostingsLength: allPostings.length });
    // 在后台执行同步任务（非阻塞）
    batchSync([...allPostings]);
  };

  // 稳定化的回调函数 - 使用 useCallback 避免重复渲染
  const handleShowDetailCallback = React.useCallback(
    (order: ozonApi.Order, posting: ozonApi.Posting) => {
      showOrderDetail(order, posting);
    },
    []
  );

  const handleOpenImagePreviewCallback = React.useCallback((url: string) => {
    setPreviewImageUrl(url);
    setImagePreviewVisible(true);
  }, []);

  const handleCloseImagePreview = React.useCallback(() => {
    setImagePreviewVisible(false);
  }, []);

  const handleOpenPriceHistoryCallback = React.useCallback((sku: string, productName: string) => {
    setSelectedSku(sku);
    setSelectedProductName(productName);
    setPriceHistoryModalVisible(true);
  }, []);

  const handlePrepareStockCallback = React.useCallback((posting: ozonApi.PostingWithOrder) => {
    setCurrentPosting(posting);
    setPrepareStockModalVisible(true);
  }, []);

  const handleUpdateBusinessInfoCallback = React.useCallback(
    (posting: ozonApi.PostingWithOrder) => {
      setCurrentPosting(posting);
      setUpdateBusinessInfoModalVisible(true);
    },
    []
  );

  const handleSubmitTrackingCallback = React.useCallback((posting: ozonApi.PostingWithOrder) => {
    setCurrentPosting(posting);
    setDomesticTrackingModalVisible(true);
  }, []);

  const handleDiscardOrderCallback = React.useCallback(
    (posting: ozonApi.PostingWithOrder) => {
      setCurrentPosting(posting);
      setDiscardOrderModalVisible(true);
    },
    []
  );

  const handleCheckboxChangeCallback = React.useCallback(
    (postingNumber: string, checked: boolean) => {
      if (checked) {
        setSelectedPostingNumbers((prev) => [...prev, postingNumber]);
      } else {
        setSelectedPostingNumbers((prev) => prev.filter((pn) => pn !== postingNumber));
      }
    },
    []
  );

  // 表格列定义（商品维度 - 4列布局）

  // 处理函数
  const showOrderDetail = (order: ozonApi.Order, posting?: ozonApi.Posting | ozonApi.PostingWithOrder) => {
    setSelectedOrder(order);
    setSelectedPosting((posting as ozonApi.PostingWithOrder) || null);
    setDetailModalVisible(true);
  };

  // 检查是否需要打印确认（国内单号≥2 或 商品数量>1 或 多个商品）
  const checkNeedsConfirmation = (postings: (ozonApi.Posting | ozonApi.PostingWithOrder)[]): boolean => {
    return postings.some((posting) => {
      // 检查国内单号数量
      const trackingCount = posting.domestic_tracking_numbers?.length || 0;
      if (trackingCount >= 2) {
        logger.info('触发打印确认：国内单号≥2', { posting_number: posting.posting_number, trackingCount });
        return true;
      }

      // 检查商品数量 - 兼容 products 和 items 两种字段
      const items = posting.products || posting.items || [];

      // 检查是否有多个商品
      if (items.length > 1) {
        logger.info('触发打印确认：多个商品', { posting_number: posting.posting_number, itemsCount: items.length });
        return true;
      }

      // 检查单个商品的数量是否>1
      const hasHighQuantity = items.some((product: ozonApi.OrderItem) => product.quantity > 1);
      if (hasHighQuantity) {
        logger.info('触发打印确认：商品数量>1', { posting_number: posting.posting_number });
        return true;
      }

      return false;
    });
  };

  const handleBatchPrint = async () => {
    // 获取要打印的 posting 对象
    const postingsToPrint = allPostings.filter((p) => selectedPostingNumbers.includes(p.posting_number));

    // 检查是否需要确认
    const needsConfirm = checkNeedsConfirmation(postingsToPrint);

    if (needsConfirm) {
      // 需要确认，弹出确认对话框
      modal.confirm({
        title: '确认打印',
        content: '确认订单商品数量是否正确？',
        okText: '确认打印',
        cancelText: '取消',
        onOk: async () => {
          const result = await batchPrint(selectedPostingNumbers);
          if (result?.success && result.pdf_url) {
            // 全部成功 - 在新标签页打开PDF
            window.open(result.pdf_url, '_blank');
            // 清空选择
            setSelectedPostingNumbers([]);
          } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
            // 部分成功 - 打开PDF
            window.open(result.pdf_url, '_blank');
          }
        },
      });
    } else {
      // 不需要确认，直接打印
      const result = await batchPrint(selectedPostingNumbers);
      if (result?.success && result.pdf_url) {
        window.open(result.pdf_url, '_blank');
        setSelectedPostingNumbers([]);
      } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        window.open(result.pdf_url, '_blank');
      }
    }
  };

  // 扫描输入框获得焦点时，尝试自动填充剪贴板内容
  const handleScanInputFocus = async () => {
    // 如果输入框已有内容，不覆盖
    if (scanTrackingNumber) {
      return;
    }

    // 读取并验证剪贴板内容
    const clipboardText = await readAndValidateClipboard();
    if (clipboardText) {
      // 如果与上次自动填充的内容相同，跳过填充
      if (clipboardText === lastAutoFilledContent) {
        logger.info('剪贴板内容与上次自动填充内容相同，跳过填充:', clipboardText);
        return;
      }

      setScanTrackingNumber(clipboardText);
      setIsScanAutoFilled(true);
      setLastAutoFilledContent(clipboardText);
    }
  };

  // 清除扫描输入框内容
  const handleClearScanInput = () => {
    // 仅当是自动填充的内容时，才标记为拒绝
    if (scanTrackingNumber && isScanAutoFilled) {
      markClipboardRejected(scanTrackingNumber);
    }
    setScanTrackingNumber('');
    setIsScanAutoFilled(false);
    scanInputRef.current?.focus();
  };

  // 扫描单号查询
  const handleScanSearch = async () => {
    if (!scanTrackingNumber.trim()) {
      notifyWarning('查询失败', '请输入或扫描追踪号码');
      return;
    }

    // 防止重复提交
    if (isScanning) {
      return;
    }

    const trackingNumberToSearch = scanTrackingNumber.trim();

    setIsScanning(true);
    setScanResults([]);
    setScanError('');
    setScanSelectedPostings([]);
    setScanPrintStatusFilter('all'); // 重置打印状态过滤
    // 重置分页状态
    setScanOffset(0);
    setScanHasMore(false);
    setScanTotal(0);
    setCurrentScanTrackingNumber(trackingNumberToSearch); // 保存当前搜索的单号

    try {
      // 首次搜索使用默认的 'all' 打印状态
      const result = await ozonApi.searchPostingByTracking(trackingNumberToSearch, 0, 20, 'all');
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        // API返回数组格式，直接显示表格
        setScanResults(result.data);
        setScanTotal(result.total || result.data.length);
        setScanHasMore(result.has_more || false);
        setScanOffset(result.data.length); // 下次加载从这里开始
        setScanError('');
      } else if (result.data && !Array.isArray(result.data)) {
        // 兼容旧版API（返回单个对象），转为数组
        setScanResults([result.data]);
        setScanTotal(1);
        setScanHasMore(false);
        setScanError('');
      } else {
        setScanResults([]);
        setScanError('未找到对应的订单');
      }
    } catch (_error: unknown) {
      setScanResults([]);
      setScanError(`查询失败: ${(_error as { response?: { data?: { error?: { title?: string } } }; message?: string })?.response?.data?.error?.title || (_error as { message?: string })?.message}`);
    } finally {
      // 无论成功失败都清空输入框
      setScanTrackingNumber('');
      setIsScanning(false);
      // 重新聚焦到输入框，方便下次扫描
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 100);
    }
  };

  // 扫描结果加载更多
  const handleLoadMoreScanResults = async () => {
    if (!currentScanTrackingNumber || isLoadingScanMore || !scanHasMore) {
      return;
    }

    setIsLoadingScanMore(true);
    try {
      const result = await ozonApi.searchPostingByTracking(
        currentScanTrackingNumber,
        scanOffset,
        20,
        scanPrintStatusFilter
      );
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        // 追加到现有结果
        setScanResults((prev) => [...prev, ...result.data]);
        setScanOffset((prev) => prev + result.data.length);
        setScanHasMore(result.has_more || false);
      } else {
        setScanHasMore(false);
      }
    } catch (error) {
      logger.error('加载更多扫描结果失败', error);
      notifyError('加载失败', '加载更多结果失败，请重试');
    } finally {
      setIsLoadingScanMore(false);
    }
  };

  // 切换打印状态过滤时重新查询
  const handlePrintStatusFilterChange = async (newFilter: 'all' | 'printed' | 'unprinted') => {
    // 更新过滤状态
    setScanPrintStatusFilter(newFilter);

    // 如果没有当前搜索的单号，不需要查询
    if (!currentScanTrackingNumber) {
      return;
    }

    // 重置分页状态
    setScanOffset(0);
    setScanHasMore(false);
    setScanTotal(0);
    setScanSelectedPostings([]);
    setIsLoadingScanMore(true);

    try {
      const result = await ozonApi.searchPostingByTracking(
        currentScanTrackingNumber,
        0,
        20,
        newFilter
      );
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        setScanResults(result.data);
        setScanTotal(result.total || result.data.length);
        setScanHasMore(result.has_more || false);
        setScanOffset(result.data.length);
      } else {
        setScanResults([]);
        setScanTotal(0);
        setScanHasMore(false);
      }
    } catch (error) {
      logger.error('切换打印状态过滤失败', error);
      notifyError('查询失败', '切换打印状态过滤失败，请重试');
    } finally {
      setIsLoadingScanMore(false);
    }
  };

  // 从打印弹窗标记为已打印（支持单个和批量）
  const handleMarkPrintedFromModal = async () => {
    // 判断是单个还是批量
    const isBatch = currentPrintingPostings.length > 0;
    const postingsToMark = isBatch ? currentPrintingPostings : [currentPrintingPosting];

    if (postingsToMark.length === 0 || (postingsToMark.length === 1 && !postingsToMark[0])) {
      return;
    }

    try {
      // 批量标记
      const promises = postingsToMark.map((pn) => ozonApi.markPostingPrinted(pn));
      await Promise.all(promises);

      notifySuccess(
        '标记成功',
        isBatch ? `已标记${postingsToMark.length}个订单为已打印` : '已标记为已打印'
      );

      // 关闭弹窗
      setShowPrintLabelModal(false);
      setPrintLabelUrl('');
      setCurrentPrintingPosting('');
      setCurrentPrintingPostings([]);

      // 刷新扫描结果
      // 如果当前筛选是"未打印"，则移除已打印的项；否则更新状态
      if (scanPrintStatusFilter === 'unprinted') {
        setScanResults((prev) =>
          prev.filter((p) => !postingsToMark.includes(p.posting_number))
        );
      } else {
        setScanResults((prev) =>
          prev.map((p) =>
            postingsToMark.includes(p.posting_number)
              ? { ...p, operation_status: 'printed', label_printed_at: new Date().toISOString() }
              : p
          )
        );
      }

      // 清空选择
      setScanSelectedPostings((prev) =>
        prev.filter((pn) => !postingsToMark.includes(pn))
      );

      // 刷新计数和列表
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });

      // 从当前列表中移除这些posting
      setAllPostings((prev) => prev.filter((p) => !postingsToMark.includes(p.posting_number)));

      // 重新聚焦输入框
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 100);
    } catch (error) {
      notifyError('标记失败', `标记失败: ${error.response?.data?.error?.title || error.message}`);
    }
  };

  // 判断订单是否逾期（超过10天）
  const isOrderOverdue = (inProcessAt: string | undefined): boolean => {
    if (!inProcessAt) return false;
    const orderDate = dayjs(inProcessAt);
    const daysDiff = dayjs().diff(orderDate, 'day');
    return daysDiff > 10;
  };

  // 检查订单是否有多件商品需要确认
  const hasMultipleItems = (posting: ozonApi.Posting | ozonApi.PostingWithOrder): boolean => {
    const items = posting.products || posting.items || [];
    // 多个不同商品
    if (items.length > 1) return true;
    // 单个商品数量>1
    return items.some((item: ozonApi.OrderItem) => item.quantity > 1);
  };

  // 生成打印确认内容（统一确认弹窗）
  const buildPrintConfirmContent = (postings: (ozonApi.Posting | ozonApi.PostingWithOrder)[]): React.ReactNode | null => {
    const warnings: React.ReactNode[] = [];

    postings.forEach((posting) => {
      const postingWarnings: React.ReactNode[] = [];

      // 检查逾期
      if (isOrderOverdue(posting.in_process_at)) {
        postingWarnings.push(
          <span key="overdue" style={{ color: '#ff4d4f' }}>本订单已逾期！</span>
        );
      }

      // 检查多件商品
      if (hasMultipleItems(posting)) {
        postingWarnings.push(
          <span key="multiple">本订单有多件商品，请确认数量！</span>
        );
      }

      // 检查备注
      if (posting.order_notes && posting.order_notes.trim()) {
        postingWarnings.push(
          <span key="notes">{posting.order_notes}</span>
        );
      }

      // 如果有警告，添加到列表
      if (postingWarnings.length > 0) {
        warnings.push(
          <div key={posting.posting_number} style={{ marginBottom: postings.length > 1 ? '12px' : '0' }}>
            {postingWarnings.map((warning, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontWeight: 500, flexShrink: 0 }}>{posting.posting_number}：</span>
                {warning}
              </div>
            ))}
          </div>
        );
      }
    });

    return warnings.length > 0 ? <div>{warnings}</div> : null;
  };

  // 从扫描结果打印单个标签
  const handlePrintSingleLabel = async (postingNumber: string) => {
    // 从扫描结果中查找该 posting
    const posting = scanResults.find((p) => p.posting_number === postingNumber);

    // 执行打印的函数
    const doPrint = async () => {
      const result = await batchPrint([postingNumber]);
      if (result?.success && result.pdf_url) {
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPosting(postingNumber);
        setCurrentPrintingPostings([]);
        setShowPrintLabelModal(true);
        notifySuccess('标签加载成功', '请在弹窗中查看并打印');
      } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPosting(postingNumber);
        setCurrentPrintingPostings([]);
        setShowPrintLabelModal(true);
      }
    };

    // 生成确认内容
    const confirmContent = posting ? buildPrintConfirmContent([posting]) : null;

    if (confirmContent) {
      // 需要确认
      const hasOverdue = posting && isOrderOverdue(posting.in_process_at);
      modal.confirm({
        title: '确认打印',
        content: confirmContent,
        okText: '确认打印',
        cancelText: '取消',
        okButtonProps: hasOverdue ? { danger: true } : undefined,
        onOk: doPrint,
      });
    } else {
      // 不需要确认，直接打印
      await doPrint();
    }
  };

  // 扫描结果批量打印标签
  const handleScanBatchPrint = async () => {
    // 获取要打印的 posting 对象
    const postingsToPrint = scanResults.filter((p) => scanSelectedPostings.includes(p.posting_number));

    // 执行打印
    const doPrint = async () => {
      const result = await batchPrint(scanSelectedPostings);
      if (result?.success && result.pdf_url) {
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPostings([...scanSelectedPostings]);
        setCurrentPrintingPosting('');
        setShowPrintLabelModal(true);
        notifySuccess('标签加载成功', formatLabelStats(result.total, result.cached_count, result.fetched_count));
      } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPostings(result.success_postings || []);
        setCurrentPrintingPosting('');
        setShowPrintLabelModal(true);
      }
    };

    // 生成确认内容
    const confirmContent = buildPrintConfirmContent(postingsToPrint);

    if (confirmContent) {
      // 检查是否有逾期订单
      const hasOverdue = postingsToPrint.some((p) => isOrderOverdue(p.in_process_at));
      modal.confirm({
        title: '确认打印',
        content: confirmContent,
        okText: '确认打印',
        cancelText: '取消',
        okButtonProps: hasOverdue ? { danger: true } : undefined,
        onOk: doPrint,
      });
    } else {
      // 不需要确认，直接打印
      await doPrint();
    }
  };

  // 打开编辑备注弹窗
  const handleOpenEditNotes = (posting: ozonApi.PostingWithOrder) => {
    setEditingPosting(posting);
    setEditNotesModalVisible(true);
  };

  // 保存订单备注
  const handleSaveEditingNotes = async () => {
    if (!editingPosting) return;

    setIsSavingNotes(true);
    try {
      await ozonApi.updatePostingBusinessInfo(editingPosting.posting_number, {
        order_notes: editingPosting.order_notes,
      });
      notifySuccess('保存成功', '订单备注已更新');
      // 更新扫描结果中的数据
      setScanResults((prev) =>
        prev.map((p) =>
          p.posting_number === editingPosting.posting_number
            ? { ...p, order_notes: editingPosting.order_notes }
            : p
        )
      );
      setEditNotesModalVisible(false);
      setEditingPosting(null);
    } catch (error) {
      notifyError('保存失败', `保存失败: ${error.response?.data?.error?.title || error.message}`);
    } finally {
      setIsSavingNotes(false);
    }
  };


  // 错误展示Modal
  return (
    <div className={styles.pageContainer}>
      {/* Sticky头部区域：标题 + 搜索栏 + 标签页 */}
      <div className={styles.stickyHeader}>
        {/* 页面标题 */}
        <PageTitle icon={<TruckOutlined />} title="打包发货" />

        {/* 搜索过滤（扫描单号标签时隐藏） */}
        {operationStatus !== 'scan' && (
          <PackingSearchBar
            form={filterForm}
            selectedShop={selectedShop}
            onShopChange={(shopId) => {
              const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
              setSelectedShop(normalized);
              // 强制刷新数据
              resetAndRefresh();
            }}
            onSearchParamsChange={setSearchParams}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
          />
        )}

        {/* 扫描输入框（扫描单号标签时显示） */}
        {operationStatus === 'scan' && (
          <div className={styles.scanInputContainer}>
            <Space.Compact style={{ width: '100%', maxWidth: '600px' }}>
              <Input
                ref={scanInputRef}
                placeholder="请输入或扫描追踪号码"
                value={scanTrackingNumber}
                onChange={(e) => {
                  setScanTrackingNumber(e.target.value);
                  setIsScanAutoFilled(false);
                }}
                onPressEnter={handleScanSearch}
                onFocus={handleScanInputFocus}
                disabled={isScanning}
                autoFocus
                size="large"
                prefix={<SearchOutlined />}
                suffix={
                  scanTrackingNumber ? (
                    <CloseCircleOutlined
                      onClick={handleClearScanInput}
                      style={{ color: '#999', cursor: 'pointer' }}
                    />
                  ) : null
                }
              />
              <Button
                type="primary"
                size="large"
                loading={isScanning}
                disabled={isScanning}
                onClick={handleScanSearch}
              >
                查询
              </Button>
            </Space.Compact>
          </div>
        )}

        {/* 操作状态 Tabs */}
        {/* 创建带快捷菜单按钮的标签label */}
        {React.useMemo(() => {
            const createTabLabel = (key: string, icon: React.ReactNode, label: string, count: number) => {
              const isAdded = isInQuickMenu(`packing-${key}`);
              const path = `/dashboard/ozon/packing?tab=${key}`;

              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  {icon}
                  {label}{key !== 'scan' && `(${count})`}
                  <Button
                    type="text"
                    size="small"
                    icon={isAdded ? <CheckCircleOutlined /> : <PlusOutlined />}
                    style={{
                      marginLeft: '4px',
                      fontSize: '12px',
                      color: isAdded ? '#52c41a' : '#1890ff',
                      padding: '0 4px',
                      height: '20px',
                      lineHeight: '20px'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isAdded) {
                        addQuickMenu({
                          key: `packing-${key}`,
                          label: label,
                          path: path
                        });
                      }
                    }}
                  />
                </span>
              );
            };

            return (
              <Tabs
                activeKey={operationStatus}
                onChange={(key) => {
              setOperationStatus(key);
              // 记录访问过的标签（用于按需加载统计数据）
              setVisitedTabs((prev) => new Set(prev).add(key));
              // 切换tab时会自动重新加载（queryKey改变）
              // 切换到扫描标签时清空之前的扫描结果
              if (key === 'scan') {
                setScanTrackingNumber('');
                setScanResults([]);
                setScanError('');
                setScanSelectedPostings([]);
              }
            }}
                items={[
                  {
                    key: 'awaiting_stock',
                    label: createTabLabel('awaiting_stock', <ClockCircleOutlined />, '等待备货', statusCounts.awaiting_stock),
                  },
                  {
                    key: 'allocating',
                    label: createTabLabel('allocating', <SyncOutlined spin />, '分配中', statusCounts.allocating),
                  },
                  {
                    key: 'allocated',
                    label: createTabLabel('allocated', <CheckCircleOutlined />, '已分配', statusCounts.allocated),
                  },
                  {
                    key: 'tracking_confirmed',
                    label: createTabLabel('tracking_confirmed', <CheckCircleOutlined />, '单号确认', statusCounts.tracking_confirmed),
                  },
                  {
                    key: 'shipping',
                    label: createTabLabel('shipping', <RocketOutlined />, '运输中', statusCounts.shipping),
                  },
                  {
                    key: 'printed',
                    label: createTabLabel('printed', <PrinterOutlined />, '已打印', statusCounts.printed),
                  },
                  {
                    key: 'scan',
                    label: createTabLabel('scan', <SearchOutlined />, '扫描单号', 0),
                  },
                ]}
                className={styles.stickyTabs}
              />
            );
          }, [operationStatus, statusCounts, addQuickMenu, isInQuickMenu])}

        {/* 扫描结果标题行 - 放在stickyHeader内实现固定 */}
        {operationStatus === 'scan' && scanResults.length > 0 && (
          <div className={styles.scanResultStickyHeader}>
            <span className={styles.scanResultTitle}>
              查询结果 ({scanResults.length}{scanTotal > scanResults.length ? `/${scanTotal}` : ''})
            </span>
            <Space>
              <Space size="small">
                <Text type="secondary">打印状态:</Text>
                <Select
                  value={scanPrintStatusFilter}
                  onChange={handlePrintStatusFilterChange}
                  style={{ width: 120 }}
                  loading={isLoadingScanMore}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '已打印', value: 'printed' },
                    { label: '未打印', value: 'unprinted' },
                  ]}
                />
              </Space>
              {canOperate && (
                <>
                  <Button
                    type={scanSelectedPostings.length === filteredScanResults.length && filteredScanResults.length > 0 ? 'primary' : 'default'}
                    onClick={() => {
                      if (scanSelectedPostings.length === filteredScanResults.length) {
                        setScanSelectedPostings([]);
                      } else {
                        setScanSelectedPostings(filteredScanResults.map(p => p.posting_number));
                      }
                    }}
                    disabled={filteredScanResults.length === 0}
                  >
                    {scanSelectedPostings.length === filteredScanResults.length && filteredScanResults.length > 0 ? '取消全选' : '全选'}
                  </Button>
                  <Button
                    type="primary"
                    icon={<PrinterOutlined />}
                    loading={isPrinting}
                    disabled={scanSelectedPostings.length === 0}
                    onClick={handleScanBatchPrint}
                  >
                    批量打印 ({scanSelectedPostings.length}/{filteredScanResults.length})
                  </Button>
                </>
              )}
            </Space>
          </div>
        )}
      </div>

      {/* 打包发货列表 */}
      <Card className={styles.listCard}>
        {/* 根据不同标签显示不同内容 */}
        {operationStatus === 'scan' ? (
          // 扫描单号界面
          <div style={{ marginTop: 16 }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              {/* 错误提示 */}
              {scanError && (
                <Alert
                  message={scanError}
                  type="warning"
                  showIcon
                  closable
                  onClose={() => setScanError('')}
                />
              )}

              {/* 扫描结果表格 */}
              {scanResults.length > 0 && (
                <>
                  <ScanResultTable
                      scanResults={filteredScanResults}
                      scanSelectedPostings={scanSelectedPostings}
                      onSelectedPostingsChange={setScanSelectedPostings}
                      onPrintSingle={handlePrintSingleLabel}
                      onOpenEditNotes={handleOpenEditNotes}
                      onOpenDomesticTracking={(posting) => {
                        setCurrentPosting(posting);
                        setDomesticTrackingModalVisible(true);
                      }}
                      onShowDetail={showOrderDetail}
                      onOpenPriceHistory={handleOpenPriceHistoryCallback}
                      shopNameMap={shopNameMap}
                      canOperate={canOperate}
                      isPrinting={isPrinting}
                      onCopy={copyToClipboard}
                  />
                  {/* 扫描结果加载更多提示 */}
                  {isLoadingScanMore && (
                    <div className={styles.loadingMore}>
                      <SyncOutlined spin /> 加载更多...
                    </div>
                  )}
                  {!scanHasMore && scanResults.length > 0 && scanTotal > 20 && (
                    <div className={styles.loadingMore}>
                      <Text type="secondary">已加载全部 {scanResults.length} 条结果</Text>
                    </div>
                  )}
                </>
              )}
            </Space>
          </div>
        ) : (
          // 正常的订单列表界面
          <>
            {/* 批量操作按钮 */}
            <div className={styles.batchActions}>
              {/* 批量同步按钮 - 只在"分配中"标签显示 */}
              {canSync && operationStatus === 'allocating' && (
                <Button
                  type="primary"
                  icon={<SyncOutlined spin={isBatchSyncing} />}
                  disabled={allPostings.length === 0}
                  loading={isBatchSyncing}
                  onClick={handleBatchSync}
                >
                  批量同步 ({allPostings.length})
                  {isBatchSyncing && ` - ${syncProgress.success}/${syncProgress.total}`}
                </Button>
              )}

              {/* 采购平台筛选下拉框 - 在"已分配"和"单号确认"标签显示 */}
              {(operationStatus === 'allocated' || operationStatus === 'tracking_confirmed') && (
                <Space>
                  <Text>采购平台</Text>
                  <Select
                    className={styles.platformSelect}
                    value={selectedPlatform}
                    onChange={setSelectedPlatform}
                    suffixIcon={<ShoppingCartOutlined />}
                  >
                    <Option value="all">全部</Option>
                    <Option value="1688">1688</Option>
                    <Option value="拼多多">拼多多</Option>
                    <Option value="咸鱼">咸鱼</Option>
                    <Option value="淘宝">淘宝</Option>
                    <Option value="库存">库存</Option>
                  </Select>
                </Space>
              )}

              {/* 采购信息筛选下拉框 - 只在"待备货"标签显示 */}
              {operationStatus === 'awaiting_stock' && (
                <Space>
                  <Text>采购信息</Text>
                  <Select
                    className={styles.platformSelect}
                    value={selectedPurchaseInfo}
                    onChange={setSelectedPurchaseInfo}
                    suffixIcon={<FileTextOutlined />}
                  >
                    <Option value="all">全部</Option>
                    <Option value="yes">有采购信息</Option>
                    <Option value="no">无采购信息</Option>
                  </Select>
                </Space>
              )}

              {/* 批量打印按钮 - 只在"已打印"标签页显示 */}
              {canOperate &&
                operationStatus === 'printed' && (
                  <Button
                    type="primary"
                    icon={<PrinterOutlined />}
                    disabled={selectedPostingNumbers.length === 0}
                    loading={isPrinting}
                    onClick={handleBatchPrint}
                  >
                    打印标签 ({selectedPostingNumbers.length}/20)
                  </Button>
                )}
            </div>

            {/* 订单卡片网格 */}
            {isLoading && orderCards.length === 0 ? (
              <div className={styles.loadingMore}>
                <SyncOutlined spin /> 加载中...
              </div>
            ) : orderCards.length === 0 ? (
              <div className={styles.emptyState}>
                <Text type="secondary">暂无数据</Text>
              </div>
            ) : (
              <>
                <div className={styles.orderGrid}>
                  {orderCards.map((card) => (
                    <OrderCardComponent
                      key={card.key}
                      card={card}
                      shopNameMap={shopNameMap}
                      offerIdImageMap={offerIdImageMap}
                      selectedPostingNumbers={selectedPostingNumbers}
                      userCurrency={userCurrency}
                      statusConfig={statusConfig}
                      operationStatusConfig={operationStatusConfig}
                      operationStatus={operationStatus}
                      formatPrice={formatPrice}
                      formatDeliveryMethodText={formatDeliveryMethodText}
                      formatDateTime={formatDateTime}
                      onCopy={copyToClipboard}
                      onShowDetail={handleShowDetailCallback}
                      onOpenImagePreview={handleOpenImagePreviewCallback}
                      onOpenPriceHistory={handleOpenPriceHistoryCallback}
                      onPrepareStock={handlePrepareStockCallback}
                      onUpdateBusinessInfo={handleUpdateBusinessInfoCallback}
                      onSubmitTracking={handleSubmitTrackingCallback}
                      onDiscardOrder={handleDiscardOrderCallback}
                      onCheckboxChange={handleCheckboxChangeCallback}
                      canOperate={canOperate}
                    />
                  ))}
                </div>

                {/* 加载提示 */}
                {isLoadingMore && (
                  <div className={styles.loadingMore}>
                    <SyncOutlined spin /> 加载更多...
                  </div>
                )}

                {!hasMoreData && orderCards.length > 0 && (
                  <div className={styles.loadingMore}>
                    <Text type="secondary">没有更多数据了</Text>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Card>

      {/* 订单详情弹窗 */}
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
          // 重置分页并刷新数据
          resetAndRefresh();
        }}
      />

      {/* 发货弹窗 */}
      <ShipOrderModal
        visible={shipModalVisible}
        form={shipForm}
        order={selectedOrder}
        posting={selectedPosting}
        onClose={() => {
          setShipModalVisible(false);
          shipForm.resetFields();
        }}
        onSubmit={(values) => {
          if (!selectedPosting) return;
          shipOrderMutation.mutate({
            posting_number: selectedPosting.posting_number,
            tracking_number: values.tracking_number,
            carrier_code: values.carrier_code,
          });
        }}
        loading={shipOrderMutation.isPending}
      />

      {/* 备货弹窗 */}
      {currentPosting && (
        <PrepareStockModal
          visible={prepareStockModalVisible}
          onCancel={() => setPrepareStockModalVisible(false)}
          postingNumber={currentPosting.posting_number}
          posting={currentPosting}
          onSuccess={() => {
            // 操作成功后，从当前列表中移除该posting
            setAllPostings((prev) =>
              prev.filter((p) => p.posting_number !== currentPosting.posting_number)
            );
            // 刷新查询缓存，确保重置后不会重新出现
            queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
            queryClient.invalidateQueries({ queryKey: ['packingStats'] });
            setPrepareStockModalVisible(false);
          }}
        />
      )}

      {/* 更新业务信息弹窗 */}
      {currentPosting && (
        <UpdateBusinessInfoModal
          visible={updateBusinessInfoModalVisible}
          onCancel={() => setUpdateBusinessInfoModalVisible(false)}
          postingNumber={currentPosting.posting_number}
          currentData={{
            purchase_price: currentPosting.order?.purchase_price,
            source_platform: currentPosting.source_platform,
            order_notes: currentPosting.order?.order_notes,
          }}
          onUpdate={resetAndRefresh}
        />
      )}

      {/* 国内物流单号弹窗 */}
      {currentPosting && (
        <DomesticTrackingModal
          visible={domesticTrackingModalVisible}
          onCancel={() => setDomesticTrackingModalVisible(false)}
          postingNumber={currentPosting.posting_number}
          initialTrackingNumbers={currentPosting.domestic_tracking_numbers}
          initialOrderNotes={currentPosting.order?.order_notes}
          onSuccess={async () => {
            // 判断是否在扫描结果页面
            if (operationStatus === 'scan' && scanResults.length > 0) {
              // 扫描结果页面：重新查询该订单数据
              try {
                const result = await ozonApi.searchPostingByTracking(currentPosting.posting_number);
                if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                  const updatedPosting = result.data[0];
                  // 更新扫描结果
                  setScanResults((prev) =>
                    prev.map((p) =>
                      p.posting_number === currentPosting.posting_number ? updatedPosting : p
                    )
                  );
                  // 同步更新 currentPosting，确保再次打开弹窗时显示最新数据
                  setCurrentPosting(updatedPosting);
                } else {
                  // 如果查询不到了（可能被清空单号变为已分配），从列表移除
                  setScanResults((prev) =>
                    prev.filter((p) => p.posting_number !== currentPosting.posting_number)
                  );
                }
              } catch {
                // 查询失败，从列表移除
                setScanResults((prev) =>
                  prev.filter((p) => p.posting_number !== currentPosting.posting_number)
                );
              }
            } else {
              // 其他页面：从当前列表中移除该posting
              setAllPostings((prev) =>
                prev.filter((p) => p.posting_number !== currentPosting.posting_number)
              );
            }
            // 刷新查询缓存，确保重置后不会重新出现
            queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
            queryClient.invalidateQueries({ queryKey: ['packingStats'] });
            setDomesticTrackingModalVisible(false);
            // 重新聚焦输入框
            setTimeout(() => {
              scanInputRef.current?.focus();
            }, 100);
          }}
        />
      )}

      {/* 废弃订单弹窗 */}
      {currentPosting && (
        <DiscardOrderModal
          visible={discardOrderModalVisible}
          onCancel={() => setDiscardOrderModalVisible(false)}
          postingNumber={currentPosting.posting_number}
          onSuccess={() => {
            // 操作成功后，从当前列表中移除该posting
            setAllPostings((prev) =>
              prev.filter((p) => p.posting_number !== currentPosting.posting_number)
            );
            // 刷新查询缓存，确保重置后不会重新出现
            queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
            queryClient.invalidateQueries({ queryKey: ['packingStats'] });
            setDiscardOrderModalVisible(false);
          }}
        />
      )}

      {/* 进货价格历史弹窗 */}
      <PurchasePriceHistoryModal
        visible={priceHistoryModalVisible}
        onCancel={() => setPriceHistoryModalVisible(false)}
        sku={selectedSku}
        productName={selectedProductName}
      />

      {/* 编辑备注弹窗 */}
      <EditNotesModal
        visible={editNotesModalVisible}
        posting={editingPosting}
        onClose={() => {
          setEditNotesModalVisible(false);
          setEditingPosting(null);
        }}
        onSave={handleSaveEditingNotes}
        loading={isSavingNotes}
        onNotesChange={(notes) => {
          setEditingPosting({
            ...editingPosting,
            order_notes: notes,
          });
        }}
      />

      {/* 批量打印错误展示Modal */}
      <PrintErrorModal
        visible={printErrorModalVisible}
        onClose={closePrintErrorModal}
        printSuccessPostings={printSuccessPostings}
        printErrors={printErrors}
        selectedPostingNumbers={selectedPostingNumbers}
        onRemoveFailedPostings={(failedNumbers) => {
          setSelectedPostingNumbers(
            selectedPostingNumbers.filter((pn) => !failedNumbers.includes(pn))
          );
          closePrintErrorModal();
          notifyInfo('订单已移除', '已移除失败的订单，可重新选择并打印');
        }}
      />

      {/* 图片预览Modal */}
      <ImagePreview
        images={previewImageUrl ? [previewImageUrl] : []}
        visible={imagePreviewVisible}
        initialIndex={0}
        onClose={handleCloseImagePreview}
      />

      {/* 打印标签弹窗 */}
      <PrintLabelModal
        visible={showPrintLabelModal}
        pdfUrl={printLabelUrl}
        onClose={() => {
          setShowPrintLabelModal(false);
          setPrintLabelUrl('');
          setCurrentPrintingPosting('');
          setCurrentPrintingPostings([]);
          // 重新聚焦输入框
          setTimeout(() => {
            scanInputRef.current?.focus();
          }, 100);
        }}
        onAfterClose={() => {
          // 确保弹窗完全关闭后再聚焦
          setTimeout(() => {
            scanInputRef.current?.focus();
          }, 100);
        }}
        onMarkPrinted={handleMarkPrintedFromModal}
      />
    </div>
  );
};

export default PackingShipment;
