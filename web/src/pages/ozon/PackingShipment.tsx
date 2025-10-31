/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
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
  CopyOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
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
  Tag,
  Tooltip,
  Descriptions,
  Tabs,
  Form,
  Alert,
  Typography,
  Progress,
  Avatar,
  Table,
} from 'antd';
import moment from 'moment';
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useCurrency } from '../../hooks/useCurrency';
import { getCurrencySymbol } from '../../utils/currency';
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
import PackingSearchBar from '@/components/ozon/packing/PackingSearchBar';
import PrepareStockModal from '@/components/ozon/PrepareStockModal';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import UpdateBusinessInfoModal from '@/components/ozon/UpdateBusinessInfoModal';
import PrintErrorModal, { type FailedPosting } from '@/components/ozon/packing/PrintErrorModal';
import EditNotesModal from '@/components/ozon/packing/EditNotesModal';
import ImagePreview from '@/components/ImagePreview';
import PrintLabelModal from '@/components/ozon/packing/PrintLabelModal';
import ShipOrderModal from '@/components/ozon/packing/ShipOrderModal';
import ScanResultTable from '@/components/ozon/packing/ScanResultTable';
import PageTitle from '@/components/PageTitle';
import { OZON_ORDER_STATUS_MAP } from '@/constants/ozonStatus';
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import { useCopy } from '@/hooks/useCopy';
import { usePermission } from '@/hooks/usePermission';
import { useQuickMenu } from '@/hooks/useQuickMenu';
import { useBatchPrint } from '@/hooks/useBatchPrint';
import { useBatchSync } from '@/hooks/useBatchSync';
import { readAndValidateClipboard, markClipboardRejected } from '@/hooks/useClipboard';
import * as ozonApi from '@/services/ozonApi';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

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

