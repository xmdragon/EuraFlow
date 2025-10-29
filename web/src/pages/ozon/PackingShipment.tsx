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
  CloseCircleOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  CopyOutlined,
  CloseOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Space,
  Card,
  Input,
  Select,
  Tag,
  Modal,
  Tooltip,
  Descriptions,
  Tabs,
  Form,
  Alert,
  Typography,
  Progress,
  Avatar,
  Table,
  Spin,
  notification,
} from 'antd';
import moment from 'moment';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useCurrency } from '../../hooks/useCurrency';
import { formatPriceWithFallback, getCurrencySymbol } from '../../utils/currency';

import styles from './PackingShipment.module.scss';

import DiscardOrderModal from '@/components/ozon/DiscardOrderModal';
import DomesticTrackingModal from '@/components/ozon/DomesticTrackingModal';
import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import OrderCardComponent, { type OrderCard } from '@/components/ozon/packing/OrderCardComponent';
import PackingSearchBar from '@/components/ozon/packing/PackingSearchBar';
import PrepareStockModal from '@/components/ozon/PrepareStockModal';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import UpdateBusinessInfoModal from '@/components/ozon/UpdateBusinessInfoModal';
import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import { useQuickMenu } from '@/hooks/useQuickMenu';
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

// 扫描结果商品行数据结构（用于表格展示，与订单管理格式一致）
interface ScanResultItemRow {
  key: string;
  item: any;
  itemIndex: number;
  posting: any;
  isFirstItem: boolean;
  itemCount: number;
}
const PackingShipment: React.FC = () => {
  const queryClient = useQueryClient();
  const { currency: userCurrency } = useCurrency();
  const { canOperate, canSync } = usePermission();
  const [urlSearchParams] = useSearchParams();
  const { addQuickMenu, isInQuickMenu } = useQuickMenu();

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
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);

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
  const [isPrinting, setIsPrinting] = useState(false);
  const [printErrorModalVisible, setPrintErrorModalVisible] = useState(false);
  const [printErrors, setPrintErrors] = useState<ozonApi.FailedPosting[]>([]);
  const [printSuccessPostings, setPrintSuccessPostings] = useState<string[]>([]);

  // 批量同步状态
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({
    success: 0,
    failed: 0,
    total: 0,
  });

  // 扫描单号状态
  const [scanTrackingNumber, setScanTrackingNumber] = useState<string>('');
  const [scanResults, setScanResults] = useState<any[]>([]); // 改为数组，支持多个结果
  const [scanError, setScanError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  // 扫描结果的批量打印状态
  const [scanSelectedPostings, setScanSelectedPostings] = useState<string[]>([]);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  // 编辑备注弹窗状态
  const [editNotesModalVisible, setEditNotesModalVisible] = useState(false);
  const [editingPosting, setEditingPosting] = useState<any>(null);

  // 将扫描结果转换为商品维度的行数据（与订单管理格式一致）
  const scanItemRows = React.useMemo<ScanResultItemRow[]>(() => {
    const rows: ScanResultItemRow[] = [];

    scanResults.forEach((posting) => {
      const items = posting.items || [];
      const itemCount = items.length;

      if (itemCount === 0) {
        // 如果没有商品，创建一行空数据
        rows.push({
          key: `${posting.posting_number}_0`,
          item: {} as any,
          itemIndex: 0,
          posting: posting,
          isFirstItem: true,
          itemCount: 1,
        });
      } else {
        // 为每个商品创建一行
        items.forEach((item: any, index: number) => {
          rows.push({
            key: `${posting.posting_number}_${index}`,
            item: item,
            itemIndex: index,
            posting: posting,
            isFirstItem: index === 0,
            itemCount: itemCount,
          });
        });
      }
    });

    return rows;
  }, [scanResults]);

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
  const [imageLoading, setImageLoading] = useState(false);
  const imageRef = React.useRef<HTMLImageElement>(null);

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

  // 复制功能处理函数
  const handleCopy = (text: string | undefined, label: string) => {
    if (!text || text === '-') {
      notifyWarning('复制失败', `${label}为空，无法复制`);
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        notifySuccess('复制成功', `${label}已复制`);
      })
      .catch(() => {
        notifyError('复制失败', '复制失败，请手动复制');
      });
  };

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

  // 状态配置 - 与OZON官网对齐的7个主状态 + 兼容旧状态
  const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
    // 【1】等待备货 - 订单刚创建，需要准备商品
    awaiting_packaging: {
      color: 'processing',
      text: '等待备货',
      icon: <ClockCircleOutlined />,
    },
    awaiting_registration: {
      color: 'processing',
      text: '等待备货', // 映射：等待注册 → 等待备货
      icon: <ClockCircleOutlined />,
    },
    acceptance_in_progress: {
      color: 'processing',
      text: '等待备货', // 映射：正在验收 → 等待备货
      icon: <SyncOutlined spin />,
    },
    awaiting_approve: {
      color: 'processing',
      text: '等待备货', // 映射：等待确认 → 等待备货
      icon: <ClockCircleOutlined />,
    },

    // 【2】等待发运 - 商品已备好，等待交给快递
    awaiting_deliver: {
      color: 'warning',
      text: '等待发运',
      icon: <TruckOutlined />,
    },

    // 【3】已准备发运 - FBS模式：卖家已发货但快递未取件
    sent_by_seller: {
      color: 'cyan',
      text: '已准备发运',
      icon: <TruckOutlined />,
    },

    // 【4】运输中 - 快递配送中
    delivering: {
      color: 'cyan',
      text: '运输中',
      icon: <TruckOutlined />,
    },
    driver_pickup: {
      color: 'cyan',
      text: '运输中', // 映射：司机处 → 运输中
      icon: <TruckOutlined />,
    },

    // 【5】有争议的 - 仲裁/纠纷
    arbitration: {
      color: 'warning',
      text: '有争议的',
      icon: <ClockCircleOutlined />,
    },
    client_arbitration: {
      color: 'warning',
      text: '有争议的', // 映射：快递客户仲裁 → 有争议的
      icon: <ClockCircleOutlined />,
    },

    // 【6】已签收 - 订单完成
    delivered: {
      color: 'success',
      text: '已签收',
      icon: <CheckCircleOutlined />,
    },

    // 【7】已取消 - 订单取消
    cancelled: {
      color: 'error',
      text: '已取消',
      icon: <CloseCircleOutlined />,
    },
    not_accepted: {
      color: 'error',
      text: '已取消', // 映射：分拣中心未接受 → 已取消
      icon: <CloseCircleOutlined />,
    },

    // -------- 以下为兼容旧数据的状态 --------
    pending: {
      color: 'processing',
      text: '等待备货', // 映射：待确认 → 等待备货
      icon: <ClockCircleOutlined />,
    },
    confirmed: {
      color: 'processing',
      text: '等待备货', // 映射：已确认 → 等待备货
      icon: <CheckCircleOutlined />,
    },
    processing: {
      color: 'processing',
      text: '等待备货', // 映射：处理中 → 等待备货
      icon: <SyncOutlined spin />,
    },
    shipped: {
      color: 'cyan',
      text: '运输中', // 映射：已发货 → 运输中
      icon: <TruckOutlined />,
    },
    awaiting_debit: {
      color: 'processing',
      text: '等待备货', // 映射：等待扣款 → 等待备货
      icon: <ClockCircleOutlined />,
    },
  };

  // 操作状态配置 - 用于打包发货流程的内部状态
  const operationStatusConfig: Record<string, { color: string; text: string }> = {
    awaiting_stock: { color: 'default', text: '等待备货' },
    allocating: { color: 'processing', text: '分配中' },
    allocated: { color: 'warning', text: '已分配' },
    tracking_confirmed: { color: 'success', text: '单号确认' },
    printed: { color: 'success', text: '已打印' },
    shipping: { color: 'processing', text: '发货中' },
  };

  // 查询打包发货订单列表
  // 第一个标签"等待备货"使用OZON原生状态，其他标签使用operation_status
  const {
    data: ordersData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['packingOrders', selectedShop, operationStatus, searchParams, currentPage, pageSize],
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

      return ozonApi.getPackingOrders(currentPage, pageSize, queryParams);
    },
    enabled: true, // 支持查询全部店铺（selectedShop=null）
    // 禁用自动刷新，避免与无限滚动冲突
    // refetchInterval: 60000,
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
    staleTime: 30000, // 数据30秒内不会被认为是过期的
  });

  // 当店铺、状态或搜索参数变化时，重置分页
  useEffect(() => {
    setCurrentPage(1);
    currentPageRef.current = 1; // 同步更新 ref
    setAllPostings([]);
    setHasMoreData(true);
    setAccumulatedImageMap({}); // 重置图片映射
    setPageSize(initialPageSize); // 重置为初始pageSize
  }, [selectedShop, operationStatus, searchParams, initialPageSize]);

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
    shipping: statsData?.data?.shipping || 0,
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

  // 使用统一的货币格式化函数（移除货币符号）
  const formatPrice = (price: string | number): string => {
    // 移除所有可能的货币符号
    return formatPriceWithFallback(price, null, userCurrency)
      .replace(/^[¥₽$€£]/g, '')
      .trim();
  };

  // offer_id到图片的映射，使用累积的映射
  const offerIdImageMap = accumulatedImageMap;

  // 格式化配送方式文本（用于详情显示）
  const formatDeliveryMethodText = (text: string | undefined): React.ReactNode => {
    if (!text) return '-';

    // 如果包含括号，提取括号内的内容
    const match = text.match(/^(.+?)[\\(（](.+?)[\\)）]$/);
    if (!match) return text;

    const mainPart = match[1].trim();
    const detailPart = match[2].trim();

    // 解析限制信息为三行：重量、价格、体积
    const parseRestrictions = (restriction: string): string[] => {
      // 移除"限制:"前缀
      const content = restriction.replace(/^限制[:：]\s*/, '');

      // 使用正则提取三个部分
      const weightMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[克公斤kgг]+)/);
      const priceMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[₽рублей]+)/);
      const sizeMatch = content.match(/([\d\s×xXх]+\s*[厘米смcm]+)/);

      const lines: string[] = [];
      if (restriction.includes('限制')) lines.push('限制:');
      if (weightMatch) lines.push(weightMatch[1].trim());
      if (priceMatch) lines.push(priceMatch[1].trim());
      if (sizeMatch) lines.push(sizeMatch[1].trim());

      return lines.length > 0 ? lines : [restriction];
    };

    const restrictionLines = parseRestrictions(detailPart);

    // 格式化显示
    return (
      <div className={styles.deliveryMethodText}>
        <div className={styles.deliveryMethodMain}>{mainPart}</div>
        <div className={styles.deliveryMethodDetail} style={{ color: '#fff' }}>
          {restrictionLines.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
      </div>
    );
  };

  // 格式化配送方式文本（用于白色背景显示）
  const formatDeliveryMethodTextWhite = (text: string | undefined): React.ReactNode => {
    if (!text) return '-';

    // 如果包含括号，提取括号内的内容
    const match = text.match(/^(.+?)[\\(（](.+?)[\\)）]$/);
    if (!match) return text;

    const mainPart = match[1].trim();
    const detailPart = match[2].trim();

    // 解析限制信息为三行：重量、价格、体积
    const parseRestrictions = (restriction: string): string[] => {
      // 移除"限制:"前缀
      const content = restriction.replace(/^限制[:：]\s*/, '');

      // 使用正则提取三个部分
      const weightMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[克公斤kgг]+)/);
      const priceMatch = content.match(/([\d\s]+[–-][\s\d]+\s*[₽рублей]+)/);
      const sizeMatch = content.match(/([\d\s×xXх]+\s*[厘米смcm]+)/);

      const lines: string[] = [];
      if (restriction.includes('限制')) lines.push('限制:');
      if (weightMatch) lines.push(weightMatch[1].trim());
      if (priceMatch) lines.push(priceMatch[1].trim());
      if (sizeMatch) lines.push(sizeMatch[1].trim());

      return lines.length > 0 ? lines : [restriction];
    };

    const restrictionLines = parseRestrictions(detailPart);

    // 格式化显示（白色背景）
    return (
      <div className={styles.deliveryMethodTextWhite}>
        <div>{mainPart}</div>
        {restrictionLines.map((line, index) => (
          <div
            key={index}
            style={{
              fontSize: '12px',
              color: 'rgba(0, 0, 0, 0.65)',
              marginTop: '2px',
            }}
          >
            {line}
          </div>
        ))}
      </div>
    );
  };

  // 同步订单
  const _syncOrdersMutation = useMutation({
    mutationFn: (fullSync: boolean) => {
      if (!selectedShop) {
        throw new Error('请先选择店铺');
      }
      return ozonApi.syncOrdersDirect(selectedShop, fullSync ? 'full' : 'incremental');
    },
    onSuccess: (data) => {
      notifySuccess('同步已启动', '订单同步任务已启动');
      setSyncTaskId(data.task_id);
      setSyncStatus({
        status: 'running',
        progress: 0,
        message: '正在启动同步...',
      });
    },
    onError: (error: Error) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 轮询同步任务状态
  useEffect(() => {
    if (!syncTaskId || syncStatus?.status === 'completed' || syncStatus?.status === 'failed') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const result = await ozonApi.getSyncStatus(syncTaskId);
        const status = result.data || result; // 兼容不同响应格式
        setSyncStatus(status);

        if (status.status === 'completed') {
          notifySuccess('同步完成', '订单同步已完成！');
          queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
          // 重置分页并刷新页面数据
          resetAndRefresh();
          setSyncTaskId(null);
        } else if (status.status === 'failed') {
          notifyError('同步失败', `同步失败: ${status.error || '未知错误'}`);
          setSyncTaskId(null);
        }
      } catch (error) {
        logger.error('Failed to fetch sync status:', error);
      }
    }, 2000); // 每2秒检查一次

    return () => clearInterval(interval);
  }, [syncTaskId, syncStatus?.status, queryClient, resetAndRefresh]);

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
  const executeBatchSync = async (postings: ozonApi.PostingWithOrder[]) => {
    const notificationKey = 'batch-sync';
    let successCount = 0;
    let failedCount = 0;
    const total = postings.length;

    // 显示初始进度通知
    notification.open({
      key: notificationKey,
      message: '批量同步进行中',
      description: (
        <div>
          <Progress percent={0} size="small" status="active" />
          <div style={{ marginTop: 8 }}>已完成 0/{total} (成功: 0, 失败: 0)</div>
        </div>
      ),
      duration: 0, // 不自动关闭
      icon: <SyncOutlined spin />,
    });

    // 逐个同步订单
    for (let i = 0; i < postings.length; i++) {
      const posting = postings[i];
      try {
        await ozonApi.syncSingleOrder(posting.posting_number, posting.order.shop_id);
        successCount++;
      } catch (error) {
        logger.error(`同步失败: ${posting.posting_number}`, error);
        failedCount++;
      }

      // 更新进度通知
      const completed = i + 1;
      const percent = Math.round((completed / total) * 100);
      notification.open({
        key: notificationKey,
        message: '批量同步进行中',
        description: (
          <div>
            <Progress percent={percent} size="small" status="active" />
            <div style={{ marginTop: 8 }}>
              已完成 {completed}/{total} (成功: {successCount}, 失败: {failedCount})
            </div>
          </div>
        ),
        duration: 0,
        icon: <SyncOutlined spin />,
      });
    }

    // 关闭进度通知
    notification.destroy(notificationKey);

    // 显示最终结果
    if (failedCount === 0) {
      notifySuccess('批量同步完成', `成功同步 ${successCount} 个订单`);
    } else {
      notifyWarning('批量同步完成', `成功: ${successCount}, 失败: ${failedCount}`);
    }

    // 刷新数据
    queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
    queryClient.invalidateQueries({ queryKey: ['packingStats'] });
    resetAndRefresh();

    // 重置同步状态
    setIsBatchSyncing(false);
    setSyncProgress({ success: 0, failed: 0, total: 0 });
  };

  // 批量同步处理函数（直接执行，不弹窗确认）
  const handleBatchSync = () => {
    logger.info('批量同步按钮被点击', { allPostingsLength: allPostings.length });

    if (allPostings.length === 0) {
      logger.warn('没有可同步的订单');
      notifyWarning('操作失败', '当前页面没有可同步的订单');
      return;
    }

    logger.info('开始执行批量同步');

    // 提示用户操作已开始
    notifyInfo('批量同步', `开始同步 ${allPostings.length} 个订单...`);

    // 立即设置同步状态
    setIsBatchSyncing(true);
    setSyncProgress({ success: 0, failed: 0, total: allPostings.length });

    // 在后台执行同步任务（非阻塞）
    executeBatchSync([...allPostings]);
  };

  // 稳定化的回调函数 - 使用 useCallback 避免重复渲染
  const handleCopyCallback = React.useCallback((text: string | undefined, label: string) => {
    if (!text || text === '-') {
      notifyWarning('复制失败', `${label}为空，无法复制`);
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        notifySuccess('复制成功', `${label}已复制`);
      })
      .catch(() => {
        notifyError('复制失败', '复制失败，请手动复制');
      });
  }, []);

  const handleShowDetailCallback = React.useCallback(
    (order: ozonApi.Order, posting: ozonApi.Posting) => {
      showOrderDetail(order, posting);
    },
    []
  );

  const handleOpenImagePreviewCallback = React.useCallback((url: string) => {
    setImageLoading(true);
    setImagePreviewVisible(true);
    setPreviewImageUrl(''); // 先清空旧图
    // 下一帧再设置新图URL，确保旧图已被清除
    requestAnimationFrame(() => {
      setPreviewImageUrl(url);
    });
  }, []);

  const handleCloseImagePreview = React.useCallback(() => {
    setImagePreviewVisible(false);
    setPreviewImageUrl(''); // 关闭时清空图片URL
    setImageLoading(false);
  }, []);

  // 检查图片是否已从缓存加载（处理 onLoad 不触发的情况）
  React.useEffect(() => {
    if (previewImageUrl && imageRef.current) {
      // 图片已经从缓存加载完成
      if (imageRef.current.complete) {
        setImageLoading(false);
      }
    }
  }, [previewImageUrl]);

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
    if (selectedPostingNumbers.length === 0) {
      notifyWarning('打印失败', '请先选择需要打印的订单');
      return;
    }

    if (selectedPostingNumbers.length > 20) {
      notifyError('打印失败', '最多支持同时打印20个标签');
      return;
    }

    setIsPrinting(true);

    try {
      const result = await ozonApi.batchPrintLabels(selectedPostingNumbers);

      if (result.success) {
        // 全部成功
        if (result.pdf_url) {
          window.open(result.pdf_url, '_blank');
        }

        notifySuccess(
          '打印成功',
          `成功打印${result.total}个标签（缓存:${result.cached_count}, 新获取:${result.fetched_count}）`
        );

        // 清空选择
        setSelectedPostingNumbers([]);
      } else if (result.error === 'PARTIAL_FAILURE') {
        // 部分成功
        setPrintErrors(result.failed_postings || []);
        setPrintSuccessPostings(result.success_postings || []);
        setPrintErrorModalVisible(true);

        // 如果有成功的，打开PDF
        if (result.pdf_url) {
          window.open(result.pdf_url, '_blank');
        }
      }
    } catch (error: any) {
      console.error('批量打印错误:', error);

      // 全部失败
      if (error.response?.status === 422) {
        // EuraFlow统一错误格式：error.response.data.error.detail
        const errorData = error.response.data?.error?.detail || error.response.data?.detail;

        if (errorData && typeof errorData === 'object' && errorData.error === 'ALL_FAILED') {
          // 显示详细错误信息
          setPrintErrors(errorData.failed_postings || []);
          setPrintSuccessPostings([]);
          setPrintErrorModalVisible(true);
        } else if (errorData && typeof errorData === 'object' && errorData.error === 'INVALID_STATUS') {
          // 状态错误，显示详细信息
          setPrintErrors(errorData.invalid_postings || []);
          setPrintSuccessPostings([]);
          setPrintErrorModalVisible(true);
        } else {
          // 提取错误信息
          let errorMessage = '部分标签尚未准备好，请在订单装配后45-60秒重试';
          if (error.response?.data?.error) {
            const err = error.response.data.error;
            if (typeof err.title === 'object' && err.title?.message) {
              errorMessage = err.title.message;
            } else if (typeof err.title === 'string') {
              errorMessage = err.title;
            } else if (err.detail?.message) {
              errorMessage = err.detail.message;
            }
          }
          notifyWarning('打印提醒', errorMessage);
        }
      } else {
        // 提取错误信息
        let errorMessage = '打印失败';
        if (error.response?.data?.error) {
          const err = error.response.data.error;
          if (typeof err.title === 'object' && err.title?.message) {
            errorMessage = err.title.message;
          } else if (typeof err.title === 'string') {
            errorMessage = err.title;
          } else if (err.detail?.message) {
            errorMessage = err.detail.message;
          }
        } else if (error.message) {
          errorMessage = error.message;
        }
        notifyError('打印失败', errorMessage);
      }
    } finally {
      setIsPrinting(false);
    }
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
    setIsPrinting(true);
    try {
      const result = await ozonApi.batchPrintLabels([postingNumber]);
      if (result.success && result.pdf_url) {
        // 弹出窗口显示PDF，而不是直接打开
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPosting(postingNumber);
        setCurrentPrintingPostings([]); // 单张打印，清空批量标记
        setShowPrintLabelModal(true);
        notifySuccess('标签加载成功', '请在弹窗中查看并打印');
      } else if (result.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPosting(postingNumber);
        setCurrentPrintingPostings([]);
        setShowPrintLabelModal(true);
      } else {
        notifyError('打印失败', '打印失败');
      }
    } catch (error: any) {
      console.error('打印标签错误:', error);

      // 提取错误信息
      let errorMessage = '打印失败';
      if (error.response?.data?.error) {
        const errorData = error.response.data.error;
        // 处理 title 为对象的情况
        if (typeof errorData.title === 'object' && errorData.title?.message) {
          errorMessage = errorData.title.message;
        } else if (typeof errorData.title === 'string') {
          errorMessage = errorData.title;
        } else if (errorData.detail?.message) {
          errorMessage = errorData.detail.message;
        } else if (errorData.detail) {
          errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
        }
      } else if (error.message) {
        errorMessage = error.message;
      }

      notifyError('打印失败', errorMessage);
    } finally {
      setIsPrinting(false);
    }
  };

  // 扫描结果批量打印标签
  const handleScanBatchPrint = async () => {
    if (scanSelectedPostings.length === 0) {
      notifyWarning('操作失败', '请先选择需要打印的订单');
      return;
    }

    if (scanSelectedPostings.length > 20) {
      notifyError('打印失败', '最多支持同时打印20个标签');
      return;
    }

    setIsPrinting(true);

    try {
      const result = await ozonApi.batchPrintLabels(scanSelectedPostings);
      if (result.success && result.pdf_url) {
        // 弹出窗口显示PDF（与单张打印一致）
        setPrintLabelUrl(result.pdf_url);
        setCurrentPrintingPostings([...scanSelectedPostings]); // 保存批量打印的postings
        setCurrentPrintingPosting(''); // 清空单个posting标记
        setShowPrintLabelModal(true);
        notifySuccess(
          '标签加载成功',
          `成功加载${result.total}个标签（缓存:${result.cached_count}, 新获取:${result.fetched_count}），请在弹窗中查看并打印`
        );
      } else if (result.error === 'PARTIAL_FAILURE') {
        // 部分成功
        setPrintErrors(result.failed_postings || []);
        setPrintSuccessPostings(result.success_postings || []);
        setPrintErrorModalVisible(true);
        // 如果有成功的，也弹出PDF
        if (result.pdf_url) {
          setPrintLabelUrl(result.pdf_url);
          setCurrentPrintingPostings(result.success_postings || []);
          setCurrentPrintingPosting('');
          setShowPrintLabelModal(true);
        }
      }
    } catch (error) {
      if (error.response?.status === 422) {
        const errorData = error.response.data?.error?.detail || error.response.data?.detail;
        if (errorData && typeof errorData === 'object' && errorData.error === 'ALL_FAILED') {
          setPrintErrors(errorData.failed_postings || []);
          setPrintSuccessPostings([]);
          setPrintErrorModalVisible(true);
        } else {
          notifyWarning('打印提醒', '部分标签尚未准备好，请在订单装配后45-60秒重试');
        }
      } else {
        notifyError('打印失败', `打印失败: ${error.response?.data?.error?.title || error.message}`);
      }
    } finally {
      setIsPrinting(false);
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
  const PrintErrorModal = () => (
    <Modal
      title="打印结果"
      open={printErrorModalVisible}
      onCancel={() => setPrintErrorModalVisible(false)}
      footer={[
        <Button key="close" onClick={() => setPrintErrorModalVisible(false)}>
          关闭
        </Button>,
        printSuccessPostings.length > 0 && (
          <Button
            key="retry-failed"
            type="primary"
            onClick={() => {
              // 移除失败的，保留成功的，重新选择
              const failedNumbers = printErrors.map((e) => e.posting_number);
              setSelectedPostingNumbers(
                selectedPostingNumbers.filter((pn) => !failedNumbers.includes(pn))
              );
              setPrintErrorModalVisible(false);
              notifyInfo('订单已移除', '已移除失败的订单，可重新选择并打印');
            }}
          >
            移除失败订单继续
          </Button>
        ),
      ]}
      width={700}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {/* 成功统计 */}
        {printSuccessPostings.length > 0 && (
          <Alert
            message={`成功打印 ${printSuccessPostings.length} 个订单`}
            type="success"
            showIcon
          />
        )}

        {/* 失败列表 */}
        {printErrors.length > 0 && (
          <>
            <Alert
              message={`失败 ${printErrors.length} 个订单`}
              description="以下订单打印失败，请根据提示操作"
              type="error"
              showIcon
            />

            <Table
              dataSource={printErrors}
              rowKey="posting_number"
              pagination={false}
              size="small"
              columns={[
                {
                  title: '货件编号',
                  dataIndex: 'posting_number',
                  width: 180,
                  render: (text) => <Text strong>{text}</Text>,
                },
                {
                  title: '错误原因',
                  dataIndex: 'error',
                  render: (text) => <Text type="danger">{text}</Text>,
                },
                {
                  title: '建议',
                  dataIndex: 'suggestion',
                  render: (text) => <Text type="secondary">{text}</Text>,
                },
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );

  return (
    <div className={styles.pageContainer}>
      {/* 页面标题 */}
      <PageTitle icon={<TruckOutlined />} title="打包发货" />

      {/* 同步进度显示 */}
      {syncStatus && syncStatus.status === 'running' && (
        <Alert
          message="订单同步中"
          description={
            <div>
              <p>{syncStatus.message}</p>
              <Progress percent={Math.round(syncStatus.progress)} status="active" />
            </div>
          }
          type="info"
          showIcon
          closable
          onClose={() => {
            setSyncStatus(null);
            setSyncTaskId(null);
          }}
          className={styles.filterCard}
        />
      )}

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
                      onChange={(e) => setScanTrackingNumber(e.target.value.toUpperCase())}
                      onPressEnter={handleScanSearch}
                      disabled={isScanning}
                      autoFocus
                      size="large"
                      prefix={<SearchOutlined />}
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
                  <Table
                    dataSource={scanItemRows}
                    rowKey="key"
                    pagination={false}
                    size="middle"
                    style={{
                      '--ant-table-padding-vertical': '2px',
                      '--ant-table-padding-horizontal': '2px',
                    } as React.CSSProperties}
                    className={styles.scanResultTable}
                    rowSelection={
                      canOperate
                        ? {
                            // 将 posting_number 转换为第一行的 key
                            selectedRowKeys: scanSelectedPostings.map((pn) => `${pn}_0`),
                            onChange: (selectedRowKeys) => {
                              // 从 key 中提取 posting_number
                              const postingNumbers = Array.from(
                                new Set(
                                  (selectedRowKeys as string[]).map((key) => key.split('_').slice(0, -1).join('_'))
                                )
                              );
                              setScanSelectedPostings(postingNumbers);
                            },
                            getCheckboxProps: (row: ScanResultItemRow) => ({
                              // 非第一行不显示复选框
                              disabled: !row.isFirstItem,
                            }),
                            renderCell: (_checked, row: ScanResultItemRow, _index, originNode) => {
                              // 只在第一行显示复选框，并使用rowSpan
                              if (!row.isFirstItem) {
                                return {
                                  props: { rowSpan: 0 },
                                  children: null,
                                };
                              }
                              return {
                                props: { rowSpan: row.itemCount },
                                children: originNode,
                              };
                            },
                          }
                        : undefined
                    }
                    columns={[
                      // 第一列：商品图片
                      {
                        title: '商品图片',
                        key: 'product_image',
                        width: 180,
                        render: (_: any, row: ScanResultItemRow) => {
                          const item = row.item;
                          const imageUrl = item.image ? optimizeOzonImageUrl(item.image, 160) : null;

                          return (
                            <div
                              style={{
                                width: '160px',
                                height: '160px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: '#f5f5f5',
                                borderRadius: '4px',
                              }}
                            >
                              {imageUrl ? (
                                <img
                                  src={imageUrl}
                                  alt={item.name || item.sku || '商品图片'}
                                  style={{
                                    maxWidth: '100%',
                                    maxHeight: '100%',
                                    objectFit: 'contain',
                                  }}
                                />
                              ) : (
                                <Avatar
                                  size={160}
                                  icon={<ShoppingCartOutlined />}
                                  shape="square"
                                  style={{ backgroundColor: '#f0f0f0' }}
                                />
                              )}
                            </div>
                          );
                        },
                      },
                      // 第二列：商品信息
                      {
                        title: '商品信息',
                        key: 'product_info',
                        width: '20%',
                        onCell: () => ({
                          className: styles.productInfoCell,
                        }),
                        render: (_: any, row: ScanResultItemRow) => {
                          const item = row.item;
                          const price = item.price ? parseFloat(item.price) : 0;
                          const quantity = item.quantity || 0;
                          const amount = price * quantity;

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div>
                                <Text type="secondary">SKU: </Text>
                                <span>{item.sku || '-'}</span>
                              </div>
                              <div>
                                <Text type="secondary">名称: </Text>
                                <Tooltip title={item.name}>
                                  <span
                                    style={{
                                      maxWidth: '200px',
                                      display: 'inline-block',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      verticalAlign: 'bottom',
                                    }}
                                  >
                                    {item.name || '-'}
                                  </span>
                                </Tooltip>
                              </div>
                              <div>
                                <Text type="secondary">单价: </Text>
                                <span>{price > 0 ? price.toFixed(2) : '-'}</span>
                              </div>
                              <div>
                                <Text type="secondary">数量: </Text>
                                <span>{quantity}</span>
                              </div>
                              <div>
                                <Text type="secondary">金额: </Text>
                                <span style={{ fontWeight: 500 }}>{amount > 0 ? amount.toFixed(2) : '-'}</span>
                              </div>
                            </div>
                          );
                        },
                      },
                      // 第三列：货件信息（使用rowSpan合并）
                      {
                        title: '货件信息',
                        key: 'posting_info',
                        render: (_: any, row: ScanResultItemRow) => {
                          if (!row.isFirstItem) {
                            return {
                              props: { rowSpan: 0 },
                              children: null,
                            };
                          }

                          const posting = row.posting;
                          const shopName = shopNameMap[posting.shop_id] || `店铺ID: ${posting.shop_id}`;

                          return {
                            children: (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div>
                                  <Text type="secondary">店铺: </Text>
                                  <span>{shopName}</span>
                                </div>
                                <div>
                                  <Text type="secondary">货件: </Text>
                                  <span>{posting.posting_number}</span>
                                  <CopyOutlined
                                    style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                                    onClick={() => handleCopy(posting.posting_number, '货件编号')}
                                  />
                                </div>
                                <div>
                                  <Text type="secondary">追踪: </Text>
                                  <span>{posting.tracking_number || '-'}</span>
                                  {posting.tracking_number && (
                                    <CopyOutlined
                                      style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                                      onClick={() => handleCopy(posting.tracking_number, '追踪号码')}
                                    />
                                  )}
                                </div>
                                {posting.domestic_tracking_numbers &&
                                posting.domestic_tracking_numbers.length > 0 ? (
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <Text type="secondary" style={{ flexShrink: 0 }}>国内: </Text>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      {posting.domestic_tracking_numbers.map((num: string, idx: number) => (
                                        <div key={idx}>
                                          <a
                                            href={`https://t.17track.net/zh-cn#nums=${num}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ color: '#1890ff' }}
                                          >
                                            {num}
                                          </a>
                                          <CopyOutlined
                                            style={{ marginLeft: 4, cursor: 'pointer', color: '#1890ff' }}
                                            onClick={() => handleCopy(num, '国内单号')}
                                          />
                                        </div>
                                      ))}
                                      {canOperate && (
                                        <Button
                                          type="link"
                                          size="small"
                                          icon={<EditOutlined />}
                                          style={{ padding: 0, height: 'auto', alignSelf: 'flex-start' }}
                                          onClick={() => {
                                            setCurrentPosting(posting);
                                            setDomesticTrackingModalVisible(true);
                                          }}
                                        >
                                          编辑
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <Text type="secondary">国内: </Text>
                                    <span>-</span>
                                    {canOperate && (
                                      <Button
                                        type="link"
                                        size="small"
                                        icon={<EditOutlined />}
                                        style={{ padding: 0, height: 'auto', marginLeft: 8 }}
                                        onClick={() => {
                                          setCurrentPosting(posting);
                                          setDomesticTrackingModalVisible(true);
                                        }}
                                      >
                                        编辑
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ),
                            props: {
                              rowSpan: row.itemCount,
                            },
                          };
                        },
                      },
                      // 第四列：订单信息（使用rowSpan合并）
                      {
                        title: '订单信息',
                        key: 'order_info',
                        render: (_: any, row: ScanResultItemRow) => {
                          if (!row.isFirstItem) {
                            return {
                              props: { rowSpan: 0 },
                              children: null,
                            };
                          }

                          const posting = row.posting;
                          const statusCfg = statusConfig[posting.status] || statusConfig.pending;
                          const opStatusCfg = operationStatusConfig[posting.operation_status];

                          // 解析配送方式，提取括号前和括号内的内容
                          const deliveryMethod = posting.delivery_method || '';
                          const match = deliveryMethod.match(/^(.+?)[（(](.+?)[）)]$/);
                          const mainText = match ? match[1].trim() : deliveryMethod;
                          const detailText = match ? match[2].trim() : '';

                          return {
                            children: (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div>
                                  <Text type="secondary">配送: </Text>
                                  {detailText ? (
                                    <Tooltip title={detailText}>
                                      <span>{mainText || '-'}</span>
                                    </Tooltip>
                                  ) : (
                                    <span>{mainText || '-'}</span>
                                  )}
                                </div>
                                <div>
                                  <Text type="secondary">状态: </Text>
                                  <Tag color={statusCfg.color}>{statusCfg.text}</Tag>
                                </div>
                                {opStatusCfg && (
                                  <div>
                                    <Text type="secondary">操作: </Text>
                                    <Tag color={opStatusCfg.color}>{opStatusCfg.text}</Tag>
                                  </div>
                                )}
                                <div>
                                  <Text type="secondary">下单: </Text>
                                  {posting.ordered_at ? moment(posting.ordered_at).format('MM-DD HH:mm') : '-'}
                                </div>
                                <div>
                                  <Text type="secondary">截止: </Text>
                                  <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
                                    {posting.shipment_date
                                      ? moment(posting.shipment_date).format('MM-DD HH:mm')
                                      : '-'}
                                  </span>
                                </div>
                              </div>
                            ),
                            props: {
                              rowSpan: row.itemCount,
                            },
                          };
                        },
                      },
                      // 第五列：备注（使用rowSpan合并）
                      {
                        title: '备注',
                        key: 'notes',
                        width: 150,
                        render: (_: any, row: ScanResultItemRow) => {
                          if (!row.isFirstItem) {
                            return {
                              props: { rowSpan: 0 },
                              children: null,
                            };
                          }

                          const posting = row.posting;
                          return {
                            children: (
                              <Tooltip title={posting.order_notes || '暂无备注'}>
                                <span
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    display: 'block',
                                  }}
                                >
                                  {posting.order_notes || '-'}
                                </span>
                              </Tooltip>
                            ),
                            props: {
                              rowSpan: row.itemCount,
                            },
                          };
                        },
                      },
                      // 第六列：操作（使用rowSpan合并）
                      {
                        title: '操作',
                        key: 'action',
                        width: 80,
                        fixed: 'right' as const,
                        render: (_: any, row: ScanResultItemRow) => {
                          if (!row.isFirstItem) {
                            return {
                              props: { rowSpan: 0 },
                              children: null,
                            };
                          }

                          return {
                            children: (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {canOperate && (
                                  <>
                                    <Button
                                      type="link"
                                      size="small"
                                      icon={<EditOutlined />}
                                      style={{ padding: 0, height: 'auto' }}
                                      onClick={() => handleOpenEditNotes(row.posting)}
                                    >
                                      编辑
                                    </Button>
                                    <Button
                                      type="link"
                                      size="small"
                                      icon={<PrinterOutlined />}
                                      loading={isPrinting}
                                      style={{ padding: 0, height: 'auto' }}
                                      onClick={() => handlePrintSingleLabel(row.posting.posting_number)}
                                    >
                                      {(row.posting.label_print_count || 0) > 0 && row.posting.operation_status === 'printed' ? '补打' : '打印'}
                                    </Button>
                                  </>
                                )}
                              </div>
                            ),
                            props: {
                              rowSpan: row.itemCount,
                            },
                          };
                        },
                      },
                    ]}
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
                        if (!card.source_platform) return false;

                        // 兼容字符串和数组格式
                        const platformList = Array.isArray(card.source_platform)
                          ? card.source_platform
                          : [card.source_platform];

                        // 检查是否包含所选平台
                        return platformList.includes(selectedPlatform);
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
                      onCopy={handleCopyCallback}
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
      <Modal
        title={`发货 - ${selectedOrder?.order_id}`}
        open={shipModalVisible}
        onCancel={() => setShipModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={shipForm}
          layout="vertical"
          onFinish={(values) => {
            if (!selectedPosting) return;
            shipOrderMutation.mutate({
              posting_number: selectedPosting.posting_number,
              tracking_number: values.tracking_number,
              carrier_code: values.carrier_code,
            });
          }}
        >
          <Alert
            message="发货信息"
            description={`Posting号: ${selectedPosting?.posting_number}`}
            type="info"
            className={styles.alertMargin}
          />

          <Form.Item
            name="tracking_number"
            label="物流单号"
            rules={[{ required: true, message: '请输入物流单号' }]}
          >
            <Input placeholder="请输入物流单号" />
          </Form.Item>

          <Form.Item
            name="carrier_code"
            label="物流公司"
            rules={[{ required: true, message: '请选择物流公司' }]}
          >
            <Select placeholder="请选择物流公司">
              <Option value="CDEK">CDEK</Option>
              <Option value="BOXBERRY">Boxberry</Option>
              <Option value="POCHTA">俄罗斯邮政</Option>
              <Option value="DPD">DPD</Option>
              <Option value="OZON">Ozon物流</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={shipOrderMutation.isPending}>
                确认发货
              </Button>
              <Button
                onClick={() => {
                  setShipModalVisible(false);
                  shipForm.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

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
      {editingPosting && (
        <Modal
          title={`编辑备注 - ${editingPosting.posting_number}`}
          open={editNotesModalVisible}
          onCancel={() => {
            setEditNotesModalVisible(false);
            setEditingPosting(null);
          }}
          onOk={handleSaveEditingNotes}
          confirmLoading={isSavingNotes}
          okText="保存"
          cancelText="取消"
          width={600}
        >
          <Form layout="vertical">
            <Form.Item label="订单备注">
              <Input.TextArea
                value={editingPosting.order_notes || ''}
                onChange={(e) => {
                  setEditingPosting({
                    ...editingPosting,
                    order_notes: e.target.value,
                  });
                }}
                placeholder="请输入订单备注"
                autoSize={{ minRows: 4, maxRows: 10 }}
                maxLength={500}
                showCount
              />
            </Form.Item>
          </Form>
        </Modal>
      )}

      {/* 批量打印错误展示Modal */}
      <PrintErrorModal />

      {/* 图片预览Modal */}
      <Modal
        open={imagePreviewVisible}
        onCancel={handleCloseImagePreview}
        footer={null}
        closable={false}
        mask={false}
        width="auto"
        centered
        bodyStyle={{ padding: 0 }}
      >
        <div className={styles.imagePreviewContainer} style={{ position: 'relative' }}>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={handleCloseImagePreview}
            className={styles.imagePreviewCloseButton}
          />
          {/* 加载占位符 - 覆盖在图片上方 */}
          {imageLoading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '600px',
                minHeight: '600px',
                backgroundColor: '#f0f0f0',
                zIndex: 10,
              }}
            >
              <Spin size="large" tip="加载图片中..." />
            </div>
          )}
          {/* 图片 - 始终渲染（如果有URL），loading时用visibility隐藏 */}
          {previewImageUrl && (
            <img
              ref={imageRef}
              src={previewImageUrl}
              alt="商品大图"
              className={styles.imagePreviewImage}
              style={{ visibility: imageLoading ? 'hidden' : 'visible' }}
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                notifyError('加载失败', '图片加载失败');
              }}
            />
          )}
        </div>
      </Modal>

      {/* 打印标签弹窗 */}
      <Modal
        title="快递面单"
        open={showPrintLabelModal}
        onCancel={() => {
          setShowPrintLabelModal(false);
          setPrintLabelUrl('');
          setCurrentPrintingPosting('');
          setCurrentPrintingPostings([]);
          // 重新聚焦输入框
          setTimeout(() => {
            scanInputRef.current?.focus();
          }, 100);
        }}
        afterClose={() => {
          // 确保弹窗完全关闭后再聚焦
          setTimeout(() => {
            scanInputRef.current?.focus();
          }, 100);
        }}
        width={900}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setShowPrintLabelModal(false);
              setPrintLabelUrl('');
              setCurrentPrintingPosting('');
              setCurrentPrintingPostings([]);
              // 重新聚焦输入框
              setTimeout(() => {
                scanInputRef.current?.focus();
              }, 100);
            }}
          >
            关闭
          </Button>,
          <Button
            key="print"
            type="default"
            icon={<PrinterOutlined />}
            onClick={() => {
              // 触发浏览器打印对话框
              const iframe = document.getElementById('print-label-iframe') as HTMLIFrameElement;
              if (iframe?.contentWindow) {
                iframe.contentWindow.print();
              }
            }}
          >
            打印
          </Button>,
          <Button
            key="mark-printed"
            type="primary"
            onClick={handleMarkPrintedFromModal}
          >
            标记已打印
          </Button>,
        ]}
      >
        <div style={{ width: '100%', height: '600px', display: 'flex', justifyContent: 'center' }}>
          {printLabelUrl ? (
            <iframe
              id="print-label-iframe"
              src={printLabelUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              title="快递面单"
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Spin size="large" tip="加载PDF中..." />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default PackingShipment;
