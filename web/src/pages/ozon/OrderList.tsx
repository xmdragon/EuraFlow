/**
 * Ozon 订单列表页面
 */
import {
  SyncOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Space,
  Card,
  Input,
  Tag,
  Modal,
  DatePicker,
  Tooltip,
  Tabs,
  Form,
  Typography,
  Progress,
  Table,
  Pagination,
} from 'antd';
import React, { useState } from 'react';

import { useCurrency } from '../../hooks/useCurrency';
import { useDateTime } from '../../hooks/useDateTime';
import { formatPriceWithFallback, getCurrencySymbol } from '../../utils/currency';

import styles from './OrderList.module.scss';

import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import ProductImage from '@/components/ozon/ProductImage';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import ShopSelectorWithLabel from '@/components/ozon/ShopSelectorWithLabel';
import PageTitle from '@/components/PageTitle';
import { ORDER_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';
import { OZON_ORDER_STATUS_MAP } from '@/constants/ozonStatus';
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import { useCopy } from '@/hooks/useCopy';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozon';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

const { RangePicker } = DatePicker;
// 仅在 Modal 内使用 Text，表格列中使用原生 span 提升性能
const { Text } = Typography;

// 订单商品行数据结构（用于表格展示）
interface OrderItemRow {
  key: string; // 唯一标识：posting_number + item_index
  item: ozonApi.OrderItem; // 商品明细
  itemIndex: number; // 商品索引（从0开始）
  posting: ozonApi.PostingWithOrder; // 货件信息
  order: ozonApi.Order; // 订单信息
  isFirstItem: boolean; // 是否是第一个商品（用于rowSpan）
  itemCount: number; // 该posting的商品总数（用于rowSpan）
}

const OrderList: React.FC = () => {
  const queryClient = useQueryClient();
  const { currency: userCurrency } = useCurrency();
  const { formatDateTime } = useDateTime();
  const { canOperate, canSync } = usePermission();
  const { copyToClipboard } = useCopy();

  // 订单同步轮询 Hook
  const { startPolling: startOrderSyncPolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const result = await ozonApi.getSyncStatus(taskId);
      const status = result.data || result;

      // 转换为统一格式
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
    notificationKey: 'order-sync',
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
    },
  });

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedOrders, _setSelectedOrders] = useState<ozonApi.Order[]>([]);
  // 始终默认为null（全部店铺），不从localStorage读取
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [filterForm] = Form.useForm();
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [syncConfirmVisible, setSyncConfirmVisible] = useState(false);
  const [syncFullMode, setSyncFullMode] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);
  const [activeTab, setActiveTab] = useState('awaiting_packaging');
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [batchSyncProgress, setBatchSyncProgress] = useState({ current: 0, total: 0, shopName: '' });

  // 进货价格历史弹窗状态
  const [priceHistoryModalVisible, setPriceHistoryModalVisible] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [selectedProductName, setSelectedProductName] = useState<string>('');

  // 搜索参数状态
  interface OrderSearchParams {
    shop_id?: number;
    posting_number?: string;
    keyword?: string; // 智能搜索：货件编号/OZON追踪号/国内单号
    status?: string;
    operation_status?: string;
    date_from?: string;
    date_to?: string;
    [key: string]: unknown;
  }
  const [searchParams, setSearchParams] = useState<OrderSearchParams>({});

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

  // 使用统一的订单状态配置
  const statusConfig = ORDER_STATUS_CONFIG;

  // 查询订单列表
  const {
    data: ordersData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['ozonOrders', currentPage, pageSize, activeTab, selectedShop, searchParams],
    queryFn: () => {
      const dateRange = searchParams.dateRange;

      // "discarded" 标签使用 operation_status='cancelled' 过滤
      const queryParams = {
        ...searchParams,
        shop_id: selectedShop,
        date_from: dateRange?.[0]?.format('YYYY-MM-DD'),
        date_to: dateRange?.[1]?.format('YYYY-MM-DD'),
        dateRange: undefined,
      };

      // keyword 智能搜索：如果是"数字-数字"格式，后端会自动添加通配符
      // 保留 posting_number 兼容旧代码
      if (queryParams.posting_number && /^\d+-\d+$/.test(queryParams.posting_number.trim())) {
        queryParams.posting_number = queryParams.posting_number.trim() + '-%';
      }

      if (activeTab === 'discarded') {
        // 已废弃：使用 operation_status='cancelled' 过滤
        queryParams.operation_status = 'cancelled';
      } else if (activeTab !== 'all') {
        // 其他标签：使用 status 过滤
        queryParams.status = activeTab;
      }

      return ozonApi.getOrders(currentPage, pageSize, queryParams);
    },
    enabled: true, // 支持查询全部店铺（selectedShop=null）
    refetchInterval: 60000, // 1分钟自动刷新
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
    staleTime: 10000, // 数据10秒内不会被认为是过期的
  });

  // 展开订单数据为货件维度（PostingWithOrder 数组）
  const postingsData = React.useMemo<ozonApi.PostingWithOrder[]>(() => {
    if (!ordersData?.data) return [];

    const flattened: ozonApi.PostingWithOrder[] = [];
    ordersData.data.forEach((order: ozonApi.Order) => {
      // 如果订单有 postings，展开每个 posting
      if (order.postings && order.postings.length > 0) {
        order.postings.forEach((posting) => {
          // "已废弃"和"所有"标签：显示所有 posting
          // 其他标签：按 posting.status 过滤
          if (activeTab === 'discarded' || activeTab === 'all' || posting.status === activeTab) {
            flattened.push({
              ...posting,
              order: order, // 关联完整的订单信息
              // 提升常用字段到 posting 级别便于访问
              shop_id: order.shop_id,
              items: posting.products || order.items,
              ordered_at: order.ordered_at,
              delivery_method: order.delivery_method,
            });
          }
        });
      } else {
        // 如果订单没有 postings，使用订单本身的 posting_number 创建一个虚拟 posting
        // 这是为了兼容可能存在的没有 postings 数组的订单
        if (
          order.posting_number &&
          (activeTab === 'discarded' || activeTab === 'all' || order.status === activeTab)
        ) {
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
            // 提升常用字段到 posting 级别便于访问
            shop_id: order.shop_id,
            items: order.items,
            ordered_at: order.ordered_at,
            delivery_method: order.delivery_method,
          } as ozonApi.PostingWithOrder);
        }
      }
    });

    // 如果用户搜索了 keyword 且是货件编号格式，进行二次过滤（前端兜底，主要依赖后端过滤）
    const searchKeyword = searchParams.keyword?.trim();
    if (searchKeyword && searchKeyword.includes('-')) {
      // 仅对货件编号格式进行前端二次过滤
      return flattened.filter((posting) =>
        posting.posting_number.toLowerCase().includes(searchKeyword.toLowerCase())
      );
    }

    return flattened;
  }, [ordersData, searchParams.keyword, activeTab]);

  // 将 PostingWithOrder 数组转换为 OrderItemRow 数组（每个商品一行）
  const orderItemRows = React.useMemo<OrderItemRow[]>(() => {
    const rows: OrderItemRow[] = [];

    postingsData.forEach((posting) => {
      // 优先使用 posting.products（从 raw_payload 提取的该 posting 的商品）
      // 如果不存在，降级使用 posting.order.items（订单级别的商品汇总）
      const items =
        posting.products && posting.products.length > 0
          ? posting.products
          : posting.order.items || [];
      const itemCount = items.length;

      if (itemCount === 0) {
        // 如果没有商品，创建一行空数据
        rows.push({
          key: `${posting.posting_number}_0`,
          item: {} as ozonApi.OrderItem,
          itemIndex: 0,
          posting: posting,
          order: posting.order,
          isFirstItem: true,
          itemCount: 1,
        });
      } else {
        // 为每个商品创建一行
        items.forEach((item, index) => {
          rows.push({
            key: `${posting.posting_number}_${index}`,
            item: item,
            itemIndex: index,
            posting: posting,
            order: posting.order,
            isFirstItem: index === 0,
            itemCount: itemCount,
          });
        });
      }
    });

    return rows;
  }, [postingsData]);

  // 使用统一的货币格式化函数（移除货币符号）
  const formatPrice = (price: string | number): string => {
    // 移除所有可能的货币符号
    return formatPriceWithFallback(price, null, userCurrency)
      .replace(/^[¥₽$€£]/g, '')
      .trim();
  };

  // offer_id到图片的映射，从订单数据中提取
  const offerIdImageMap = React.useMemo(() => {
    const map: Record<string, string> = {};

    // 从订单响应中获取offer_id图片映射
    if (ordersData?.offer_id_images) {
      Object.assign(map, ordersData.offer_id_images);
    }

    // 同时从订单项中提取图片（作为备用）
    if (ordersData?.data) {
      ordersData.data.forEach((order) => {
        if (order.items) {
          order.items.forEach((item) => {
            if (item.offer_id && item.image && !map[item.offer_id]) {
              map[item.offer_id] = item.image;
            }
          });
        }
      });
    }

    return map;
  }, [ordersData]);

  // 格式化配送方式文本（用于tooltip显示 - 深色背景）
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

    // 格式化显示（tooltip深色背景）
    return (
      <div className={styles.deliveryMethodText}>
        <div className={styles.deliveryMethodMain}>{mainPart}</div>
        <div className={styles.deliveryMethodDetail}>
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


  // 同步订单（非阻塞）
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
        // 使用新的轮询 Hook 启动后台轮询任务
        startOrderSyncPolling(taskId);
      } else {
        notifyError('同步失败', '未获取到任务ID，请稍后重试');
      }
    },
    onError: (error: Error) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 已移除旧的 useEffect 轮询逻辑，改为异步后台任务

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

  // 同步单个订单
  const syncSingleOrderMutation = useMutation({
    mutationFn: ({ postingNumber, shopId }: { postingNumber: string; shopId: number }) =>
      ozonApi.syncSingleOrder(postingNumber, shopId),
    onSuccess: () => {
      notifySuccess('同步成功', '订单同步成功');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: Error) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 表格列定义（商品维度 - 4列布局）
  const columns = [
    // 第一列：商品图片（160x160固定容器，右上角显示OZON链接，点击图片放大预览）
    {
      title: '商品图片',
      key: 'product_image',
      width: 180,
      // fixed: 'left' as const, // 移除fixed，避免与rowSelection冲突
      render: (_, row: OrderItemRow) => {
        const item = row.item;
        const rawImageUrl = item.image || (item.offer_id && offerIdImageMap[item.offer_id]);

        return (
          <ProductImage
            imageUrl={rawImageUrl}
            size="medium"
            hoverBehavior="name"
            name={item.name || item.sku}
            topRightCorner="link"
            sku={item.sku}
            offerId={item.offer_id}
          />
        );
      },
    },
    // 第二列：商品信息（店铺、SKU、数量、单价）
    // 使用原生 span 和 title 替代 Typography/Tooltip 提升性能
    {
      title: '商品信息',
      key: 'product_info',
      width: '25%',
      render: (_, row: OrderItemRow) => {
        const item = row.item;
        const order = row.order;
        const currency = order.currency_code || userCurrency || 'CNY';
        const symbol = getCurrencySymbol(currency);

        // 获取店铺名称（从映射中获取真实名称）
        const shopName = shopNameMap[order.shop_id] || `店铺${order.shop_id}`;

        return (
          <div className={styles.infoColumn}>
            <div>
              <span className={styles.labelSecondary}>店铺: </span>
              <strong
                title={shopName}
                style={{
                  display: 'inline-block',
                  maxWidth: '180px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  verticalAlign: 'bottom',
                }}
              >
                {shopName}
              </strong>
            </div>
            <div>
              <span className={styles.labelSecondary}>SKU: </span>
              {item.sku ? (
                <>
                  <a
                    onClick={() => {
                      setSelectedSku(item.sku);
                      setSelectedProductName(item.name || '');
                      setPriceHistoryModalVisible(true);
                    }}
                    style={{ cursor: 'pointer', color: '#1890ff' }}
                  >
                    {item.sku}
                  </a>
                  <CopyOutlined
                    style={{
                      marginLeft: 8,
                      cursor: 'pointer',
                      color: '#1890ff',
                    }}
                    onClick={() => item.sku && copyToClipboard(item.sku, 'SKU')}
                  />
                </>
              ) : (
                <span>-</span>
              )}
            </div>
            <div>
              <span className={styles.labelSecondary}>数量: </span>X {item.quantity || 1}
            </div>
            <div>
              <span className={styles.labelSecondary}>单价: </span>
              <span className={styles.price}>
                {symbol} {formatPrice(item.price || 0)}
              </span>
            </div>
            <div>
              <span className={styles.labelSecondary}>金额: </span>
              <span className={styles.price}>
                {symbol} {formatPrice((Number(item.price) || 0) * (item.quantity || 1))}
              </span>
            </div>
          </div>
        );
      },
    },
    // 第三列：物流信息（货件编号、追踪号码、国内单号，带复制图标）
    // 使用原生 span 替代 Typography 提升性能
    {
      title: '物流信息',
      key: 'logistics_info',
      width: '30%',
      render: (_, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        const packages = posting.packages || [];
        const trackingNumber = packages.length > 0 ? packages[0].tracking_number : undefined;
        // 使用新的数组字段
        const domesticTrackingNumbers = posting.domestic_tracking_numbers || [];

        return {
          children: (
            <div className={styles.infoColumn}>
              <div>
                <span className={styles.labelSecondary}>货件: </span>
                <a
                  onClick={() => showOrderDetail(row.order, posting)}
                  className={styles.link}
                  style={{ cursor: 'pointer' }}
                >
                  {posting.posting_number}
                </a>
                <CopyOutlined
                  style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                  onClick={() => copyToClipboard(posting.posting_number, '货件编号')}
                />
              </div>
              <div>
                <span className={styles.labelSecondary}>追踪: </span>
                <span>{trackingNumber || '-'}</span>
                {trackingNumber && (
                  <CopyOutlined
                    style={{
                      marginLeft: 8,
                      cursor: 'pointer',
                      color: '#1890ff',
                    }}
                    onClick={() => copyToClipboard(trackingNumber, '追踪号码')}
                  />
                )}
              </div>
              <div>
                <span className={styles.labelSecondary}>国内: </span>
                {domesticTrackingNumbers && domesticTrackingNumbers.length > 0 ? (
                  <div style={{ display: 'inline-block', verticalAlign: 'top' }}>
                    {domesticTrackingNumbers.map((number, index) => (
                      <div key={index}>
                        {number}
                        <CopyOutlined
                          style={{
                            marginLeft: 8,
                            cursor: 'pointer',
                            color: '#1890ff',
                          }}
                          onClick={() => copyToClipboard(number, '国内单号')}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <span>-</span>
                )}
              </div>
              {canSync && (
                <div>
                  <Button
                    type="link"
                    size="small"
                    icon={<SyncOutlined spin={syncSingleOrderMutation.isPending} />}
                    loading={syncSingleOrderMutation.isPending}
                    onClick={() => {
                      syncSingleOrderMutation.mutate({
                        postingNumber: posting.posting_number,
                        shopId: row.order.shop_id,
                      });
                    }}
                    style={{ padding: 0, height: 'auto' }}
                  >
                    同步
                  </Button>
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
    // 第四列：订单信息（配送方式、订单状态、订单时间、发货截止）
    // 使用原生 span 和 title 替代 Typography/Tooltip 提升性能
    {
      title: '订单信息',
      key: 'order_info',
      render: (_, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        const order = row.order;
        const fullText =
          posting.delivery_method_name || order.delivery_method || order.order_type || 'FBS';
        const shortText = fullText.split('（')[0].split('(')[0].trim();
        const status = statusConfig[posting.status] || statusConfig.pending;

        return {
          children: (
            <div className={styles.infoColumn}>
              <div>
                <span className={styles.labelSecondary}>配送: </span>
                <span
                  title={fullText}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'inline-block',
                    maxWidth: '150px',
                    verticalAlign: 'bottom',
                  }}
                >
                  {shortText}
                </span>
              </div>
              <div>
                <span className={styles.labelSecondary}>状态: </span>
                <Tag color={status.color} className={styles.tag}>
                  {status.text}
                </Tag>
              </div>
              <div>
                <span className={styles.labelSecondary}>下单: </span>
                {formatDateTime(order.ordered_at)}
              </div>
              <div>
                <span className={styles.labelSecondary}>截止: </span>
                <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
                  {formatDateTime(posting.shipment_date)}
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
  ];

  // 处理函数
  const showOrderDetail = (order: ozonApi.Order, posting?: ozonApi.Posting) => {
    setSelectedOrder(order);
    setSelectedPosting(posting || null);
    setDetailModalVisible(true);
  };

  const handleSync = (fullSync: boolean) => {
    setSyncFullMode(fullSync);
    setSyncConfirmVisible(true);
  };

  const handleSyncConfirm = async () => {
    setSyncConfirmVisible(false);

    // 如果选择了特定店铺，使用原有逻辑
    if (selectedShop) {
      syncOrdersMutation.mutate(syncFullMode);
      return;
    }

    // 全部店铺模式：依次同步所有店铺
    setIsBatchSyncing(true);

    try {
      // 获取所有店铺
      const shopsResponse = await ozonApi.getShops();
      const shops = shopsResponse.data || [];

      if (shops.length === 0) {
        notifyWarning('操作失败', '没有可用的店铺');
        setIsBatchSyncing(false);
        return;
      }

      setBatchSyncProgress({ current: 0, total: shops.length, shopName: '' });

      // 依次同步每个店铺
      for (let i = 0; i < shops.length; i++) {
        const shop = shops[i];
        setBatchSyncProgress({ current: i + 1, total: shops.length, shopName: shop.shop_name });

        try {
          const result = await ozonApi.syncOrdersDirect(shop.id, syncFullMode ? 'full' : 'incremental');
          const taskId = result?.task_id || result?.data?.task_id;

          if (taskId) {
            // 启动轮询任务
            startOrderSyncPolling(taskId);
            // 等待当前店铺同步完成再继续下一个
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error: unknown) {
          loggers.ozon.error(`店铺 ${shop.shop_name} 同步失败`, error);
          const errMsg = error instanceof Error ? error.message : '未知错误';
          notifyWarning('同步失败', `店铺 ${shop.shop_name} 同步失败: ${errMsg}`);
        }
      }

      notifySuccess('批量同步完成', `已启动 ${shops.length} 个店铺的订单同步任务`);
    } catch (error: unknown) {
      loggers.ozon.error('批量同步失败', error);
      const errMsg = error instanceof Error ? error.message : '未知错误';
      notifyError('批量同步失败', errMsg);
    } finally {
      setIsBatchSyncing(false);
      setBatchSyncProgress({ current: 0, total: 0, shopName: '' });
    }
  };

  // 统计数据 - 使用API返回的全局统计数据
  const stats = ordersData?.stats || {
    total: 0,
    discarded: 0,
    awaiting_packaging: 0,
    awaiting_deliver: 0,
    delivering: 0,
    delivered: 0,
    cancelled: 0,
  };

  return (
    <div>
      {/* 同步进度已改为右下角通知显示 */}

      {/* 页面标题 */}
      <PageTitle icon={<ShoppingCartOutlined />} title="订单管理" />

      {/* 搜索过滤 */}
      <Card className={styles.filterCard}>
        <Form
          form={filterForm}
          layout="inline"
          onFinish={(values) => {
            setSearchParams(values);
            setCurrentPage(1); // 搜索时重置到第一页
          }}
        >
          <Form.Item>
            <ShopSelectorWithLabel
              label="选择店铺"
              value={selectedShop}
              onChange={(shopId) => {
                const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
                setSelectedShop(normalized);
                // 切换店铺时重置页码
                setCurrentPage(1);
              }}
              showAllOption={true}
              className={styles.shopSelector}
            />
          </Form.Item>
          <Form.Item name="dateRange">
            <RangePicker />
          </Form.Item>
          <Form.Item name="keyword">
            <Input placeholder="货件/追踪号/国内单号" prefix={<SearchOutlined />} allowClear />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button
                onClick={() => {
                  filterForm.resetFields();
                  setSearchParams({});
                  setCurrentPage(1);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 订单列表 */}
      <Card className={styles.listCard}>
        {/* 状态标签页 */}
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            setCurrentPage(1); // 切换Tab时重置到第一页
          }}
          destroyInactiveTabPane
          items={[
            {
              label: `等待备货 ${stats.awaiting_packaging || 0}`,
              key: 'awaiting_packaging',
            },
            {
              label: `等待发运 ${stats.awaiting_deliver || 0}`,
              key: 'awaiting_deliver',
            },
            {
              label: `运输中 ${stats.delivering || 0}`,
              key: 'delivering',
            },
            {
              label: `已签收 ${stats.delivered || 0}`,
              key: 'delivered',
            },
            {
              label: `已取消 ${stats.cancelled || 0}`,
              key: 'cancelled',
            },
            {
              label: `已废弃 ${stats.discarded || 0}`,
              key: 'discarded',
            },
            {
              label: `所有 ${stats.total || 0}`,
              key: 'all',
            },
          ]}
        />

        {/* 操作按钮 */}
        <Space className={styles.actionSpace}>
          {canSync && (
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={() => handleSync(false)}
              loading={syncOrdersMutation.isPending || isBatchSyncing}
            >
              增量同步
            </Button>
          )}
          {canSync && (
            <Button
              icon={<SyncOutlined />}
              onClick={() => handleSync(true)}
              loading={syncOrdersMutation.isPending || isBatchSyncing}
            >
              全量同步
            </Button>
          )}
        </Space>

        {/* 订单列表（以商品为单位显示，多商品使用rowSpan合并）*/}
        <Table
          loading={isLoading}
          columns={columns}
          dataSource={orderItemRows}
          rowKey={(record) => record.key}
          pagination={false} // 禁用Table内置分页，使用下方独立的Pagination组件
          scroll={{ x: 'max-content' }}
          size="small"
        />

        {/* 独立的分页器（服务端分页） */}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={ordersData?.total || 0}
            showSizeChanger
            showQuickJumper
            pageSizeOptions={[20, 50, 100]}
            showTotal={(total) => `共 ${total} 个订单`}
            onChange={(page, size) => {
              setCurrentPage(page);
              setPageSize(size || 20);
            }}
          />
        </div>
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
          // 刷新订单列表数据
          refetch();
        }}
      />

      {/* 进货价格历史弹窗 */}
      <PurchasePriceHistoryModal
        visible={priceHistoryModalVisible}
        onCancel={() => setPriceHistoryModalVisible(false)}
        sku={selectedSku}
        productName={selectedProductName}
      />

      {/* 同步确认对话框 */}
      <Modal
        title={syncFullMode ? '确认执行全量同步？' : '确认执行增量同步？'}
        open={syncConfirmVisible}
        onOk={handleSyncConfirm}
        onCancel={() => setSyncConfirmVisible(false)}
        okText="确认"
        cancelText="取消"
        zIndex={10000}
      >
        <p>
          {selectedShop ? (
            syncFullMode
              ? '全量同步将拉取所有历史订单数据，耗时较长'
              : '增量同步将只拉取最近7天的订单'
          ) : (
            <>
              {syncFullMode
                ? '将对所有店铺执行全量同步，拉取所有历史订单数据，耗时较长'
                : '将对所有店铺执行增量同步，拉取最近7天的订单'}
              <br />
              <Text type="secondary">将依次同步每个店铺，请耐心等待</Text>
            </>
          )}
        </p>
      </Modal>

      {/* 批量同步进度提示 */}
      {isBatchSyncing && (
        <Modal
          title="批量同步进行中"
          open={true}
          footer={null}
          closable={false}
          zIndex={10001}
        >
          <div>
            <Progress
              percent={Math.round((batchSyncProgress.current / batchSyncProgress.total) * 100)}
              status="active"
            />
            <p style={{ marginTop: 16 }}>
              正在同步第 {batchSyncProgress.current} / {batchSyncProgress.total} 个店铺
            </p>
            {batchSyncProgress.shopName && (
              <p>
                <Text type="secondary">当前店铺：{batchSyncProgress.shopName}</Text>
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default OrderList;
