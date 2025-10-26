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
import { formatPriceWithFallback, _getCurrencySymbol } from '../../utils/currency';

import styles from './PackingShipment.module.scss';

import DomesticTrackingModal from '@/components/ozon/DomesticTrackingModal';
import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import OrderCardComponent, { type OrderCard } from '@/components/ozon/packing/OrderCardComponent';
import PackingSearchBar from '@/components/ozon/packing/PackingSearchBar';
import PrepareStockModal from '@/components/ozon/PrepareStockModal';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import UpdateBusinessInfoModal from '@/components/ozon/UpdateBusinessInfoModal';
import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { logger } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

const { Option } = Select;
const { confirm } = Modal;
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
  const { canOperate, canSync } = usePermission();
  const [urlSearchParams] = useSearchParams();

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
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // 国内单号编辑状态
  const [isEditingTracking, setIsEditingTracking] = useState(false);
  const [editingTrackingNumbers, setEditingTrackingNumbers] = useState<string[]>([]);
  const [isSavingTracking, setIsSavingTracking] = useState(false);

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
    if (tab && ['awaiting_stock', 'allocating', 'allocated', 'tracking_confirmed'].includes(tab)) {
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

  // 状态配置 - 包含所有 OZON 原生状态
  const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
    // 通用订单状态
    pending: {
      color: 'default',
      text: '待确认',
      icon: <ClockCircleOutlined />,
    },
    confirmed: {
      color: 'processing',
      text: '已确认',
      icon: <CheckCircleOutlined />,
    },
    processing: {
      color: 'processing',
      text: '处理中',
      icon: <SyncOutlined spin />,
    },
    shipped: { color: 'cyan', text: '已发货', icon: <TruckOutlined /> },

    // OZON Posting 原生状态
    acceptance_in_progress: {
      color: 'processing',
      text: '验收中',
      icon: <SyncOutlined spin />,
    },
    awaiting_approve: {
      color: 'default',
      text: '等待审核',
      icon: <ClockCircleOutlined />,
    },
    awaiting_packaging: {
      color: 'processing',
      text: '等待备货',
      icon: <ClockCircleOutlined />,
    },
    awaiting_deliver: {
      color: 'warning',
      text: '等待发运',
      icon: <TruckOutlined />,
    },
    awaiting_registration: {
      color: 'processing',
      text: '等待登记',
      icon: <FileTextOutlined />,
    },
    awaiting_debit: {
      color: 'processing',
      text: '等待扣款',
      icon: <ClockCircleOutlined />,
    },
    arbitration: {
      color: 'warning',
      text: '仲裁中',
      icon: <ClockCircleOutlined />,
    },
    client_arbitration: {
      color: 'warning',
      text: '客户仲裁',
      icon: <ClockCircleOutlined />,
    },
    delivering: { color: 'cyan', text: '运输中', icon: <TruckOutlined /> },
    driver_pickup: {
      color: 'processing',
      text: '司机取货',
      icon: <TruckOutlined />,
    },
    delivered: {
      color: 'success',
      text: '已签收',
      icon: <CheckCircleOutlined />,
    },
    cancelled: {
      color: 'error',
      text: '已取消',
      icon: <CloseCircleOutlined />,
    },
    not_accepted: {
      color: 'error',
      text: '未接受',
      icon: <CloseCircleOutlined />,
    },
    sent_by_seller: {
      color: 'cyan',
      text: '卖家已发货',
      icon: <TruckOutlined />,
    },
  };

  // 操作状态配置 - 用于打包发货流程的内部状态
  const operationStatusConfig: Record<string, { color: string; text: string }> = {
    awaiting_stock: { color: 'default', text: '等待备货' },
    allocating: { color: 'processing', text: '分配中' },
    allocated: { color: 'warning', text: '已分配' },
    tracking_confirmed: { color: 'success', text: '单号确认' },
    printed: { color: 'success', text: '已打印' },
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

  // 废弃订单
  const discardOrderMutation = useMutation({
    mutationFn: (postingNumber: string) => ozonApi.discardOrder(postingNumber),
    onSuccess: (_, postingNumber) => {
      // 提交成功，后台会通过 WebSocket 推送同步结果
      notifySuccess('废弃请求已提交', '正在后台同步到跨境巴士，请稍候...');
      // 刷新计数查询
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      // 从当前列表中移除该posting
      setAllPostings((prev) => prev.filter((p) => p.posting_number !== postingNumber));
    },
    onError: (error: Error) => {
      notifyError('废弃失败', `废弃失败: ${error.response?.data?.message || error.message}`);
    },
  });

  // 异步执行批量同步（后台任务）
  const executeBatchSync = async (postings: unknown[]) => {
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

  // 批量同步处理函数（非阻塞）
  const handleBatchSync = () => {
    if (allPostings.length === 0) {
      notifyWarning('操作失败', '当前页面没有可同步的订单');
      return;
    }

    Modal.confirm({
      title: '确认批量同步？',
      content: `将同步当前页面的 ${allPostings.length} 个订单，是否继续？`,
      onOk: () => {
        // 立即设置同步状态
        setIsBatchSyncing(true);
        setSyncProgress({ success: 0, failed: 0, total: allPostings.length });

        // 在后台执行同步任务（非阻塞）
        executeBatchSync([...allPostings]);

        // 立即返回，对话框会关闭
        return Promise.resolve();
      },
    });
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
    (postingNumber: string) => {
      confirm({
        title: '确认废弃订单？',
        content: `货件号: ${postingNumber}。废弃后订单将同步到跨境84并更新为取消状态。`,
        okText: '确认废弃',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
          discardOrderMutation.mutate(postingNumber);
        },
      });
    },
    [discardOrderMutation]
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
    } catch (error) {
      // 全部失败
      if (error.response?.status === 422) {
        // EuraFlow统一错误格式：error.response.data.error.detail
        const errorData = error.response.data?.error?.detail || error.response.data?.detail;

        if (errorData && typeof errorData === 'object' && errorData.error === 'ALL_FAILED') {
          // 显示详细错误信息
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
    setScanResult(null);
    setScanError('');

    try {
      const result = await ozonApi.searchPostingByTracking(scanTrackingNumber.trim());
      if (result.data) {
        setScanResult(result.data);
        setScanError('');
      } else {
        setScanResult(null);
        setScanError('未找到对应的订单');
      }
    } catch (error) {
      setScanResult(null);
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

  // 从扫描结果打印单个标签
  const handlePrintSingleLabel = async (postingNumber: string) => {
    setIsPrinting(true);
    try {
      const result = await ozonApi.batchPrintLabels([postingNumber]);
      if (result.success && result.pdf_url) {
        window.open(result.pdf_url, '_blank');
        notifySuccess('打印成功', '标签已打开');
      } else if (result.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        window.open(result.pdf_url, '_blank');
      } else {
        notifyError('打印失败', '打印失败');
      }
    } catch (error) {
      notifyError('打印失败', `打印失败: ${error.response?.data?.error?.title || error.message}`);
    } finally {
      setIsPrinting(false);
    }
  };

  // 保存订单备注
  const handleSaveOrderNotes = async () => {
    if (!scanResult) return;

    setIsSavingNotes(true);
    try {
      await ozonApi.updatePostingBusinessInfo(scanResult.posting_number, {
        order_notes: scanResult.order_notes,
      });
      notifySuccess('保存成功', '订单备注已更新');
    } catch (error) {
      notifyError('保存失败', `保存失败: ${error.response?.data?.error?.title || error.message}`);
    } finally {
      setIsSavingNotes(false);
    }
  };

  // 开始编辑国内单号
  const handleStartEditTracking = () => {
    const currentNumbers = scanResult?.domestic_tracking_numbers || [];
    setEditingTrackingNumbers([...currentNumbers]);
    setIsEditingTracking(true);
  };

  // 取消编辑国内单号
  const handleCancelEditTracking = () => {
    setIsEditingTracking(false);
    setEditingTrackingNumbers([]);
  };

  // 更新编辑中的单号
  const handleUpdateEditingNumber = (index: number, value: string) => {
    const newNumbers = [...editingTrackingNumbers];
    newNumbers[index] = value.toUpperCase(); // 转大写
    setEditingTrackingNumbers(newNumbers);
  };

  // 删除编辑中的单号
  const handleDeleteEditingNumber = (index: number) => {
    const newNumbers = editingTrackingNumbers.filter((_, i) => i !== index);
    setEditingTrackingNumbers(newNumbers);
  };

  // 添加新单号
  const handleAddTrackingNumber = () => {
    setEditingTrackingNumbers([...editingTrackingNumbers, '']);
  };

  // 保存国内单号
  const handleSaveTrackingNumbers = async () => {
    if (!scanResult) return;

    // 过滤掉空字符串
    const validNumbers = editingTrackingNumbers.filter((n) => n.trim() !== '');

    if (validNumbers.length === 0) {
      notifyWarning('保存失败', '至少需要保留一个国内单号');
      return;
    }

    setIsSavingTracking(true);
    try {
      await ozonApi.updateDomesticTracking(scanResult.posting_number, {
        domestic_tracking_numbers: validNumbers,
      });
      notifySuccess('保存成功', '国内单号已更新');

      // 更新 scanResult
      setScanResult({
        ...scanResult,
        domestic_tracking_numbers: validNumbers,
      });

      // 退出编辑状态
      setIsEditingTracking(false);
      setEditingTrackingNumbers([]);
    } catch (error) {
      notifyError('保存失败', `保存失败: ${error.response?.data?.error?.title || error.message}`);
    } finally {
      setIsSavingTracking(false);
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
    <div>
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
              setScanResult(null);
              setScanError('');
            }
          }}
          items={[
            {
              key: 'awaiting_stock',
              label: (
                <span>
                  <ClockCircleOutlined />
                  等待备货({statusCounts.awaiting_stock})
                </span>
              ),
            },
            {
              key: 'allocating',
              label: (
                <span>
                  <SyncOutlined spin />
                  分配中({statusCounts.allocating})
                </span>
              ),
            },
            {
              key: 'allocated',
              label: (
                <span>
                  <CheckCircleOutlined />
                  已分配({statusCounts.allocated})
                </span>
              ),
            },
            {
              key: 'tracking_confirmed',
              label: (
                <span>
                  <CheckCircleOutlined />
                  单号确认({statusCounts.tracking_confirmed})
                </span>
              ),
            },
            {
              key: 'printed',
              label: (
                <span>
                  <PrinterOutlined />
                  已打印({statusCounts.printed})
                </span>
              ),
            },
            {
              key: 'scan',
              label: (
                <span>
                  <SearchOutlined />
                  扫描单号
                </span>
              ),
            },
          ]}
          style={{ marginTop: 16 }}
        />

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
              {scanResult && (
                <Card title="查询结果">
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="货件编号" span={2}>
                      <Space>
                        <Text strong>{scanResult.posting_number}</Text>
                        <CopyOutlined
                          style={{ cursor: 'pointer', color: '#1890ff' }}
                          onClick={() => handleCopy(scanResult.posting_number, '货件编号')}
                        />
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="追踪号码">
                      {scanResult.tracking_number ? (
                        <Space>
                          <span>{scanResult.tracking_number}</span>
                          <CopyOutlined
                            style={{ cursor: 'pointer', color: '#1890ff' }}
                            onClick={() => handleCopy(scanResult.tracking_number, '追踪号码')}
                          />
                        </Space>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="国内单号" span={2}>
                      {isEditingTracking ? (
                        // 编辑模式
                        <div>
                          {editingTrackingNumbers.map((number, index) => (
                            <div key={index} style={{ marginBottom: '8px' }}>
                              <Space>
                                <Input
                                  value={number}
                                  onChange={(e) =>
                                    handleUpdateEditingNumber(index, e.target.value)
                                  }
                                  placeholder="请输入国内单号"
                                  style={{ width: '200px' }}
                                />
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  icon={<DeleteOutlined />}
                                  onClick={() => handleDeleteEditingNumber(index)}
                                  disabled={editingTrackingNumbers.length === 1}
                                />
                              </Space>
                            </div>
                          ))}
                          <div style={{ marginTop: '8px' }}>
                            <Space>
                              <Button
                                type="dashed"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={handleAddTrackingNumber}
                              >
                                添加单号
                              </Button>
                              <Button
                                type="primary"
                                size="small"
                                icon={<SaveOutlined />}
                                loading={isSavingTracking}
                                onClick={handleSaveTrackingNumbers}
                              >
                                保存
                              </Button>
                              <Button
                                size="small"
                                onClick={handleCancelEditTracking}
                                disabled={isSavingTracking}
                              >
                                取消
                              </Button>
                            </Space>
                          </div>
                        </div>
                      ) : (
                        // 显示模式
                        <div>
                          {scanResult.domestic_tracking_numbers &&
                          scanResult.domestic_tracking_numbers.length > 0 ? (
                            <>
                              {scanResult.domestic_tracking_numbers.map(
                                (number: string, index: number) => (
                                  <div
                                    key={index}
                                    style={{
                                      marginBottom:
                                        index < scanResult.domestic_tracking_numbers.length - 1
                                          ? '4px'
                                          : 0,
                                    }}
                                  >
                                    <Space>
                                      <span>{number}</span>
                                      <CopyOutlined
                                        style={{
                                          cursor: 'pointer',
                                          color: '#1890ff',
                                        }}
                                        onClick={() => handleCopy(number, '国内单号')}
                                      />
                                    </Space>
                                  </div>
                                )
                              )}
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={handleStartEditTracking}
                                style={{ paddingLeft: 0, marginTop: '4px' }}
                              >
                                编辑
                              </Button>
                            </>
                          ) : (
                            <Space>
                              <span>-</span>
                              <Button
                                type="link"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={handleStartEditTracking}
                              >
                                添加
                              </Button>
                            </Space>
                          )}
                        </div>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="订单状态">
                      <Tag color={statusConfig[scanResult.status]?.color || 'default'}>
                        {statusConfig[scanResult.status]?.text || scanResult.status}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="操作状态">
                      <Tag
                        color={
                          operationStatusConfig[scanResult.operation_status]?.color || 'default'
                        }
                      >
                        {operationStatusConfig[scanResult.operation_status]?.text ||
                          scanResult.operation_status ||
                          '-'}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="配送方式" span={2}>
                      {scanResult.delivery_method || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="下单时间">
                      {scanResult.ordered_at
                        ? moment(scanResult.ordered_at).format('YYYY-MM-DD HH:mm')
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="发货截止">
                      <Text type="danger">
                        {scanResult.shipment_date
                          ? moment(scanResult.shipment_date).format('YYYY-MM-DD HH:mm')
                          : '-'}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="订单备注" span={2}>
                      <Input.TextArea
                        value={scanResult.order_notes || ''}
                        onChange={(e) => {
                          setScanResult((prev) => ({
                            ...prev,
                            order_notes: e.target.value,
                          }));
                        }}
                        placeholder="暂无备注"
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        style={{ width: '100%' }}
                      />
                    </Descriptions.Item>
                  </Descriptions>

                  {/* 商品列表 */}
                  {scanResult.items && scanResult.items.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <Text strong>商品明细:</Text>
                      <Table
                        dataSource={scanResult.items}
                        rowKey="sku"
                        pagination={false}
                        size="small"
                        style={{ marginTop: 8 }}
                        columns={[
                          {
                            title: '商品图片',
                            dataIndex: 'image',
                            width: 100,
                            render: (image) =>
                              image ? (
                                <Tooltip
                                  overlayInnerStyle={{ padding: 0 }}
                                  title={
                                    <img
                                      src={optimizeOzonImageUrl(image, 400)}
                                      alt=""
                                      style={{ width: 400, height: 400 }}
                                    />
                                  }
                                >
                                  <img
                                    src={optimizeOzonImageUrl(image, 160)}
                                    alt=""
                                    style={{
                                      width: 160,
                                      height: 160,
                                      cursor: 'pointer',
                                    }}
                                  />
                                </Tooltip>
                              ) : (
                                <Avatar size={160} icon={<ShoppingCartOutlined />} shape="square" />
                              ),
                          },
                          {
                            title: 'SKU',
                            dataIndex: 'sku',
                          },
                          {
                            title: '商品名称',
                            dataIndex: 'name',
                          },
                          {
                            title: '数量',
                            dataIndex: 'quantity',
                            width: 80,
                            render: (qty) => `x${qty}`,
                          },
                          {
                            title: '单价',
                            dataIndex: 'price',
                            width: 100,
                            render: (price) => formatPrice(price),
                          },
                        ]}
                      />
                    </div>
                  )}

                  {/* 操作按钮 */}
                  {canOperate && (
                    <div style={{ marginTop: 16, textAlign: 'center' }}>
                      <Space size="large">
                        <Button
                          type="primary"
                          size="large"
                          icon={<PrinterOutlined />}
                          loading={isPrinting}
                          onClick={() => handlePrintSingleLabel(scanResult.posting_number)}
                          disabled={scanResult.status !== 'awaiting_deliver'}
                        >
                          打印标签
                        </Button>
                        <Button
                          type="default"
                          size="large"
                          icon={<CheckCircleOutlined />}
                          onClick={() => handleMarkPrinted(scanResult.posting_number)}
                          disabled={
                            scanResult.operation_status === 'printed' ||
                            scanResult.status !== 'awaiting_deliver'
                          }
                        >
                          {scanResult.operation_status === 'printed' ? '已打印' : '标记已打印'}
                        </Button>
                        <Button
                          type="default"
                          size="large"
                          icon={<FileTextOutlined />}
                          loading={isSavingNotes}
                          onClick={handleSaveOrderNotes}
                        >
                          保存备注
                        </Button>
                      </Space>
                    </div>
                  )}
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

              {/* 批量打印按钮 - 只在"已分配"及之后的标签显示 */}
              {canOperate &&
                operationStatus !== 'awaiting_stock' &&
                operationStatus !== 'allocating' && (
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
          onSuccess={() => {
            // 操作成功后，从当前列表中移除该posting
            setAllPostings((prev) =>
              prev.filter((p) => p.posting_number !== currentPosting.posting_number)
            );
            setDomesticTrackingModalVisible(false);
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
    </div>
  );
};

export default PackingShipment;
