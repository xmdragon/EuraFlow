 
/**
 * 打包发货订单卡片组件
 */
import { ShoppingCartOutlined, LinkOutlined, CopyOutlined } from '@ant-design/icons';
import { Card, Checkbox, Avatar, Tooltip, Tag, Button, Space, Typography } from 'antd';
import React from 'react';

import styles from '../../../pages/ozon/PackingShipment.module.scss';

import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozon';
import { getCurrencySymbol } from '@/utils/currency';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

const { Text } = Typography;

// 订单卡片数据结构（用于卡片展示）
export interface OrderCard {
  key: string; // 唯一标识：posting_number + product_index
  posting: ozonApi.PostingWithOrder; // 货件信息
  product: ozonApi.OrderItem | null; // 商品信息（可能为空）
  order: ozonApi.Order; // 订单信息
}

// 订单卡片组件的 Props 类型
export interface OrderCardComponentProps {
  card: OrderCard;
  shopNameMap: Record<number, string>;
  offerIdImageMap: Record<string, string>;
  selectedPostingNumbers: string[];
  userCurrency: string;
  statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }>;
  operationStatusConfig: Record<string, { color: string; text: string }>;
  operationStatus: string;
  formatPrice: (price: string | number) => string;
  formatDeliveryMethodText: (method: string | undefined) => React.ReactNode;
  onCopy: (text: string | undefined, label: string) => void;
  onShowDetail: (order: ozonApi.Order, posting: ozonApi.Posting) => void;
  onOpenImagePreview: (url: string) => void;
  onOpenPriceHistory: (sku: string, productName: string) => void;
  onPrepareStock: (posting: ozonApi.PostingWithOrder) => void;
  onUpdateBusinessInfo: (posting: ozonApi.PostingWithOrder) => void;
  onSubmitTracking: (posting: ozonApi.PostingWithOrder) => void;
  onDiscardOrder: (posting: ozonApi.PostingWithOrder) => void;
  onCheckboxChange: (postingNumber: string, checked: boolean) => void;
  canOperate: boolean;
}

