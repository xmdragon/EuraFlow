/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * Ozon 订单列表页面
 */
import {
  SyncOutlined,
  PrinterOutlined,
  TruckOutlined,
  DownloadOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ShoppingCartOutlined,
  PhoneOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  MoreOutlined,
  SendOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Space,
  Card,
  Row,
  Col,
  Statistic,
  Input,
  Select,
  Tag,
  Modal,
  message,
  DatePicker,
  Tooltip,
  Badge,
  Descriptions,
  Tabs,
  Form,
  Alert,
  Dropdown,
  Typography,
  Progress,
  Avatar,
  Flex,
  Table,
  InputNumber,
  Divider,
} from 'antd';
import moment from 'moment';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { formatRuble, formatPriceWithFallback, getCurrencySymbol } from '../../utils/currency';
import { useCurrency } from '../../hooks/useCurrency';
import ShopSelector from '@/components/ozon/ShopSelector';
import styles from './OrderList.module.scss';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { confirm } = Modal;
const { Text } = Typography;

// 额外信息表单组件
interface ExtraInfoFormProps {
  selectedOrder: ozonApi.Order | null;
  selectedPosting: ozonApi.Posting | null;
  setIsUpdatingExtraInfo: (loading: boolean) => void;
  syncToKuajing84Mutation: any;
}