const PackingShipment: React.FC = () => {
  const queryClient = useQueryClient();
  const { currency: userCurrency } = useCurrency();
  const { copyToClipboard } = useCopy();
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
    onComplete: (successCount, failedCount) => {
      // 刷新数据
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
      resetAndRefresh();
    },
  });

  // 订单同步轮询 Hook（与 OrderList.tsx 相同）
  const { startPolling: startOrderSyncPolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const result = await ozonApi.getSyncStatus(taskId);
      const status = result.data || result;

      if (status.status === 'completed') {
        return { state: 'SUCCESS', result: status };
      } else if (status.status === 'failed') {
        return { state: 'FAILURE', error: status.error || '未知错误' };
      } else {
        return { state: 'PROGRESS', info: status };
      }
    },
    pollingInterval: 2000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'packing-order-sync',
    initialMessage: '订单同步进行中',
    formatProgressContent: (info) => {
      const percent = Math.round(info.progress || 0);
      let displayMessage = info.message || '同步中...';

      // 匹配 "正在同步 awaiting_deliver 订单 56210030-0227-1..." 格式
      const matchWithStatus = displayMessage.match(/正在同步\s+(\w+)\s+订单\s+([0-9-]+)/);
      if (matchWithStatus) {
        const status = matchWithStatus[1];
        const postingNumber = matchWithStatus[2];
        const statusText = OZON_ORDER_STATUS_MAP[status] || status;
        displayMessage = `正在同步【${statusText}】订单：${postingNumber}`;
      } else {
        // 简单匹配订单号
        const match = displayMessage.match(/订单\s+([0-9-]+)/);
        if (match) {
          displayMessage = `同步订单：${match[1]}`;
        }
      }

      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>{displayMessage}</div>
        </div>
      );
    },
    formatSuccessMessage: () => ({
      title: '同步完成',
      description: '订单同步已完成！',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
      resetAndRefresh();
    },
  });

  // 状态管理 - 分页和滚动加载
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = React.useRef(1); // 使用 ref 跟踪当前页，避免 useEffect 依赖
  const [pageSize, setPageSize] = useState(24); // 会根据容器宽度动态调整
  const [itemsPerRow, setItemsPerRow] = useState(6); // 每行显示数量
  const [initialPageSize, setInitialPageSize] = useState(24); // 初始pageSize
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
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);

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
  const [searchParams, setSearchParams] = useState<any>({});

  // 批量打印标签状态
  const [selectedPostingNumbers, setSelectedPostingNumbers] = useState<string[]>([]);

  // 扫描单号状态
  const [scanTrackingNumber, setScanTrackingNumber] = useState<string>('');
  const [scanResults, setScanResults] = useState<any[]>([]); // 改为数组，支持多个结果
  const [scanError, setScanError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  // 扫描结果的批量打印状态
  const [scanSelectedPostings, setScanSelectedPostings] = useState<string[]>([]);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  // 扫描输入框自动填充状态
  const [isScanAutoFilled, setIsScanAutoFilled] = useState(false);
  // 记录上次自动填充的内容（避免重复填充）
  const [lastAutoFilledContent, setLastAutoFilledContent] = useState<string>('');
  // 编辑备注弹窗状态
  const [editNotesModalVisible, setEditNotesModalVisible] = useState(false);
  const [editingPosting, setEditingPosting] = useState<any>(null);

  // 采购平台筛选状态（单选）
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  // 打印标签弹窗状态（保留用于其他tab）
  const [showPrintLabelModal, setShowPrintLabelModal] = useState(false);
  const [printLabelUrl, setPrintLabelUrl] = useState<string>('');
  const [currentPrintingPosting, setCurrentPrintingPosting] = useState<string>('');
  const [currentPrintingPostings, setCurrentPrintingPostings] = useState<string[]>([]); // 批量打印的postings

  // 扫描输入框的 ref，用于重新聚焦
  const scanInputRef = React.useRef<any>(null);

  // 图片预览状态
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');

  // 计算每行显示数量（根据屏幕宽度预估）
  const calculateItemsPerRow = React.useCallback(() => {
    const screenWidth = window.innerWidth;
    const menuWidth = 250; // 左边菜单宽度（估计值）
    const columns = Math.max(1, Math.floor((screenWidth - menuWidth - 10) / 170));
    setItemsPerRow(columns);

    // 动态设置初始pageSize：列数 × 3行，但不超过后端限制100
    const calculatedPageSize = Math.min(columns * 3, 100);
    setInitialPageSize(calculatedPageSize);
    setPageSize(calculatedPageSize);
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

  // 查询店铺列表（用于显示店铺名称）
  const { data: shopsData } = useQuery({
    queryKey: ['ozonShops'],
    queryFn: ozonApi.getShops,
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
    queryKey: ['packingOrders', selectedShop, operationStatus, searchParams, currentPage, pageSize, selectedPlatform],
    queryFn: () => {
      // 第一个标签使用OZON原生状态，其他标签使用operation_status
      const queryParams = {
        shop_id: selectedShop,
        ...searchParams, // 展开所有搜索参数（posting_number/sku/tracking_number/domestic_tracking_number）
      };

      if (operationStatus === 'awaiting_stock') {
        queryParams.ozon_status = 'awaiting_packaging,awaiting_deliver';
      } else {
        queryParams.operation_status = operationStatus;
      }

      // 已分配页面的采购平台筛选
      if (operationStatus === 'allocated' && selectedPlatform !== 'all') {
        queryParams.source_platform = selectedPlatform;
      }

      return ozonApi.getPackingOrders(currentPage, pageSize, queryParams);
    },
    enabled: true, // 支持查询全部店铺（selectedShop=null）
    // 禁用自动刷新，避免与无限滚动冲突
    // refetchInterval: 60000,
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
    staleTime: 30000, // 数据30秒内不会被认为是过期的
  });

  // 当店铺、状态、搜索参数或平台筛选变化时，重置分页
  useEffect(() => {
    setCurrentPage(1);
    currentPageRef.current = 1; // 同步更新 ref
    setAllPostings([]);
    setHasMoreData(true);
    setAccumulatedImageMap({}); // 重置图片映射
    setPageSize(initialPageSize); // 重置为初始pageSize
  }, [selectedShop, operationStatus, searchParams, initialPageSize, selectedPlatform]);

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
      // 判断是否还有更多数据：
      // 1. 累积的数据量小于总数 AND
      // 2. 本次返回的数据量等于请求的limit（如果小于limit说明已经是最后一页）
      const hasMore =
        newPostingsLength < (ordersData.total || 0) && ordersData.data.length >= pageSize;
      setHasMoreData(hasMore);
      setIsLoadingMore(false);
    }
  }, [ordersData, pageSize]); // 依赖 ordersData 对象和 pageSize

  // 滚动监听：滚动到底部加载下一页
  useEffect(() => {
    const handleScroll = () => {
      if (isLoadingMore || !hasMoreData) return;

      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollPercent = (scrollTop + windowHeight) / documentHeight;

      // 滚动到80%时触发加载
      if (scrollPercent > 0.8) {
        setIsLoadingMore(true);
        // 加载更多时使用较小的pageSize（初始值的一半，但至少一行）
        const loadMoreSize = Math.min(Math.max(Math.floor(initialPageSize / 2), itemsPerRow), 100);
        setPageSize(loadMoreSize);
        setCurrentPage((prev) => {
          const next = prev + 1;
          currentPageRef.current = next; // 同步更新 ref
          return next;
        });
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isLoadingMore, hasMoreData, initialPageSize, itemsPerRow]);

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
    setPageSize(initialPageSize);
    // 延迟执行 refetch，确保状态已更新
    setTimeout(() => refetch(), 0);
  }, [initialPageSize, refetch]);

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
    printed: statsData?.data?.printed || 0,
  };

  // 将 PostingWithOrder 数组转换为 OrderCard 数组（每个商品一张卡片）
  const orderCards = React.useMemo<OrderCard[]>(() => {
    const cards: OrderCard[] = [];

    postingsData.forEach((posting) => {
      // 优先使用 posting.products（从 raw_payload 提取的该 posting 的商品）
      // 如果不存在，降级使用 posting.order.items（订单级别的商品汇总）
      const products =
        posting.products && posting.products.length > 0
          ? posting.products
          : posting.order.items || [];

      if (products.length === 0) {
        // 如果没有商品，创建一张空卡片
        cards.push({
          key: `${posting.posting_number}_0`,
          posting: posting,
          product: null,
          order: posting.order,
        });
      } else {
        // 为每个商品创建一张卡片
        products.forEach((product, index) => {
          cards.push({
            key: `${posting.posting_number}_${index}`,
            posting: posting,
            product: product,
            order: posting.order,
          });
        });
      }
    });

    return cards;
  }, [postingsData]);

  // offer_id到图片的映射，使用累积的映射
  const offerIdImageMap = accumulatedImageMap;

  // 使用统一的价格格式化函数
  const formatPrice = (price: string | number): string => {
    return formatPackingPrice(price, userCurrency);
  };

  // 同步订单
  const syncOrdersMutation = useMutation({
    mutationFn: (fullSync: boolean) => {
      if (!selectedShop) {
        throw new Error('请先选择店铺');
      }
      return ozonApi.syncOrdersDirect(selectedShop, fullSync ? 'full' : 'incremental');
    },
    onSuccess: (data) => {
      const taskId = data?.task_id || data?.data?.task_id;
      if (taskId) {
        startOrderSyncPolling(taskId);
      } else {
        notifyError('同步失败', '未获取到任务ID，请稍后重试');
      }
    },
    onError: (error: Error) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 发货
  const shipOrderMutation = useMutation({
    mutationFn: ozonApi.shipOrder,
    onSuccess: () => {
      notifySuccess('发货成功', '订单已成功发货');
      setShipModalVisible(false);
      shipForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
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
  const showOrderDetail = (order: ozonApi.Order, posting?: ozonApi.Posting) => {
    setSelectedOrder(order);
    setSelectedPosting(posting || null);
    setDetailModalVisible(true);
  };

  const handleBatchPrint = async () => {
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

    setIsScanning(true);
    setScanResults([]);
    setScanError('');
    setScanSelectedPostings([]);

    try {
      const result = await ozonApi.searchPostingByTracking(scanTrackingNumber.trim());
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        // API返回数组格式，直接显示表格
        setScanResults(result.data);
        setScanError('');
      } else if (result.data && !Array.isArray(result.data)) {
        // 兼容旧版API（返回单个对象），转为数组
        setScanResults([result.data]);
        setScanError('');
      } else {
        setScanResults([]);
        setScanError('未找到对应的订单');
      }
    } catch (error) {
      setScanResults([]);
      setScanError(`查询失败: ${error.response?.data?.error?.title || error.message}`);
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

  // 标记为已打印
  const handleMarkPrinted = async (postingNumber: string) => {
    try {
      await ozonApi.markPostingPrinted(postingNumber);
      notifySuccess('标记成功', '已标记为已打印');
      // 刷新扫描结果
      if (scanTrackingNumber.trim()) {
        handleScanSearch();
      }
      // 刷新计数
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 从当前列表中移除该posting
      setAllPostings((prev) => prev.filter((p) => p.posting_number !== postingNumber));
    } catch (error) {
      notifyError('标记失败', `标记失败: ${error.response?.data?.error?.title || error.message}`);
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
      setScanResults((prev) =>
        prev.map((p) =>
          postingsToMark.includes(p.posting_number) ? { ...p, operation_status: 'printed' } : p
        )
      );

      // 清空选择
      if (isBatch) {
        setScanSelectedPostings([]);
      }

      // 刷新计数
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });

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

  // 从扫描结果打印单个标签
  const handlePrintSingleLabel = async (postingNumber: string) => {
    const result = await batchPrint([postingNumber]);
    if (result?.success && result.pdf_url) {
      // 弹出窗口显示PDF，而不是直接打开
      setPrintLabelUrl(result.pdf_url);
      setCurrentPrintingPosting(postingNumber);
      setCurrentPrintingPostings([]); // 单张打印，清空批量标记
      setShowPrintLabelModal(true);
      notifySuccess('标签加载成功', '请在弹窗中查看并打印');
    } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
      setPrintLabelUrl(result.pdf_url);
      setCurrentPrintingPosting(postingNumber);
      setCurrentPrintingPostings([]);
      setShowPrintLabelModal(true);
    }
  };

  // 扫描结果批量打印标签
  const handleScanBatchPrint = async () => {
    const result = await batchPrint(scanSelectedPostings);
    if (result?.success && result.pdf_url) {
      // 弹出窗口显示PDF（与单张打印一致）
      setPrintLabelUrl(result.pdf_url);
      setCurrentPrintingPostings([...scanSelectedPostings]); // 保存批量打印的postings
      setCurrentPrintingPosting(''); // 清空单个posting标记
      setShowPrintLabelModal(true);
      notifySuccess(
        '标签加载成功',
        `成功加载${result.total}个标签（缓存:${result.cached_count}, 新获取:${result.fetched_count}），请在弹窗中查看并打印`
      );
    } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
      // 部分成功 - hook已经显示了错误modal，这里只需要打开PDF
      setPrintLabelUrl(result.pdf_url);
      setCurrentPrintingPostings(result.success_postings || []);
      setCurrentPrintingPosting('');
      setShowPrintLabelModal(true);
    }
  };

  // 打开编辑备注弹窗
  const handleOpenEditNotes = (posting: any) => {
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
            // 切换店铺时会自动重新加载（queryKey改变）
          }}
          onSearchParamsChange={setSearchParams}
        />
      )}

      {/* 打包发货列表 */}
      <Card className={styles.listCard}>
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
                  key: 'printed',
                  label: createTabLabel('printed', <PrinterOutlined />, '已打印', statusCounts.printed),
                },
                {
                  key: 'scan',
                  label: createTabLabel('scan', <SearchOutlined />, '扫描单号', 0),
                },
              ]}
              style={{ marginTop: 16 }}
            />
          );
        }, [operationStatus, statusCounts, addQuickMenu, isInQuickMenu])}


        {/* 根据不同标签显示不同内容 */}
        {operationStatus === 'scan' ? (
          // 扫描单号界面
          <div style={{ marginTop: 16 }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              {/* 扫描输入框 */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Space.Compact style={{ width: '600px' }}>
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
              </Card>

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

              {/* 扫描结果 */}
              {scanResults.length > 0 && (
                <Card
                  title={`查询结果 (${scanResults.length})`}
                  extra={
                    canOperate && (
                      <Button
                        type="primary"
                        icon={<PrinterOutlined />}
                        loading={isPrinting}
                        disabled={scanSelectedPostings.length === 0}
                        onClick={handleScanBatchPrint}
                      >
                        批量打印 ({scanSelectedPostings.length}/{scanResults.length})
                      </Button>
                    )
                  }
                >
                  <ScanResultTable
                    scanResults={scanResults}
                    scanSelectedPostings={scanSelectedPostings}
                    onSelectedPostingsChange={setScanSelectedPostings}
                    onPrintSingle={handlePrintSingleLabel}
                    onOpenEditNotes={handleOpenEditNotes}
                    onOpenDomesticTracking={(posting) => {
                      setCurrentPosting(posting);
                      setDomesticTrackingModalVisible(true);
                    }}
                    shopNameMap={shopNameMap}
                    canOperate={canOperate}
                    isPrinting={isPrinting}
                    onCopy={copyToClipboard}
                  />
                </Card>
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

              {/* 采购平台筛选下拉框 - 只在"已分配"标签显示 */}
              {operationStatus === 'allocated' && (
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

              {/* 批量打印按钮 - 在其他标签页显示（除了已分配和前两个状态） */}
              {canOperate &&
                operationStatus !== 'awaiting_stock' &&
                operationStatus !== 'allocating' &&
                operationStatus !== 'allocated' && (
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
                  {orderCards
                    .filter((card) => {
                      // 如果在"已分配"标签页且设置了平台筛选，则应用筛选
                      if (operationStatus === 'allocated' && selectedPlatform !== 'all') {
                        const sourcePlatform = card.posting.source_platform;
                        if (!sourcePlatform) return false;

                        // 检查是否包含所选平台
                        return sourcePlatform.includes(selectedPlatform);
                      }
                      return true;
                    })
                    .map((card) => (
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
                  // 更新扫描结果
                  setScanResults((prev) =>
                    prev.map((p) =>
                      p.posting_number === currentPosting.posting_number ? result.data[0] : p
                    )
                  );
                } else {
                  // 如果查询不到了（可能被清空单号变为已分配），从列表移除
                  setScanResults((prev) =>
                    prev.filter((p) => p.posting_number !== currentPosting.posting_number)
                  );
                }
              } catch (error) {
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