// 订单卡片组件 - 使用 React.memo 优化渲染
export const OrderCardComponent = React.memo<OrderCardComponentProps>(
  ({
    card,
    shopNameMap,
    offerIdImageMap,
    selectedPostingNumbers,
    userCurrency,
    statusConfig,
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
    canOperate,
  }) => {
    const { formatDateTime } = useDateTime();
    const { posting, product, order } = card;
    const currency = order.currency_code || userCurrency || 'CNY';
    const symbol = getCurrencySymbol(currency);

    // 解析商品索引,判断是否是第一个商品
    const productIndex = parseInt(card.key.split('_').pop() || '0', 10);
    const isFirstProduct = productIndex === 0;

    // 获取店铺名称
    const shopName = shopNameMap[order.shop_id] || `店铺${order.shop_id}`;

    // 获取商品图片
    let rawImageUrl = product?.image || (product?.offer_id && offerIdImageMap[product.offer_id]);
    if (!rawImageUrl && product?.sku && order.items) {
      const matchedItem = order.items.find((item) => item.sku === product.sku);
      if (matchedItem) {
        rawImageUrl =
          matchedItem.image || (matchedItem.offer_id && offerIdImageMap[matchedItem.offer_id]);
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
    const deliveryMethod =
      posting.delivery_method_name || order.delivery_method || order.order_type || 'FBS';
    const shortDeliveryMethod = deliveryMethod.split('（')[0].split('(')[0].trim();

    // OZON 原生状态（始终使用）
    const status = statusConfig[posting.status] || statusConfig.pending;

    // 操作状态（用于判断当前所在标签页，控制按钮显示）
    const currentStatus = posting.operation_status || operationStatus;

    // 是否选中
    const isSelected = selectedPostingNumbers.includes(posting.posting_number);

    return (
      <Tooltip title={order.order_notes || null} placement="top">
        <Card
          key={card.key}
          hoverable
          size="small"
          className={styles.orderCard}
          cover={
            <div className={styles.orderCover}>
              {/* 复选框 - 左上角，只在"已分配"及之后的标签显示（用于批量打印） */}
              {posting.status === 'awaiting_deliver' &&
                operationStatus !== 'awaiting_stock' &&
                operationStatus !== 'allocating' && (
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
                    <Tooltip
                      title="打开OZON链接"
                      color="#000"
                      overlayInnerStyle={{ color: '#fff' }}
                    >
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
              <Text type="secondary" className={styles.label}>
                店铺:
              </Text>
              <Tooltip title={shopName}>
                <span className={styles.value}>{shopName}</span>
              </Tooltip>
            </div>

            {/* SKU */}
            {product?.sku && (
              <div className={styles.skuRow}>
                <Text type="secondary" className={styles.label}>
                  SKU:
                </Text>
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
                <Text type="secondary" className={styles.label}>
                  数量:
                </Text>
                <span
                  className={(product.quantity || 1) > 1 ? styles.quantityMultiple : styles.value}
                >
                  {product.quantity || 1}
                </span>
              </div>
            )}

            {/* 单价 */}
            {product && (
              <div className={styles.infoRow}>
                <Text type="secondary" className={styles.label}>
                  单价:
                </Text>
                <span className={styles.price}>
                  {symbol} {formatPrice(product.price || 0)}
                </span>
              </div>
            )}

            {/* 进价 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                进价:
              </Text>
              {isFirstProduct ? (
                purchasePrice && parseFloat(purchasePrice) > 0 ? (
                  <span className={styles.price}>
                    {symbol} {formatPrice(purchasePrice)}
                  </span>
                ) : (
                  <Text type="secondary" className={styles.value}>
                    -
                  </Text>
                )
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 平台 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                平台:
              </Text>
              {isFirstProduct ? (
                <Text className={styles.value}>{sourcePlatform || '-'}</Text>
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 货件 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                货件:
              </Text>
              {isFirstProduct ? (
                <>
                  <a onClick={() => onShowDetail(order, posting)} className={styles.link}>
                    {posting.posting_number}
                  </a>
                  <CopyOutlined
                    className={styles.copyIcon}
                    onClick={() => onCopy(posting.posting_number, '货件编号')}
                  />
                </>
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 追踪 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                追踪:
              </Text>
              {isFirstProduct ? (
                trackingNumber ? (
                  <>
                    <span className={styles.value}>{trackingNumber}</span>
                    <CopyOutlined
                      className={styles.copyIcon}
                      onClick={() => onCopy(trackingNumber, '追踪号码')}
                    />
                  </>
                ) : (
                  <Text type="secondary" className={styles.value}>
                    -
                  </Text>
                )
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 国内 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                国内:
              </Text>
              {isFirstProduct ? (
                domesticTrackingNumbers && domesticTrackingNumbers.length > 0 ? (
                  <div style={{ flex: 1 }}>
                    {domesticTrackingNumbers.map((number, index) => (
                      <div key={index}>
                        <a
                          href={`https://t.17track.net/zh-cn#nums=${number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.link}
                        >
                          {number}
                        </a>
                        <CopyOutlined
                          className={styles.copyIcon}
                          onClick={() => onCopy(number, '国内单号')}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text type="secondary" className={styles.value}>
                    -
                  </Text>
                )
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 配送 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                配送:
              </Text>
              {isFirstProduct ? (
                <Tooltip
                  title={formatDeliveryMethodText(deliveryMethod)}
                  overlayInnerStyle={{ color: '#fff' }}
                >
                  <span className={styles.value}>{shortDeliveryMethod}</span>
                </Tooltip>
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 状态（始终显示 OZON 原生状态） */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                状态:
              </Text>
              {isFirstProduct ? (
                <Tag color={status.color} className={styles.statusTag}>
                  {status.text}
                </Tag>
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 下单 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                下单:
              </Text>
              {isFirstProduct ? (
                <Text className={styles.value}>
                  {order.ordered_at ? formatDateTime(order.ordered_at, 'MM-DD HH:mm') : '-'}
                </Text>
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 截止 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                截止:
              </Text>
              {isFirstProduct ? (
                <span className={styles.deadline}>
                  {posting.shipment_date
                    ? formatDateTime(posting.shipment_date, 'MM-DD HH:mm')
                    : '-'}
                </span>
              ) : (
                <Text type="secondary" className={styles.value}>
                  -
                </Text>
              )}
            </div>

            {/* 操作按钮或主单号链接 */}
            {canOperate && (
              <div className={styles.actionButtons}>
                {isFirstProduct ? (
                  <>
                    {currentStatus === 'awaiting_stock' && (
                      <Space size="small">
                        <Button type="primary" size="small" onClick={() => onPrepareStock(posting)}>
                          备货
                        </Button>
                        <Button
                          type="default"
                          size="small"
                          onClick={() => onDiscardOrder(posting)}
                          danger
                        >
                          废弃
                        </Button>
                      </Space>
                    )}
                    {currentStatus === 'allocating' && (
                      <Space size="small">
                        <Button
                          type="default"
                          size="small"
                          onClick={() => onUpdateBusinessInfo(posting)}
                        >
                          备注
                        </Button>
                        <Button
                          type="default"
                          size="small"
                          onClick={() => onDiscardOrder(posting)}
                          danger
                        >
                          废弃
                        </Button>
                      </Space>
                    )}
                    {currentStatus === 'allocated' && (
                      <Space size="small">
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => onSubmitTracking(posting)}
                        >
                          国内单号
                        </Button>
                        <Button
                          type="default"
                          size="small"
                          onClick={() => onDiscardOrder(posting)}
                          danger
                        >
                          废弃
                        </Button>
                      </Space>
                    )}
                    {currentStatus === 'tracking_confirmed' && (
                      <Space size="small">
                        <Tag color="success">已完成</Tag>
                        <Button
                          type="default"
                          size="small"
                          onClick={() => onDiscardOrder(posting)}
                          danger
                        >
                          废弃
                        </Button>
                      </Space>
                    )}
                    {currentStatus === 'printed' && (
                      <Space size="small">
                        <Tag color="success">已打印</Tag>
                        <Button
                          type="default"
                          size="small"
                          onClick={() => onDiscardOrder(posting)}
                          danger
                        >
                          废弃
                        </Button>
                      </Space>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <Space size="small">
                      <Text type="secondary">单号:</Text>
                      <a onClick={() => onShowDetail(order, posting)} className={styles.link}>
                        {posting.posting_number}
                      </a>
                      <CopyOutlined
                        style={{ cursor: 'pointer', color: '#1890ff' }}
                        onClick={() => onCopy(posting.posting_number, '单号')}
                      />
                    </Space>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </Tooltip>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数 - 只检查真正影响渲染的 props
    const postingNumber = prevProps.card.posting.posting_number;

    // 1. 检查卡片数据本身是否变化
    const cardChanged =
      prevProps.card.key !== nextProps.card.key ||
      prevProps.card.order.order_notes !== nextProps.card.order.order_notes ||
      prevProps.card.posting.source_platform !== nextProps.card.posting.source_platform ||
      prevProps.card.posting.purchase_price !== nextProps.card.posting.purchase_price ||
      prevProps.card.posting.domestic_tracking_numbers !== nextProps.card.posting.domestic_tracking_numbers ||
      prevProps.card.posting.packages !== nextProps.card.posting.packages ||
      prevProps.card.posting.operation_status !== nextProps.card.posting.operation_status;

    // 2. 检查选中状态是否变化（只比较当前卡片的选中状态）
    const prevSelected = prevProps.selectedPostingNumbers.includes(postingNumber);
    const nextSelected = nextProps.selectedPostingNumbers.includes(postingNumber);
    const selectionChanged = prevSelected !== nextSelected;

    // 3. 检查其他稳定 props（通常不变，但需要检查）
    const otherPropsChanged =
      prevProps.operationStatus !== nextProps.operationStatus ||
      prevProps.canOperate !== nextProps.canOperate ||
      prevProps.userCurrency !== nextProps.userCurrency;

    // 如果任何相关 props 变化，返回 false 以触发重新渲染
    return !cardChanged && !selectionChanged && !otherPropsChanged;
  }
);

OrderCardComponent.displayName = 'OrderCardComponent';

export default OrderCardComponent;
