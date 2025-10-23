/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * Ozon 打包发货页面 - 只显示等待备货的订单
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
  LinkOutlined,
  CloseOutlined,
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
  Checkbox,
  Spin,
  notification,
} from 'antd';
import moment from 'moment';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { formatRuble, formatPriceWithFallback, getCurrencySymbol } from '../../utils/currency';
import { useCurrency } from '../../hooks/useCurrency';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';
import ShopSelector from '@/components/ozon/ShopSelector';
import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import PrepareStockModal from '@/components/ozon/PrepareStockModal';
import UpdateBusinessInfoModal from '@/components/ozon/UpdateBusinessInfoModal';
import DomesticTrackingModal from '@/components/ozon/DomesticTrackingModal';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import styles from './PackingShipment.module.scss';

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
        // 使用新的数组字段的第一个值（如果存在）
        domestic_tracking_number: selectedPosting?.domestic_tracking_numbers?.[0] || '',
        material_cost: selectedOrder.material_cost || '',
        order_notes: selectedOrder.order_notes || '',
        source_platform: selectedOrder.source_platform || '',
      });
    } else {
      form.resetFields();
    }
  }, [selectedOrder, selectedPosting, form]);

  const handleFinish = async (values: any) => {
    try {
      setIsUpdatingExtraInfo(true);

      if (!selectedOrder?.posting_number) {
        throw new Error('订单号不存在');
      }

      // 调用API更新订单额外信息
      await ozonApi.updateOrderExtraInfo(selectedOrder.posting_number, values);

      notifySuccess('订单信息已更新', '订单额外信息更新成功');

      // 刷新列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    } catch (error) {
      notifyError('更新失败', '更新失败: ' + (error as Error).message);
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
            label="采购平台"
            tooltip="商品采购来源平台"
          >
            <Select placeholder="请选择采购平台" allowClear>
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
                  notifyError('同步失败', '订单ID不存在');
                  return;
                }
                if (!selectedPosting?.posting_number) {
                  notifyError('同步失败', '货件编号不存在');
                  return;
                }
                if (!values.domestic_tracking_number) {
                  notifyError('同步失败', '请先填写国内物流单号');
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

// 订单卡片数据结构（用于卡片展示）
interface OrderCard {
  key: string;                      // 唯一标识：posting_number + product_index
  posting: ozonApi.PostingWithOrder;// 货件信息
  product: ozonApi.OrderItem | null;// 商品信息（可能为空）
  order: ozonApi.Order;             // 订单信息
}

// 订单卡片组件的 Props 类型
interface OrderCardComponentProps {
  card: OrderCard;
  shopNameMap: Record<number, string>;
  offerIdImageMap: Record<string, string>;
  selectedPostingNumbers: string[];
  userCurrency: string;
  statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }>;
  operationStatusConfig: Record<string, { color: string; text: string }>;
  operationStatus: string;
  formatPrice: (price: any) => string;
  formatDeliveryMethodText: (method: string | undefined) => React.ReactNode;
  onCopy: (text: string | undefined, label: string) => void;
  onShowDetail: (order: ozonApi.Order, posting: ozonApi.Posting) => void;
  onOpenImagePreview: (url: string) => void;
  onOpenPriceHistory: (sku: string, productName: string) => void;
  onPrepareStock: (posting: ozonApi.PostingWithOrder) => void;
  onUpdateBusinessInfo: (posting: ozonApi.PostingWithOrder) => void;
  onSubmitTracking: (posting: ozonApi.PostingWithOrder) => void;
  onDiscardOrder: (postingNumber: string) => void;
  onCheckboxChange: (postingNumber: string, checked: boolean) => void;
}

// 订单卡片组件 - 使用 React.memo 优化渲染
const OrderCardComponent = React.memo<OrderCardComponentProps>(({
  card,
  shopNameMap,
  offerIdImageMap,
  selectedPostingNumbers,
  userCurrency,
  statusConfig,
  operationStatusConfig,
  operationStatus,
  formatPrice,
  formatDeliveryMethodText,
  onCopy,
  onShowDetail,
  onOpenImagePreview,
  onOpenPriceHistory,
  onPrepareStock,
  onUpdateBusinessInfo,
  onSubmitTracking,
  onDiscardOrder,
  onCheckboxChange,
}) => {
  const { posting, product, order } = card;
  const currency = order.currency_code || userCurrency || 'CNY';
  const symbol = getCurrencySymbol(currency);

  // 获取店铺名称
  const shopName = shopNameMap[order.shop_id] || `店铺${order.shop_id}`;

  // 获取商品图片
  let rawImageUrl = product?.image || (product?.offer_id && offerIdImageMap[product.offer_id]);
  if (!rawImageUrl && product?.sku && order.items) {
    const matchedItem = order.items.find((item: any) => item.sku === product.sku);
    if (matchedItem) {
      rawImageUrl = matchedItem.image || (matchedItem.offer_id && offerIdImageMap[matchedItem.offer_id]);
    }
  }
  const imageUrl = optimizeOzonImageUrl(rawImageUrl, 160);
  const ozonProductUrl = product?.sku ? `https://www.ozon.ru/product/${product.sku}/` : null;

  // 获取追踪号码
  const packages = posting.packages || [];
  const trackingNumber = packages.length > 0 ? packages[0].tracking_number : undefined;

  // 获取国内单号列表
  const domesticTrackingNumbers = posting.domestic_tracking_numbers;

  // 获取进货价格
  const purchasePrice = order.purchase_price;

  // 获取采购平台
  const sourcePlatform = posting.source_platform;

  // 配送方式
  const deliveryMethod = posting.delivery_method_name || order.delivery_method || order.order_type || 'FBS';
  const shortDeliveryMethod = deliveryMethod.split('（')[0].split('(')[0].trim();

  // OZON 原生状态（始终使用）
  const status = statusConfig[posting.status] || statusConfig.pending;

  // 操作状态（用于判断当前所在标签页，控制按钮显示）
  const currentStatus = posting.operation_status || operationStatus;

  // 是否选中
  const isSelected = selectedPostingNumbers.includes(posting.posting_number);

  return (
    <Card
      key={card.key}
      hoverable
      size="small"
      className={styles.orderCard}
      cover={
        <div className={styles.orderCover}>
          {/* 复选框 - 左上角 */}
          {posting.status === 'awaiting_deliver' && (
            <Checkbox
              className={styles.orderCheckbox}
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onCheckboxChange(posting.posting_number, e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {/* 商品图片 */}
          {imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt={product?.name || product?.sku || '商品图片'}
                className={styles.orderImage}
                onClick={() => onOpenImagePreview(optimizeOzonImageUrl(imageUrl, 800))}
              />
              {ozonProductUrl && (
                <Tooltip title="打开OZON链接" color="#000" overlayInnerStyle={{ color: '#fff' }}>
                  <div
                    className={styles.linkIconOverlay}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(ozonProductUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    <LinkOutlined />
                  </div>
                </Tooltip>
              )}
            </>
          ) : (
            <Avatar
              size={160}
              icon={<ShoppingCartOutlined />}
              shape="square"
              className={styles.orderImagePlaceholder}
            />
          )}
        </div>
      }
    >
      <div className={styles.orderCardBody}>
        {/* 店铺 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>店铺:</Text>
          <Tooltip title={shopName}>
            <span className={styles.value}>{shopName}</span>
          </Tooltip>
        </div>

        {/* SKU */}
        {product?.sku && (
          <div className={styles.skuRow}>
            <Text type="secondary" className={styles.label}>SKU:</Text>
            <a
              onClick={() => onOpenPriceHistory(product.sku, product.name || '')}
              className={styles.link}
            >
              {product.sku}
            </a>
            <CopyOutlined
              className={styles.copyIcon}
              onClick={() => onCopy(product.sku, 'SKU')}
            />
          </div>
        )}

        {/* 数量 */}
        {product && (
          <div className={styles.infoRow}>
            <Text type="secondary" className={styles.label}>数量:</Text>
            <Text className={(product.quantity || 1) > 1 ? styles.quantityHighlight : styles.value}>
              X {product.quantity || 1}
            </Text>
          </div>
        )}

        {/* 单价 */}
        {product && (
          <div className={styles.infoRow}>
            <Text type="secondary" className={styles.label}>单价:</Text>
            <span className={styles.price}>
              {symbol} {formatPrice(product.price || 0)}
            </span>
          </div>
        )}

        {/* 进价 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>进价:</Text>
          {purchasePrice && parseFloat(purchasePrice) > 0 ? (
            <span className={styles.price}>
              {symbol} {formatPrice(purchasePrice)}
            </span>
          ) : (
            <Text type="secondary" className={styles.value}>-</Text>
          )}
        </div>

        {/* 平台 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>平台:</Text>
          <Text className={styles.value}>{sourcePlatform || '-'}</Text>
        </div>

        {/* 货件 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>货件:</Text>
          <a
            onClick={() => onShowDetail(order, posting)}
            className={styles.link}
          >
            {posting.posting_number}
          </a>
          <CopyOutlined
            className={styles.copyIcon}
            onClick={() => onCopy(posting.posting_number, '货件编号')}
          />
        </div>

        {/* 追踪 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>追踪:</Text>
          {trackingNumber ? (
            <>
              <span className={styles.value}>{trackingNumber}</span>
              <CopyOutlined
                className={styles.copyIcon}
                onClick={() => onCopy(trackingNumber, '追踪号码')}
              />
            </>
          ) : (
            <Text type="secondary" className={styles.value}>-</Text>
          )}
        </div>

        {/* 国内 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>国内:</Text>
          {domesticTrackingNumbers && domesticTrackingNumbers.length > 0 ? (
            <div style={{ flex: 1 }}>
              {domesticTrackingNumbers.map((number, index) => (
                <div key={index}>
                  <span className={styles.value}>{number}</span>
                  <CopyOutlined
                    className={styles.copyIcon}
                    onClick={() => onCopy(number, '国内单号')}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary" className={styles.value}>-</Text>
          )}
        </div>

        {/* 配送 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>配送:</Text>
          <Tooltip title={formatDeliveryMethodText(deliveryMethod)} overlayInnerStyle={{ color: '#fff' }}>
            <span className={styles.value}>{shortDeliveryMethod}</span>
          </Tooltip>
        </div>

        {/* 状态（始终显示 OZON 原生状态） */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>状态:</Text>
          <Tag color={status.color} className={styles.statusTag}>
            {status.text}
          </Tag>
        </div>

        {/* 下单 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>下单:</Text>
          <Text className={styles.value}>
            {order.ordered_at ? moment(order.ordered_at).format('MM-DD HH:mm') : '-'}
          </Text>
        </div>

        {/* 截止 */}
        <div className={styles.infoRow}>
          <Text type="secondary" className={styles.label}>截止:</Text>
          <span className={styles.deadline}>
            {posting.shipment_date ? moment(posting.shipment_date).format('MM-DD HH:mm') : '-'}
          </span>
        </div>

        {/* 操作按钮 */}
        <div className={styles.actionButtons}>
          {currentStatus === 'awaiting_stock' && (
            <Space size="small">
              <Button type="primary" size="small" onClick={() => onPrepareStock(posting)}>
                备货
              </Button>
              <Button type="default" size="small" onClick={() => onDiscardOrder(posting.posting_number)} danger>
                废弃
              </Button>
            </Space>
          )}
          {currentStatus === 'allocating' && (
            <Space size="small">
              <Button type="default" size="small" onClick={() => onUpdateBusinessInfo(posting)}>
                备注
              </Button>
              <Button type="default" size="small" onClick={() => onDiscardOrder(posting.posting_number)} danger>
                废弃
              </Button>
            </Space>
          )}
          {currentStatus === 'allocated' && (
            <Space size="small">
              <Button type="primary" size="small" onClick={() => onSubmitTracking(posting)}>
                国内单号
              </Button>
              <Button type="default" size="small" onClick={() => onDiscardOrder(posting.posting_number)} danger>
                废弃
              </Button>
            </Space>
          )}
          {currentStatus === 'tracking_confirmed' && (
            <Space size="small">
              <Tag color="success">已完成</Tag>
              <Button type="default" size="small" onClick={() => onDiscardOrder(posting.posting_number)} danger>
                废弃
              </Button>
            </Space>
          )}
          {currentStatus === 'printed' && (
            <Space size="small">
              <Tag color="success">已打印</Tag>
              <Button type="default" size="small" onClick={() => onDiscardOrder(posting.posting_number)} danger>
                废弃
              </Button>
            </Space>
          )}
        </div>
      </div>
    </Card>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数 - 只在关键 props 变化时重新渲染
  return (
    prevProps.card.key === nextProps.card.key &&
    prevProps.selectedPostingNumbers === nextProps.selectedPostingNumbers &&
    prevProps.offerIdImageMap === nextProps.offerIdImageMap &&
    prevProps.shopNameMap === nextProps.shopNameMap
  );
});

OrderCardComponent.displayName = 'OrderCardComponent';

const PackingShipment: React.FC = () => {
  const queryClient = useQueryClient();
  const { currency: userCurrency, symbol: userSymbol } = useCurrency();

  // 状态管理 - 分页和滚动加载
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = React.useRef(1);  // 使用 ref 跟踪当前页，避免 useEffect 依赖
  const [pageSize, setPageSize] = useState(24); // 会根据容器宽度动态调整
  const [itemsPerRow, setItemsPerRow] = useState(6); // 每行显示数量
  const [initialPageSize, setInitialPageSize] = useState(24); // 初始pageSize
  const [allPostings, setAllPostings] = useState<ozonApi.PostingWithOrder[]>([]); // 累积所有已加载的posting
  const [isLoadingMore, setIsLoadingMore] = useState(false); // 是否正在加载更多
  const [hasMoreData, setHasMoreData] = useState(true); // 是否还有更多数据
  const [accumulatedImageMap, setAccumulatedImageMap] = useState<Record<string, string>>({}); // 累积的图片映射
  const [selectedOrders, _setSelectedOrders] = useState<ozonApi.Order[]>([]);
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
  const [isUpdatingExtraInfo, setIsUpdatingExtraInfo] = useState(false);

  // 操作状态Tab（4个状态：等待备货、分配中、已分配、单号确认）
  const [operationStatus, setOperationStatus] = useState<string>('awaiting_stock');

  // 追踪用户访问过的标签（用于按需加载统计数据）
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['awaiting_stock']));

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
  const [syncProgress, setSyncProgress] = useState({ success: 0, failed: 0, total: 0 });

  // 扫描单号状态
  const [scanTrackingNumber, setScanTrackingNumber] = useState<string>('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);

  // 扫描输入框的 ref，用于重新聚焦
  const scanInputRef = React.useRef<any>(null);

  // 图片预览状态
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');
  const [imageLoading, setImageLoading] = useState(false);

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

  // 复制功能处理函数
  const handleCopy = (text: string | undefined, label: string) => {
    if (!text || text === '-') {
      notifyWarning('复制失败', `${label}为空，无法复制`);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      notifySuccess('复制成功', `${label}已复制`);
    }).catch(() => {
      notifyError('复制失败', '复制失败，请手动复制');
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
      const queryParams: any = {
        shop_id: selectedShop,
        ...searchParams,  // 展开所有搜索参数（posting_number/sku/tracking_number/domestic_tracking_number）
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
    currentPageRef.current = 1;  // 同步更新 ref
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
      ordersData.data.forEach((order: any) => {
        if (order.items) {
          order.items.forEach((item: any) => {
            if (item.offer_id && item.image && !newImageMap[item.offer_id]) {
              newImageMap[item.offer_id] = item.image;
            }
          });
        }
      });

      // 合并到累积的映射中
      setAccumulatedImageMap(prev => ({ ...prev, ...newImageMap }));

      // 展开订单为货件
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

      // 后端已做精确匹配，无需前端二次过滤

      // 批量更新状态 - 使用 ref 避免依赖循环
      // React 18 会自动批处理所有 setState，只触发一次渲染
      let newPostingsLength = 0;
      setAllPostings(prev => {
        if (currentPageRef.current === 1) {
          // 第一页，直接使用新数据
          newPostingsLength = flattened.length;
          return flattened;
        }

        // 构建已有posting的Set（使用posting_number作为唯一标识）
        const existingNumbers = new Set(prev.map(p => p.posting_number));

        // 过滤掉已存在的posting（去重）
        const newPostings = flattened.filter(p => !existingNumbers.has(p.posting_number));

        // 合并数据
        const result = [...prev, ...newPostings];
        newPostingsLength = result.length;
        return result;
      });

      // 这些 setState 会和上面的 setAllPostings 批处理，只触发一次渲染
      // 判断是否还有更多数据：
      // 1. 累积的数据量小于总数 AND
      // 2. 本次返回的数据量等于请求的limit（如果小于limit说明已经是最后一页）
      const hasMore = (
        newPostingsLength < (ordersData.total || 0) &&
        ordersData.data.length >= pageSize
      );
      setHasMoreData(hasMore);
      setIsLoadingMore(false);
    }
  }, [ordersData?.data]);  // 只依赖数据变化

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
        setCurrentPage(prev => {
          const next = prev + 1;
          currentPageRef.current = next;  // 同步更新 ref
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
    currentPageRef.current = 1;  // 同步更新 ref
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
    queryFn: () => ozonApi.getPackingStats({
      shop_id: selectedShop,
      ...searchParams,  // 展开所有搜索参数
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

  // 将 PostingWithOrder 数组转换为 OrderCard 数组（每个商品一张卡片）
  const orderCards = React.useMemo<OrderCard[]>(() => {
    const cards: OrderCard[] = [];

    postingsData.forEach((posting) => {
      // 优先使用 posting.products（从 raw_payload 提取的该 posting 的商品）
      // 如果不存在，降级使用 posting.order.items（订单级别的商品汇总）
      const products = (posting.products && posting.products.length > 0)
        ? posting.products
        : (posting.order.items || []);

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
  const formatPrice = (price: any): string => {
    // 移除所有可能的货币符号
    return formatPriceWithFallback(price, null, userCurrency)
      .replace(/^[¥₽$€£]/g, '')
      .trim();
  };

  // offer_id到图片的映射，使用累积的映射
  const offerIdImageMap = accumulatedImageMap;

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

    // 格式化显示（白色背景）
    return (
      <div className={styles.deliveryMethodTextWhite}>
        <div>{mainPart}</div>
        {restrictionLines.map((line, index) => (
          <div key={index} style={{ fontSize: '12px', color: 'rgba(0, 0, 0, 0.65)', marginTop: '2px' }}>
            {line}
          </div>
        ))}
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
      notifySuccess('同步已启动', '订单同步任务已启动');
      setSyncTaskId(data.task_id);
      setSyncStatus({ status: 'running', progress: 0, message: '正在启动同步...' });
    },
    onError: (error: any) => {
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
        console.error('Failed to fetch sync status:', error);
      }
    }, 2000); // 每2秒检查一次

    return () => clearInterval(interval);
  }, [syncTaskId, syncStatus?.status, queryClient]);


  // 发货
  const shipOrderMutation = useMutation({
    mutationFn: ozonApi.shipOrder,
    onSuccess: () => {
      notifySuccess('发货成功', '订单已成功发货');
      setShipModalVisible(false);
      shipForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      notifyError('发货失败', `发货失败: ${error.message}`);
    },
  });

  // 取消订单
  const cancelOrderMutation = useMutation({
    mutationFn: ({ postingNumber, reason }: { postingNumber: string; reason: string }) =>
      ozonApi.cancelOrder(postingNumber, reason),
    onSuccess: () => {
      notifySuccess('订单已取消', '订单已成功取消');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      notifyError('取消失败', `取消失败: ${error.message}`);
    },
  });

  // 同步到跨境巴士
  const syncToKuajing84Mutation = useMutation({
    mutationFn: ({ ozonOrderId, postingNumber, logisticsOrder }: { ozonOrderId: number; postingNumber: string; logisticsOrder: string }) =>
      ozonApi.syncToKuajing84(ozonOrderId, postingNumber, logisticsOrder),
    onSuccess: () => {
      notifySuccess('同步成功', '已成功同步到跨境巴士');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
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
      setAllPostings(prev => prev.filter(p => p.posting_number !== postingNumber));
    },
    onError: (error: any) => {
      notifyError('废弃失败', `废弃失败: ${error.response?.data?.message || error.message}`);
    },
  });

  // 异步执行批量同步（后台任务）
  const executeBatchSync = async (postings: any[]) => {
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
          <div style={{ marginTop: 8 }}>
            已完成 0/{total} (成功: 0, 失败: 0)
          </div>
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
        console.error(`同步失败: ${posting.posting_number}`, error);
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
      }
    });
  };

  // 稳定化的回调函数 - 使用 useCallback 避免重复渲染
  const handleCopyCallback = React.useCallback((text: string | undefined, label: string) => {
    if (!text || text === '-') {
      notifyWarning('复制失败', `${label}为空，无法复制`);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      notifySuccess('复制成功', `${label}已复制`);
    }).catch(() => {
      notifyError('复制失败', '复制失败，请手动复制');
    });
  }, []);

  const handleShowDetailCallback = React.useCallback((order: ozonApi.Order, posting: ozonApi.Posting) => {
    showOrderDetail(order, posting);
  }, []);

  const handleOpenImagePreviewCallback = React.useCallback((url: string) => {
    setPreviewImageUrl('');  // 先清空旧图
    setImageLoading(true);   // 设置加载状态
    setImagePreviewVisible(true);
    // 延迟设置新URL，确保组件已重新渲染
    setTimeout(() => setPreviewImageUrl(url), 0);
  }, []);

  const handleCloseImagePreview = React.useCallback(() => {
    setImagePreviewVisible(false);
    setPreviewImageUrl('');  // 关闭时清空图片URL
    setImageLoading(false);
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

  const handleUpdateBusinessInfoCallback = React.useCallback((posting: ozonApi.PostingWithOrder) => {
    setCurrentPosting(posting);
    setUpdateBusinessInfoModalVisible(true);
  }, []);

  const handleSubmitTrackingCallback = React.useCallback((posting: ozonApi.PostingWithOrder) => {
    setCurrentPosting(posting);
    setDomesticTrackingModalVisible(true);
  }, []);

  const handleDiscardOrderCallback = React.useCallback((postingNumber: string) => {
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
  }, [discardOrderMutation]);

  const handleCheckboxChangeCallback = React.useCallback((postingNumber: string, checked: boolean) => {
    if (checked) {
      setSelectedPostingNumbers(prev => [...prev, postingNumber]);
    } else {
      setSelectedPostingNumbers(prev => prev.filter(pn => pn !== postingNumber));
    }
  }, []);

  // 表格列定义（商品维度 - 4列布局）
  const columns: any[] = [
    // 第一列：商品图片（160x160固定容器，可点击打开OZON商品页）
    {
      title: '商品图片',
      key: 'product_image',
      width: 180,
      // fixed: 'left' as const, // 移除fixed，避免与rowSelection冲突
      render: (_: any, row: OrderItemRow) => {
        const item = row.item;
        const order = row.order;

        // 多级回退查找图片
        let rawImageUrl = item.image || (item.offer_id && offerIdImageMap[item.offer_id]);

        // 如果还没找到图片，尝试从订单items中根据SKU查找
        if (!rawImageUrl && item.sku && order.items) {
          const matchedItem = order.items.find((orderItem: any) => orderItem.sku === item.sku);
          if (matchedItem) {
            rawImageUrl = matchedItem.image || (matchedItem.offer_id && offerIdImageMap[matchedItem.offer_id]);
          }
        }

        const imageUrl = optimizeOzonImageUrl(rawImageUrl, 160);
        const ozonProductUrl = item.sku ? `https://www.ozon.ru/product/${item.sku}/` : null;

        return (
          <div className={styles.productImageContainer}>
            {imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt={item.name || item.sku || '商品图片'}
                  className={styles.productImage}
                  onClick={() => {
                    setPreviewImageUrl('');  // 先清空旧图
                    setImageLoading(true);   // 设置加载状态
                    setImagePreviewVisible(true);
                    // 延迟设置新URL
                    setTimeout(() => setPreviewImageUrl(optimizeOzonImageUrl(rawImageUrl, 800)), 0);
                  }}
                />
                {ozonProductUrl && (
                  <Tooltip title="打开OZON链接" color="#000" overlayInnerStyle={{ color: '#fff' }}>
                    <div
                      className={styles.linkIconOverlay}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(ozonProductUrl, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <LinkOutlined />
                    </div>
                  </Tooltip>
                )}
              </>
            ) : (
              <Avatar
                size={160}
                icon={<ShoppingCartOutlined />}
                shape="square"
                className={styles.productImagePlaceholder}
              />
            )}
          </div>
        );
      },
    },
    // 第二列：商品信息（店铺、SKU、数量、单价）
    {
      title: '商品信息',
      key: 'product_info',
      width: '25%',
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
              <Text type="secondary">SKU: </Text>
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
                    style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => handleCopy(item.sku, 'SKU')}
                  />
                </>
              ) : (
                <span>-</span>
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
    // 第三列：物流信息（货件编号、追踪号码、国内单号、进货价格，带复制图标）
    {
      title: '物流信息',
      key: 'logistics_info',
      width: '30%',
      render: (_: any, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        const order = row.order;
        const packages = posting.packages || [];
        const trackingNumber = packages.length > 0 ? packages[0].tracking_number : undefined;
        // 使用新的数组字段
        const domesticTrackingNumbers = posting.domestic_tracking_numbers;
        // 获取进货价格
        const purchasePrice = order.purchase_price;
        const currency = order.currency_code || userCurrency || 'CNY';
        const symbol = getCurrencySymbol(currency);

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
                {domesticTrackingNumbers && domesticTrackingNumbers.length > 0 ? (
                  <div style={{ display: 'inline-block', verticalAlign: 'top' }}>
                    {domesticTrackingNumbers.map((number, index) => (
                      <div key={index}>
                        {number}
                        <CopyOutlined
                          style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                          onClick={() => handleCopy(number, '国内单号')}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <span>-</span>
                )}
              </div>
              {purchasePrice && parseFloat(purchasePrice) > 0 && (
                <div>
                  <Text type="secondary">进货价格: </Text>
                  <span className={styles.price}>
                    {symbol} {formatPrice(purchasePrice)}
                  </span>
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
    {
      title: '订单信息',
      key: 'order_info',
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
                <Tooltip title={formatDeliveryMethodText(fullText)} overlayInnerStyle={{ color: '#fff' }}>
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
    // 第五列：操作（根据 operation_status 显示不同按钮）
    {
      title: '操作',
      key: 'actions',
      width: 60,
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_: any, row: OrderItemRow) => {
        // 非第一行返回 null（使用 rowSpan）
        if (!row.isFirstItem) return null;

        const posting = row.posting;
        // 使用 posting 的实际 operation_status，如果不存在则降级使用全局 operationStatus
        const currentStatus = posting.operation_status || operationStatus;

        const handlePrepareStock = () => {
          setCurrentPosting(posting);
          setPrepareStockModalVisible(true);
        };

        const handleUpdateBusinessInfo = () => {
          setCurrentPosting(posting);
          setUpdateBusinessInfoModalVisible(true);
        };

        const handleSubmitTracking = () => {
          setCurrentPosting(posting);
          setDomesticTrackingModalVisible(true);
        };

        const handleDiscardOrder = () => {
          confirm({
            title: '确认废弃订单？',
            content: `货件号: ${posting.posting_number}。废弃后订单将同步到跨境84并更新为取消状态。`,
            okText: '确认废弃',
            okType: 'danger',
            cancelText: '取消',
            onOk: () => {
              discardOrderMutation.mutate(posting.posting_number);
            },
          });
        };

        return {
          children: (
            <Space direction="vertical" size="small">
              {currentStatus === 'awaiting_stock' && (
                <>
                  <Button type="primary" size="small" block onClick={handlePrepareStock}>
                    备货
                  </Button>
                  <Button type="default" size="small" block onClick={handleDiscardOrder} danger>
                    废弃
                  </Button>
                </>
              )}
              {currentStatus === 'allocating' && (
                <>
                  <Button type="default" size="small" block onClick={handleUpdateBusinessInfo}>
                    备注
                  </Button>
                  <Button type="default" size="small" block onClick={handleDiscardOrder} danger>
                    废弃
                  </Button>
                </>
              )}
              {currentStatus === 'allocated' && (
                <>
                  <Button type="primary" size="small" block onClick={handleSubmitTracking}>
                    国内单号
                  </Button>
                  <Button type="default" size="small" block onClick={handleDiscardOrder} danger>
                    废弃
                  </Button>
                </>
              )}
              {currentStatus === 'tracking_confirmed' && (
                <>
                  <Tag color="success">已完成</Tag>
                  <Button type="default" size="small" block onClick={handleDiscardOrder} danger>
                    废弃
                  </Button>
                </>
              )}
            </Space>
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
      notifyWarning('同步失败', '请先选择店铺');
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
      const result = await ozonApi.batchPrintLabels(
        selectedPostingNumbers
      );

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

  const handleBatchShip = () => {
    if (selectedOrders.length === 0) {
      notifyWarning('发货失败', '请先选择订单');
      return;
    }
    notifyInfo('功能开发中', '批量发货功能开发中');
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
    } catch (error: any) {
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
      setAllPostings(prev => prev.filter(p => p.posting_number !== postingNumber));
    } catch (error: any) {
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
    } catch (error: any) {
      notifyError('打印失败', `打印失败: ${error.response?.data?.error?.title || error.message}`);
    } finally {
      setIsPrinting(false);
    }
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
              const failedNumbers = printErrors.map(e => e.posting_number);
              setSelectedPostingNumbers(selectedPostingNumbers.filter(pn => !failedNumbers.includes(pn)));
              setPrintErrorModalVisible(false);
              notifyInfo('订单已移除', '已移除失败的订单，可重新选择并打印');
            }}
          >
            移除失败订单继续
          </Button>
        )
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
                  render: (text) => <Text strong>{text}</Text>
                },
                {
                  title: '错误原因',
                  dataIndex: 'error',
                  render: (text) => <Text type="danger">{text}</Text>
                },
                {
                  title: '建议',
                  dataIndex: 'suggestion',
                  render: (text) => <Text type="secondary">{text}</Text>
                }
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );

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

      {/* 搜索过滤（扫描单号标签时隐藏） */}
      {operationStatus !== 'scan' && (
        <Card className={styles.filterCard}>
          <Row gutter={16} align="middle">
            {/* 左侧：店铺选择器 */}
            <Col flex="300px">
              <Space size="middle">
                <span className={styles.shopLabel}>选择店铺:</span>
                <ShopSelector
                  value={selectedShop}
                  onChange={(shopId) => {
                    const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
                    setSelectedShop(normalized);
                    // 切换店铺时会自动重新加载（queryKey改变）
                  }}
                  showAllOption={true}
                  style={{ width: 200 }}
                />
              </Space>
            </Col>

            {/* 右侧：搜索框 */}
            <Col flex="auto">
              <Form
                form={filterForm}
                layout="inline"
                onFinish={(values) => {
                  const searchValue = values.search_text?.trim();

                  if (!searchValue) {
                    setSearchParams({});
                    return;
                  }

                  // 智能识别搜索类型
                  let params: any = {};

                  // 规则1: SKU - 10位数字
                  if (/^\d{10}$/.test(searchValue)) {
                    params.sku = searchValue;
                  }
                  // 规则2: 货件编号 - 包含数字和"-"
                  else if (/\d/.test(searchValue) && searchValue.includes('-')) {
                    params.posting_number = searchValue;
                  }
                  // 规则3: 追踪号码 - 字母开头+中间数字+字母结尾
                  else if (/^[A-Za-z]+\d+[A-Za-z]+$/.test(searchValue)) {
                    params.tracking_number = searchValue;
                  }
                  // 规则4: 国内单号 - 纯数字或字母开头+数字
                  else if (/^\d+$/.test(searchValue) || /^[A-Za-z]+\d+$/.test(searchValue)) {
                    params.domestic_tracking_number = searchValue;
                  }
                  // 其他情况默认按货件编号搜索
                  else {
                    params.posting_number = searchValue;
                  }

                  setSearchParams(params);
                }}
              >
                <Form.Item name="search_text">
                  <Input
                    placeholder="输入SKU/货件编号/追踪号码/国内单号"
                    prefix={<SearchOutlined />}
                    style={{ width: 320 }}
                  />
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
                      }}
                    >
                      重置
                    </Button>
                  </Space>
                </Form.Item>
              </Form>
            </Col>
          </Row>
        </Card>
      )}

      {/* 打包发货列表 */}
      <Card className={styles.listCard}>
        {/* 操作状态 Tabs */}
        <Tabs
          activeKey={operationStatus}
          onChange={(key) => {
            setOperationStatus(key);
            // 记录访问过的标签（用于按需加载统计数据）
            setVisitedTabs(prev => new Set(prev).add(key));
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
                      onChange={(e) => setScanTrackingNumber(e.target.value)}
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
                    <Descriptions.Item label="国内单号">
                      {scanResult.domestic_tracking_numbers && scanResult.domestic_tracking_numbers.length > 0 ? (
                        <div>
                          {scanResult.domestic_tracking_numbers.map((number: string, index: number) => (
                            <div key={index} style={{ marginBottom: index < scanResult.domestic_tracking_numbers.length - 1 ? '4px' : 0 }}>
                              <Space>
                                <span>{number}</span>
                                <CopyOutlined
                                  style={{ cursor: 'pointer', color: '#1890ff' }}
                                  onClick={() => handleCopy(number, '国内单号')}
                                />
                              </Space>
                            </div>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="订单状态">
                      <Tag color={statusConfig[scanResult.status]?.color || 'default'}>
                        {statusConfig[scanResult.status]?.text || scanResult.status}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="操作状态">
                      <Tag color={operationStatusConfig[scanResult.operation_status]?.color || 'default'}>
                        {operationStatusConfig[scanResult.operation_status]?.text || scanResult.operation_status || '-'}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="配送方式" span={2}>
                      {scanResult.delivery_method || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="下单时间">
                      {scanResult.ordered_at ? moment(scanResult.ordered_at).format('YYYY-MM-DD HH:mm') : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="发货截止">
                      <Text type="danger">
                        {scanResult.shipment_date ? moment(scanResult.shipment_date).format('YYYY-MM-DD HH:mm') : '-'}
                      </Text>
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
                            render: (image) => (
                              image ? (
                                <Tooltip
                                  overlayInnerStyle={{ padding: 0 }}
                                  title={<img src={optimizeOzonImageUrl(image, 160)} alt="" style={{ width: 160, height: 160 }} />}
                                >
                                  <img src={optimizeOzonImageUrl(image, 80)} alt="" style={{ width: 80, height: 80, cursor: 'pointer' }} />
                                </Tooltip>
                              ) : (
                                <Avatar size={80} icon={<ShoppingCartOutlined />} shape="square" />
                              )
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
                        disabled={scanResult.operation_status === 'printed' || scanResult.status !== 'awaiting_deliver'}
                      >
                        {scanResult.operation_status === 'printed' ? '已打印' : '标记已打印'}
                      </Button>
                    </Space>
                  </div>
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
              {operationStatus === 'allocating' && (
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
              {operationStatus !== 'awaiting_stock' && operationStatus !== 'allocating' && (
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
                  {orderCards.map(card => (
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
              <Button onClick={() => {
                setShipModalVisible(false);
                shipForm.resetFields();
              }}>取消</Button>
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
            setAllPostings(prev => prev.filter(p => p.posting_number !== currentPosting.posting_number));
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
            setAllPostings(prev => prev.filter(p => p.posting_number !== currentPosting.posting_number));
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
            <div style={{
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
              zIndex: 10
            }}>
              <Spin size="large" tip="加载图片中..." />
            </div>
          )}
          {/* 图片 - 始终渲染（如果有URL），loading时用visibility隐藏 */}
          {previewImageUrl && (
            <img
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
