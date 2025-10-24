/* eslint-disable no-unused-vars */
/**
 * 打包发货订单卡片组件
 */
import { ShoppingCartOutlined, LinkOutlined, CopyOutlined } from '@ant-design/icons';
import { Card, Checkbox, Avatar, Tooltip, Tag, Button, Space, Typography } from 'antd';
import moment from 'moment';
import React from 'react';

import styles from '../../../pages/ozon/PackingShipment.module.scss';

import * as ozonApi from '@/services/ozonApi';
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
  operationStatus: string;
  formatPrice: (_priceValue: any) => string;
  formatDeliveryMethodText: (_deliveryMethod: string | undefined) => React.ReactNode;
  onCopy: (_textToCopy: string | undefined, _copyLabel: string) => void;
  onShowDetail: (_orderData: ozonApi.Order, _postingData: ozonApi.Posting) => void;
  onOpenImagePreview: (_imageUrl: string) => void;
  onOpenPriceHistory: (_productSku: string, _productTitle: string) => void;
  onPrepareStock: (_postingData: ozonApi.PostingWithOrder) => void;
  onUpdateBusinessInfo: (_postingData: ozonApi.PostingWithOrder) => void;
  onSubmitTracking: (_postingData: ozonApi.PostingWithOrder) => void;
  onDiscardOrder: (_posting: string) => void;
  onCheckboxChange: (_posting: string, _isChecked: boolean) => void;
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
                <Text
                  className={(product.quantity || 1) > 1 ? styles.quantityHighlight : styles.value}
                >
                  X {product.quantity || 1}
                </Text>
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
              {purchasePrice && parseFloat(purchasePrice) > 0 ? (
                <span className={styles.price}>
                  {symbol} {formatPrice(purchasePrice)}
                </span>
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
              <Text className={styles.value}>{sourcePlatform || '-'}</Text>
            </div>

            {/* 货件 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                货件:
              </Text>
              <a onClick={() => onShowDetail(order, posting)} className={styles.link}>
                {posting.posting_number}
              </a>
              <CopyOutlined
                className={styles.copyIcon}
                onClick={() => onCopy(posting.posting_number, '货件编号')}
              />
            </div>

            {/* 追踪 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                追踪:
              </Text>
              {trackingNumber ? (
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
              )}
            </div>

            {/* 国内 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                国内:
              </Text>
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
              <Tooltip
                title={formatDeliveryMethodText(deliveryMethod)}
                overlayInnerStyle={{ color: '#fff' }}
              >
                <span className={styles.value}>{shortDeliveryMethod}</span>
              </Tooltip>
            </div>

            {/* 状态（始终显示 OZON 原生状态） */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                状态:
              </Text>
              <Tag color={status.color} className={styles.statusTag}>
                {status.text}
              </Tag>
            </div>

            {/* 下单 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                下单:
              </Text>
              <Text className={styles.value}>
                {order.ordered_at ? moment(order.ordered_at).format('MM-DD HH:mm') : '-'}
              </Text>
            </div>

            {/* 截止 */}
            <div className={styles.infoRow}>
              <Text type="secondary" className={styles.label}>
                截止:
              </Text>
              <span className={styles.deadline}>
                {posting.shipment_date ? moment(posting.shipment_date).format('MM-DD HH:mm') : '-'}
              </span>
            </div>

            {/* 操作按钮 */}
            {canOperate && (
              <div className={styles.actionButtons}>
                {currentStatus === 'awaiting_stock' && (
                  <Space size="small">
                    <Button type="primary" size="small" onClick={() => onPrepareStock(posting)}>
                      备货
                    </Button>
                    <Button
                      type="default"
                      size="small"
                      onClick={() => onDiscardOrder(posting.posting_number)}
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
                      onClick={() => onDiscardOrder(posting.posting_number)}
                      danger
                    >
                      废弃
                    </Button>
                  </Space>
                )}
                {currentStatus === 'allocated' && (
                  <Space size="small">
                    <Button type="primary" size="small" onClick={() => onSubmitTracking(posting)}>
                      国内单号
                    </Button>
                    <Button
                      type="default"
                      size="small"
                      onClick={() => onDiscardOrder(posting.posting_number)}
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
                      onClick={() => onDiscardOrder(posting.posting_number)}
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
                      onClick={() => onDiscardOrder(posting.posting_number)}
                      danger
                    >
                      废弃
                    </Button>
                  </Space>
                )}
              </div>
            )}
          </div>
        </Card>
      </Tooltip>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数 - 检查所有关键 props 变化
    // 添加 order.order_notes 的检查以支持 tooltip 更新
    const cardChanged =
      prevProps.card.key !== nextProps.card.key ||
      prevProps.card.order.order_notes !== nextProps.card.order.order_notes ||
      prevProps.card.posting.source_platform !== nextProps.card.posting.source_platform ||
      prevProps.card.posting.purchase_price !== nextProps.card.posting.purchase_price;

    const otherPropsChanged =
      prevProps.selectedPostingNumbers !== nextProps.selectedPostingNumbers ||
      prevProps.offerIdImageMap !== nextProps.offerIdImageMap ||
      prevProps.shopNameMap !== nextProps.shopNameMap;

    // 如果任何相关 props 变化，返回 false 以触发重新渲染
    return !cardChanged && !otherPropsChanged;
  }
);

OrderCardComponent.displayName = 'OrderCardComponent';

export default OrderCardComponent;