const ExtraInfoForm: React.FC<ExtraInfoFormProps> = ({ selectedOrder, selectedPosting, setIsUpdatingExtraInfo, syncToKuajing84Mutation }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { symbol: userSymbol } = useCurrency();

  // 优先使用订单货币，否则使用用户设置
  const orderSymbol = getCurrencySymbol(selectedOrder?.currency_code) || userSymbol;

  // 当选中订单变化时，更新表单
  useEffect(() => {
    if (selectedOrder) {
      form.setFieldsValue({
        purchase_price: selectedOrder.purchase_price || '',
        domestic_tracking_number: selectedOrder.domestic_tracking_number || '',
        material_cost: selectedOrder.material_cost || '',
        order_notes: selectedOrder.order_notes || '',
        source_platform: selectedOrder.source_platform || '',
      });
    } else {
      form.resetFields();
    }
  }, [selectedOrder, form]);

  const handleFinish = async (values: any) => {
    try {
      setIsUpdatingExtraInfo(true);

      if (!selectedOrder?.posting_number) {
        throw new Error('订单号不存在');
      }

      // 调用API更新订单额外信息
      await ozonApi.updateOrderExtraInfo(selectedOrder.posting_number, values);

      message.success('订单额外信息更新成功');

      // 刷新列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    } catch (error) {
      message.error('更新失败: ' + (error as Error).message);
    } finally {
      setIsUpdatingExtraInfo(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish}>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="purchase_price"
            label="进货价格"
            tooltip="商品的采购成本"
            rules={[
              {
                pattern: /^\d+(\.\d{1,2})?$/,
                message: '请输入有效的价格（最多2位小数）',
              },
            ]}
          >
            <Input placeholder="进货价格" prefix={orderSymbol} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="material_cost"
            label="物料成本"
            tooltip="包装、标签等物料成本"
            rules={[
              {
                pattern: /^\d+(\.\d{1,2})?$/,
                message: '请输入有效的价格（最多2位小数）',
              },
            ]}
          >
            <Input placeholder="物料成本" prefix={orderSymbol} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="source_platform"
            label="采集平台"
            tooltip="商品采集来源平台"
          >
            <Select placeholder="请选择采集平台" allowClear>
              <Option value="1688">1688</Option>
              <Option value="拼多多">拼多多</Option>
              <Option value="咸鱼">咸鱼</Option>
              <Option value="淘宝">淘宝</Option>
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="domestic_tracking_number"
            label="国内物流单号"
            tooltip="国内物流配送的跟踪单号"
          >
            <Input placeholder="国内物流单号" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item
        name="order_notes"
        label="订单备注"
        tooltip="订单相关的备注信息"
      >
        <Input.TextArea
          placeholder="订单备注"
          autoSize={{ minRows: 3, maxRows: 6 }}
        />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit">
            保存信息
          </Button>
          <Button
            type="default"
            icon={<SendOutlined />}
            loading={syncToKuajing84Mutation.isPending}
            onClick={async () => {
              try {
                // 先保存表单
                const values = await form.validateFields();
                await handleFinish(values);

                // 再同步到跨境巴士
                if (!selectedOrder?.id) {
                  message.error('订单ID不存在');
                  return;
                }
                if (!selectedPosting?.posting_number) {
                  message.error('货件编号不存在');
                  return;
                }
                if (!values.domestic_tracking_number) {
                  message.error('请先填写国内物流单号');
                  return;
                }

                syncToKuajing84Mutation.mutate({
                  ozonOrderId: selectedOrder.id,
                  postingNumber: selectedPosting.posting_number,
                  logisticsOrder: values.domestic_tracking_number,
                });
              } catch (error) {
                console.error('保存并同步失败:', error);
              }
            }}
          >
            保存并同步跨境巴士
          </Button>
          <Button onClick={() => form.resetFields()}>
            重置
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );
};

// 订单商品行数据结构（用于表格展示）
interface OrderItemRow {
  key: string;                      // 唯一标识：posting_number + item_index
  item: ozonApi.OrderItem;          // 商品明细
  itemIndex: number;                // 商品索引（从0开始）
  posting: ozonApi.PostingWithOrder;// 货件信息
  order: ozonApi.Order;             // 订单信息
  isFirstItem: boolean;             // 是否是第一个商品（用于rowSpan）
  itemCount: number;                // 该posting的商品总数（用于rowSpan）
}

const OrderList: React.FC = () => {
  const queryClient = useQueryClient();
  const { currency: userCurrency, symbol: userSymbol } = useCurrency();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedOrders, _setSelectedOrders] = useState<ozonApi.Order[]>([]);
  // 始终默认为null（全部店铺），不从localStorage读取
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [filterForm] = Form.useForm();
  const [shipForm] = Form.useForm();
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [shipModalVisible, setShipModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [isUpdatingExtraInfo, setIsUpdatingExtraInfo] = useState(false);

  // 搜索参数状态
  const [searchParams, setSearchParams] = useState<any>({});

  // 复制功能处理函数
  const handleCopy = (text: string | undefined, label: string) => {
    if (!text || text === '-') {
      message.warning(`${label}为空，无法复制`);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      message.success(`${label}已复制`);
    }).catch(() => {
      message.error('复制失败，请手动复制');
    });
  };

  // 查询店铺列表（用于显示店铺名称）
  const { data: shopsData } = useQuery({
    queryKey: ['ozonShops'],
    queryFn: ozonApi.getShops,
    staleTime: 300000, // 5分钟缓存
  });

  // 建立 shop_id → shop_name 的映射
  const shopNameMap = React.useMemo(() => {
    const map: Record<number, string> = {};
    if (shopsData?.data) {
      shopsData.data.forEach((shop: any) => {
        map[shop.id] = shop.shop_name;
      });
    }
    return map;
  }, [shopsData]);

  // 状态配置 - 包含所有 OZON 原生状态
  const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
    // 通用订单状态
    pending: { color: 'default', text: '待确认', icon: <ClockCircleOutlined /> },
    confirmed: { color: 'processing', text: '已确认', icon: <CheckCircleOutlined /> },
    processing: { color: 'processing', text: '处理中', icon: <SyncOutlined spin /> },
    shipped: { color: 'cyan', text: '已发货', icon: <TruckOutlined /> },

    // OZON Posting 原生状态
    acceptance_in_progress: { color: 'processing', text: '验收中', icon: <SyncOutlined spin /> },
    awaiting_approve: { color: 'default', text: '等待审核', icon: <ClockCircleOutlined /> },
    awaiting_packaging: { color: 'processing', text: '等待备货', icon: <ClockCircleOutlined /> },
    awaiting_deliver: { color: 'warning', text: '等待发运', icon: <TruckOutlined /> },
    awaiting_registration: { color: 'processing', text: '等待登记', icon: <FileTextOutlined /> },
    awaiting_debit: { color: 'processing', text: '等待扣款', icon: <ClockCircleOutlined /> },
    arbitration: { color: 'warning', text: '仲裁中', icon: <ClockCircleOutlined /> },
    client_arbitration: { color: 'warning', text: '客户仲裁', icon: <ClockCircleOutlined /> },
    delivering: { color: 'cyan', text: '运输中', icon: <TruckOutlined /> },
    driver_pickup: { color: 'processing', text: '司机取货', icon: <TruckOutlined /> },
    delivered: { color: 'success', text: '已签收', icon: <CheckCircleOutlined /> },
    cancelled: { color: 'error', text: '已取消', icon: <CloseCircleOutlined /> },
    not_accepted: { color: 'error', text: '未接受', icon: <CloseCircleOutlined /> },
    sent_by_seller: { color: 'cyan', text: '卖家已发货', icon: <TruckOutlined /> },
  };

  // 查询订单列表
  const {
    data: ordersData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['ozonOrders', currentPage, pageSize, activeTab, selectedShop, searchParams],
    queryFn: () => {
      const dateRange = searchParams.dateRange;

      return ozonApi.getOrders(currentPage, pageSize, {
        ...searchParams,
        shop_id: selectedShop,
        status: activeTab === 'all' ? undefined : activeTab,
        date_from: dateRange?.[0]?.format('YYYY-MM-DD'),
        date_to: dateRange?.[1]?.format('YYYY-MM-DD'),
        dateRange: undefined,
      });
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
          flattened.push({
            ...posting,
            order: order  // 关联完整的订单信息
          });
        });
      } else {
        // 如果订单没有 postings，使用订单本身的 posting_number 创建一个虚拟 posting
        // 这是为了兼容可能存在的没有 postings 数组的订单
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
            order: order
          } as ozonApi.PostingWithOrder);
        }
      }
    });

    // 如果用户搜索了 posting_number，进行二次过滤，只保留匹配的货件
    const searchPostingNumber = searchParams.posting_number?.trim();
    if (searchPostingNumber) {
      return flattened.filter(posting =>
        posting.posting_number.toLowerCase().includes(searchPostingNumber.toLowerCase())
      );
    }

    return flattened;
  }, [ordersData, searchParams.posting_number]);

  // 将 PostingWithOrder 数组转换为 OrderItemRow 数组（每个商品一行）
  const orderItemRows = React.useMemo<OrderItemRow[]>(() => {
    const rows: OrderItemRow[] = [];

    postingsData.forEach((posting) => {
      // 优先使用 posting.products（从 raw_payload 提取的该 posting 的商品）
      // 如果不存在，降级使用 posting.order.items（订单级别的商品汇总）
      const items = (posting.products && posting.products.length > 0)
        ? posting.products
        : (posting.order.items || []);
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
  const formatPrice = (price: any): string => {
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
      ordersData.data.forEach((order: any) => {
        if (order.items) {
          order.items.forEach((item: any) => {
            if (item.offer_id && item.image && !map[item.offer_id]) {
              map[item.offer_id] = item.image;
            }
          });
        }
      });
    }

    return map;
  }, [ordersData]);

  // 获取订单项的图片
  const getOrderItemImage = (order: ozonApi.Order): string => {
    if (!order.items || order.items.length === 0) {
      return '';
    }

    // 优先使用订单项自带的图片，否则从映射中获取
    const firstItem = order.items[0];
    if (firstItem.image) {
      return firstItem.image;
    }
    if (firstItem.offer_id && offerIdImageMap[firstItem.offer_id]) {
      return offerIdImageMap[firstItem.offer_id];
    }

    // 如果没有找到，返回空字符串使用占位符
    return '';
  };

  // 格式化配送方式文本（用于详情显示）
  const formatDeliveryMethodText = (text: string | undefined): React.ReactNode => {
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
        <div className={styles.deliveryMethodDetail}>
          {restrictionLines.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
      </div>
    );
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
      message.success('订单同步任务已启动');
      setSyncTaskId(data.task_id);
      setSyncStatus({ status: 'running', progress: 0, message: '正在启动同步...' });
    },
    onError: (error: any) => {
      message.error(`同步失败: ${error.message}`);
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
          message.success('同步完成！');
          queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
          // 刷新页面数据
          refetch();
          setSyncTaskId(null);
        } else if (status.status === 'failed') {
          message.error(`同步失败: ${status.error || '未知错误'}`);
          setSyncTaskId(null);
        }
      } catch (error) {
        console.error('Failed to fetch sync status:', error);
      }
    }, 2000); // 每2秒检查一次

    return () => clearInterval(interval);
  }, [syncTaskId, syncStatus?.status, queryClient]);


  // 发货
  const shipOrderMutation = useMutation({
    mutationFn: ozonApi.shipOrder,
    onSuccess: () => {
      message.success('发货成功');
      setShipModalVisible(false);
      shipForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      message.error(`发货失败: ${error.message}`);
    },
  });

  // 取消订单
  const cancelOrderMutation = useMutation({
    mutationFn: ({ postingNumber, reason }: { postingNumber: string; reason: string }) =>
      ozonApi.cancelOrder(postingNumber, reason),
    onSuccess: () => {
      message.success('订单已取消');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      message.error(`取消失败: ${error.message}`);
    },
  });

  // 同步到跨境巴士
  const syncToKuajing84Mutation = useMutation({
    mutationFn: ({ ozonOrderId, postingNumber, logisticsOrder }: { ozonOrderId: number; postingNumber: string; logisticsOrder: string }) =>
      ozonApi.syncToKuajing84(ozonOrderId, postingNumber, logisticsOrder),
    onSuccess: () => {
      message.success('同步到跨境巴士成功');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      message.error(`同步失败: ${error.message}`);
    },
  });

  // 表格列定义（商品维度 - 5列布局）
  const columns: any[] = [
    // 第一列：商品图片（160x160固定容器，可点击打开OZON商品页）
    {
      title: '商品图片',
      key: 'product_image',
      width: 170,
      render: (_: any, row: OrderItemRow) => {
        const item = row.item;
        const imageUrl = item.image || (item.offer_id && offerIdImageMap[item.offer_id]);
        const ozonProductUrl = item.sku ? `https://www.ozon.ru/product/${item.sku}/` : null;

        const handleImageClick = () => {
          if (ozonProductUrl) {
            window.open(ozonProductUrl, '_blank', 'noopener,noreferrer');
          }
        };

        return (
          <Tooltip title={item.name || item.sku || '点击打开OZON商品页'}>
            <div
              className={styles.productImageContainer}
              onClick={handleImageClick}
              style={{ cursor: ozonProductUrl ? 'pointer' : 'default' }}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={item.name || item.sku || '商品图片'}
                  className={styles.productImage}
                />
              ) : (
                <Avatar
                  size={160}
                  icon={<ShoppingCartOutlined />}
                  shape="square"
                  className={styles.productImagePlaceholder}
                />
              )}
            </div>
          </Tooltip>
        );
      },
    },
    // 第二列：商品信息（店铺、SKU、数量、单价）
    {
      title: '商品信息',
      key: 'product_info',
      width: 260,
      render: (_: any, row: OrderItemRow) => {
        const item = row.item;
        const order = row.order;
        const currency = order.currency_code || userCurrency || 'CNY';
        const symbol = getCurrencySymbol(currency);

        // 获取店铺名称（从映射中获取真实名称）
        const shopName = shopNameMap[order.shop_id] || `店铺${order.shop_id}`;

        return (
          <div className={styles.infoColumn}>
            <div>
              <Text type="secondary">店铺: </Text>
              <Tooltip title={shopName}>
                <strong style={{
                  display: 'inline-block',
                  maxWidth: '180px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  verticalAlign: 'bottom'
                }}>
                  {shopName}
                </strong>
              </Tooltip>
            </div>
            <div>
              {item.sku ? (
                <a
                  href={`https://www.ozon.ru/product/${item.sku}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  SKU: {item.sku}
                </a>
              ) : (
                <span>SKU: -</span>
              )}
            </div>
            <div><Text type="secondary">数量: </Text>X {item.quantity || 1}</div>
            <div>
              <Text type="secondary">单价: </Text>
              <span className={styles.price}>
                {symbol} {formatPrice(item.price || 0)}
              </span>
            </div>
          </div>
        );
      },
    },
    // 第三列：物流信息（货件编号、追踪号码、国内单号，带复制图标）
    {
      title: '物流信息',
      key: 'logistics_info',
      width: 200,
      render: (_: any, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        const packages = posting.packages || [];
        const trackingNumber = packages.length > 0 ? packages[0].tracking_number : undefined;
        const domesticTracking = posting.domestic_tracking_number;

        return {
          children: (
            <div className={styles.infoColumn}>
              <div>
                <Text type="secondary">货件: </Text>
                <a
                  onClick={() => showOrderDetail(row.order, posting)}
                  className={styles.link}
                  style={{ cursor: 'pointer' }}
                >
                  {posting.posting_number}
                </a>
                <CopyOutlined
                  style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                  onClick={() => handleCopy(posting.posting_number, '货件编号')}
                />
              </div>
              <div>
                <Text type="secondary">追踪: </Text>
                <span>{trackingNumber || '-'}</span>
                {trackingNumber && (
                  <CopyOutlined
                    style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => handleCopy(trackingNumber, '追踪号码')}
                  />
                )}
              </div>
              <div>
                <Text type="secondary">国内: </Text>
                <span>{domesticTracking || '-'}</span>
                {domesticTracking && (
                  <CopyOutlined
                    style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => handleCopy(domesticTracking, '国内单号')}
                  />
                )}
              </div>
            </div>
          ),
          props: {
            rowSpan: row.itemCount,
          },
        };
      },
    },
    // 第四列：订单信息（配送方式、订单状态、订单时间、发货截止）
    {
      title: '订单信息',
      key: 'order_info',
      width: 200,
      render: (_: any, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        const order = row.order;
        const fullText = posting.delivery_method_name || order.delivery_method || order.order_type || 'FBS';
        const shortText = fullText.split('（')[0].split('(')[0].trim();
        const status = statusConfig[posting.status] || statusConfig.pending;

        return {
          children: (
            <div className={styles.infoColumn}>
              <div>
                <Text type="secondary">配送: </Text>
                <Tooltip title={formatDeliveryMethodText(fullText)}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '150px', verticalAlign: 'bottom' }}>
                    {shortText}
                  </span>
                </Tooltip>
              </div>
              <div>
                <Text type="secondary">状态: </Text>
                <Tag color={status.color} className={styles.tag}>
                  {status.text}
                </Tag>
              </div>
              <div>
                <Text type="secondary">下单: </Text>
                {order.ordered_at ? moment(order.ordered_at).format('MM-DD HH:mm') : '-'}
              </div>
              <div>
                <Text type="secondary">截止: </Text>
                <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
                  {posting.shipment_date ? moment(posting.shipment_date).format('MM-DD HH:mm') : '-'}
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
    // 第五列：操作（保持最小宽度，固定）
    {
      title: '操作',
      key: 'action',
      width: 60,
      fixed: 'right',
      render: (_: any, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        const order = row.order;
        const canShip = ['awaiting_packaging', 'awaiting_deliver'].includes(posting.status);
        const canCancel = posting.status !== 'cancelled' && posting.status !== 'delivered';

        return {
          children: (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'detail',
                    icon: <FileTextOutlined />,
                    label: '详情',
                    onClick: () => showOrderDetail(order, posting),
                  },
                  canShip && {
                    key: 'ship',
                    icon: <TruckOutlined />,
                    label: '发货',
                    onClick: () => handleShip(posting),
                  },
                  {
                    key: 'print',
                    icon: <PrinterOutlined />,
                    label: '打印面单',
                  },
                  canCancel && {
                    key: 'cancel',
                    icon: <CloseCircleOutlined />,
                    label: '取消订单',
                    danger: true,
                    onClick: () => handleCancel(posting),
                  },
                ].filter(Boolean),
              }}
            >
              <Button type="link" size="small" icon={<MoreOutlined />} className={styles.linkButton} />
            </Dropdown>
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

  const handleShip = (postingWithOrder: ozonApi.PostingWithOrder) => {
    setSelectedOrder(postingWithOrder.order);
    setSelectedPosting(postingWithOrder);
    setShipModalVisible(true);
  };

  const handleCancel = (postingWithOrder: ozonApi.PostingWithOrder) => {
    confirm({
      title: '确认取消订单？',
      content: `订单号: ${postingWithOrder.order.order_number || postingWithOrder.order.order_id}，货件号: ${postingWithOrder.posting_number}`,
      onOk: () => {
        cancelOrderMutation.mutate({
          postingNumber: postingWithOrder.posting_number,
          reason: '卖家取消',
        });
      },
    });
  };

  const handleSync = (fullSync: boolean) => {
    if (!selectedShop) {
      message.warning('请先选择店铺');
      return;
    }

    confirm({
      title: fullSync ? '确认执行全量同步？' : '确认执行增量同步？',
      content: fullSync ? '全量同步将拉取所有历史订单数据，耗时较长' : '增量同步将只拉取最近7天的订单',
      onOk: () => {
        syncOrdersMutation.mutate(fullSync);
      },
    });
  };

  const handleBatchPrint = () => {
    if (selectedOrders.length === 0) {
      message.warning('请先选择订单');
      return;
    }
    message.info('批量打印功能开发中');
  };

  const handleBatchShip = () => {
    if (selectedOrders.length === 0) {
      message.warning('请先选择订单');
      return;
    }
    message.info('批量发货功能开发中');
  };

  // 统计数据 - 使用API返回的全局统计数据
  const stats = ordersData?.stats || {
    total: 0,
    awaiting_packaging: 0,
    awaiting_deliver: 0,
    delivering: 0,
    delivered: 0,
    cancelled: 0,
  };

  return (
    <div>
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

      {/* 搜索过滤 */}
      <Card className={styles.filterCard}>
        <Row className={styles.filterRow}>
          <Col flex="auto">
            <Space size="large">
              <span className={styles.shopLabel}>选择店铺:</span>
              <ShopSelector
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
            </Space>
          </Col>
        </Row>
        <Form
          form={filterForm}
          layout="inline"
          onFinish={(values) => {
            setSearchParams(values);
            setCurrentPage(1); // 搜索时重置到第一页
          }}
        >
          <Form.Item name="dateRange">
            <RangePicker />
          </Form.Item>
          <Form.Item name="posting_number">
            <Input placeholder="货件编号" prefix={<SearchOutlined />} />
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
              label: '所有',
              key: 'all',
            },
          ]}
        />

        {/* 操作按钮 */}
        <Space className={styles.actionSpace}>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={() => handleSync(false)}
            loading={syncOrdersMutation.isPending}
            disabled={!selectedShop}
          >
            增量同步
          </Button>
          <Button
            icon={<SyncOutlined />}
            onClick={() => handleSync(true)}
            loading={syncOrdersMutation.isPending}
            disabled={!selectedShop}
          >
            全量同步
          </Button>
          <Button
            icon={<TruckOutlined />}
            onClick={handleBatchShip}
            disabled={selectedOrders.length === 0}
          >
            批量发货
          </Button>
          <Button
            icon={<PrinterOutlined />}
            onClick={handleBatchPrint}
            disabled={selectedOrders.length === 0}
          >
            批量打印
          </Button>
          <Button icon={<DownloadOutlined />}>导出订单</Button>
        </Space>

        {/* 订单列表（以商品为单位显示，多商品使用rowSpan合并）*/}
        <Table
          loading={isLoading}
          columns={columns}
          dataSource={orderItemRows}
          rowKey="key"
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: ordersData?.total || 0,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条货件`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size || 50);
            },
            className: styles.pagination,
          }}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>

      {/* 订单详情弹窗 */}
      <Modal
        title={`订单详情 - ${selectedPosting?.posting_number || selectedOrder?.order_id}`}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={900}
      >
        {selectedOrder && (
          <Tabs
            defaultActiveKey="1"
            items={[
              {
                label: '基本信息',
                key: '1',
                children: (
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="订单号">{selectedOrder.order_id}</Descriptions.Item>
                    <Descriptions.Item label="Ozon订单号">
                      {selectedOrder.ozon_order_id || selectedOrder.order_id}
                    </Descriptions.Item>
                    <Descriptions.Item label="状态">
                      <Tag color={statusConfig[selectedOrder.status]?.color}>
                        {statusConfig[selectedOrder.status]?.text}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="订单类型">
                      {selectedOrder.order_type || 'FBS'}
                    </Descriptions.Item>
                    <Descriptions.Item label="总金额">
                      {formatPriceWithFallback(
                        selectedOrder.total_price || selectedOrder.total_amount,
                        selectedOrder.currency_code,
                        userCurrency
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="商品金额">
                      {formatPriceWithFallback(
                        selectedOrder.products_price || selectedOrder.products_amount,
                        selectedOrder.currency_code,
                        userCurrency
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="运费">
                      {selectedOrder.delivery_price || selectedOrder.delivery_amount
                        ? formatPriceWithFallback(
                            selectedOrder.delivery_price || selectedOrder.delivery_amount,
                            selectedOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="佣金">
                      {formatPriceWithFallback(
                        selectedOrder.commission_amount,
                        selectedOrder.currency_code,
                        userCurrency
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="下单时间">
                      {selectedOrder.ordered_at ? moment(selectedOrder.ordered_at).format('YYYY-MM-DD HH:mm:ss') :
                       (selectedOrder.created_at ? moment(selectedOrder.created_at).format('YYYY-MM-DD HH:mm:ss') : '-')}
                    </Descriptions.Item>
                    <Descriptions.Item label="配送方式">
                      {(() => {
                        const fullText = selectedOrder.delivery_method || '-';
                        if (fullText === '-') return fullText;
                        // 提取括号前的内容（支持中英文括号）
                        const shortText = fullText.split('（')[0].split('(')[0].trim();
                        return (
                          <Tooltip title={formatDeliveryMethodText(fullText)}>
                            <span>{shortText}</span>
                          </Tooltip>
                        );
                      })()}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                label: '商品明细',
                key: '2',
                children: (
                  <Table
                    dataSource={selectedOrder.items}
                    rowKey="sku"
                    pagination={false}
                    columns={[
                      {
                        title: '图片',
                        dataIndex: 'sku',
                        key: 'image',
                        width: 80,
                        render: (sku, record) => {
                          const imageUrl = record.image || (record.offer_id && offerIdImageMap[record.offer_id] ? offerIdImageMap[record.offer_id] : undefined);
                          return imageUrl ? (
                            <Avatar
                              src={imageUrl}
                              size={60}
                              shape="square"
                              className={styles.productImage}
                            />
                          ) : (
                            <Avatar
                              icon={<ShoppingCartOutlined />}
                              size={60}
                              shape="square"
                              className={styles.productImagePlaceholder}
                            />
                          );
                        },
                      },
                      { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 120 },
                      {
                        title: '商品名称',
                        dataIndex: 'name',
                        key: 'name',
                        render: (name, record) => {
                          if (record.sku) {
                            return (
                              <a
                                href={`https://www.ozon.ru/product/${record.sku}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.link}
                              >
                                {name || record.sku}
                              </a>
                            );
                          }
                          return name || record.sku;
                        }
                      },
                      { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80 },
                      {
                        title: '单价',
                        dataIndex: 'price',
                        key: 'price',
                        width: 100,
                        render: (price) => formatPriceWithFallback(
                          price,
                          selectedOrder?.currency_code,
                          userCurrency
                        ),
                      },
                      {
                        title: '小计',
                        dataIndex: 'total_amount',
                        key: 'total_amount',
                        width: 100,
                        render: (amount) => formatPriceWithFallback(
                          amount,
                          selectedOrder?.currency_code,
                          userCurrency
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                label: '客户信息',
                key: '3',
                children: (
                  <Descriptions bordered>
                    <Descriptions.Item label="客户ID">
                      {selectedOrder.customer_id || <Text type="secondary">隐私保护</Text>}
                    </Descriptions.Item>
                    <Descriptions.Item label="电话">
                      {selectedOrder.customer_phone || <Text type="secondary">隐私保护</Text>}
                    </Descriptions.Item>
                    <Descriptions.Item label="邮箱">
                      {selectedOrder.customer_email || <Text type="secondary">隐私保护</Text>}
                    </Descriptions.Item>
                    <Descriptions.Item label="收货地址" span={3}>
                      {selectedOrder.delivery_address ? (
                        <div>
                          {selectedOrder.delivery_address.region && (
                            <>
                              <Text strong>{selectedOrder.delivery_address.region}</Text>
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.city && (
                            <>
                              {selectedOrder.delivery_address.city}
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.delivery_type && (
                            <>
                              配送方式: {selectedOrder.delivery_address.delivery_type}
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.street && (
                            <>
                              {selectedOrder.delivery_address.street}
                              {selectedOrder.delivery_address.building &&
                                `, ${selectedOrder.delivery_address.building}`}
                              {selectedOrder.delivery_address.apartment &&
                                `, кв. ${selectedOrder.delivery_address.apartment}`}
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.postal_code && (
                            <>邮编: {selectedOrder.delivery_address.postal_code}</>
                          )}
                        </div>
                      ) : (
                        <Text type="secondary">地址信息保护</Text>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                label: '额外信息',
                key: '4',
                children: <ExtraInfoForm selectedOrder={selectedOrder} selectedPosting={selectedPosting} setIsUpdatingExtraInfo={setIsUpdatingExtraInfo} syncToKuajing84Mutation={syncToKuajing84Mutation} />
              },
              {
                label: '物流信息',
                key: '5',
                children: selectedOrder.postings?.map((posting) => (
                  <Card key={posting.id} className={styles.postingCard}>
                    <Descriptions bordered size="small" column={1}>
                      <Descriptions.Item label="Posting号">
                        {posting.posting_number}
                      </Descriptions.Item>
                      <Descriptions.Item label="状态">
                        {statusConfig[posting.status]?.text || posting.status}
                      </Descriptions.Item>
                      <Descriptions.Item label="仓库">{posting.warehouse_name}</Descriptions.Item>
                      <Descriptions.Item label="配送方式">
                        {formatDeliveryMethodText(posting.delivery_method_name)}
                      </Descriptions.Item>
                      <Descriptions.Item label="发货时间">
                        {posting.shipped_at
                          ? moment(posting.shipped_at).format('YYYY-MM-DD HH:mm')
                          : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="送达时间">
                        {posting.delivered_at
                          ? moment(posting.delivered_at).format('YYYY-MM-DD HH:mm')
                          : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="国际物流单号">
                        {posting.packages && posting.packages.length > 0 ? (
                          <div>
                            {posting.packages.map((pkg, index) => (
                              <div key={pkg.id || index} style={{ marginBottom: 4 }}>
                                {pkg.tracking_number || '-'}
                                {pkg.carrier_name && <Text type="secondary"> ({pkg.carrier_name})</Text>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          '-'
                        )}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )),
              },
            ]}
          />
        )}
      </Modal>

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
              <Button onClick={() => {
                setShipModalVisible(false);
                shipForm.resetFields();
              }}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default OrderList;
