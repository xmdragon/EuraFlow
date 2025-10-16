/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * 订单详情弹窗组件 - 供 OrderList 和 PackingShipment 共用
 */
import React from 'react';
import { Modal, Tabs, Descriptions, Table, Avatar, Card, Tag, Typography } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import moment from 'moment';
import * as ozonApi from '@/services/ozonApi';
import { formatPriceWithFallback } from '@/utils/currency';
import styles from '@/pages/ozon/OrderList.module.scss';

const { Text } = Typography;

interface OrderDetailModalProps {
  visible: boolean;
  onCancel: () => void;
  selectedOrder: ozonApi.Order | null;
  selectedPosting: ozonApi.Posting | null;
  statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }>;
  userCurrency: string;
  offerIdImageMap: Record<string, string>;
  formatDeliveryMethodTextWhite: (text: string | undefined) => React.ReactNode;
}

const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  visible,
  onCancel,
  selectedOrder,
  selectedPosting,
  statusConfig,
  userCurrency,
  offerIdImageMap,
  formatDeliveryMethodTextWhite,
}) => {
  return (
    <Modal
      title={`订单详情 - ${selectedPosting?.posting_number || selectedOrder?.order_id}`}
      open={visible}
      onCancel={onCancel}
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
                <Descriptions bordered column={2} labelStyle={{ width: '120px' }}>
                  <Descriptions.Item label="Ozon订单号">
                    {selectedOrder.ozon_order_id || selectedOrder.order_id}
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={statusConfig[selectedPosting?.status || selectedOrder.status]?.color}>
                      {statusConfig[selectedPosting?.status || selectedOrder.status]?.text}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="总金额">
                    {formatPriceWithFallback(
                      selectedOrder.total_price || selectedOrder.total_amount,
                      selectedOrder.currency_code,
                      userCurrency
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="进货价格">
                    {selectedOrder.purchase_price
                      ? formatPriceWithFallback(
                          selectedOrder.purchase_price,
                          selectedOrder.currency_code,
                          userCurrency
                        )
                      : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="国内单号">
                    {selectedOrder.domestic_tracking_number || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="国际单号">
                    {selectedPosting?.posting_number || selectedOrder.posting_number || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="下单时间">
                    {selectedOrder.ordered_at ? moment(selectedOrder.ordered_at).format('YYYY-MM-DD HH:mm:ss') :
                     (selectedOrder.created_at ? moment(selectedOrder.created_at).format('YYYY-MM-DD HH:mm:ss') : '-')}
                  </Descriptions.Item>
                  <Descriptions.Item label="发货截止">
                    {selectedPosting?.shipment_date ? moment(selectedPosting.shipment_date).format('YYYY-MM-DD HH:mm:ss') : '-'}
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
              label: '物流信息',
              key: '3',
              children: selectedOrder.postings?.map((posting) => (
                <Card key={posting.id} className={styles.postingCard}>
                  <Descriptions bordered size="small" column={1} labelStyle={{ width: '120px' }}>
                    <Descriptions.Item label="Posting号">
                      {posting.posting_number}
                    </Descriptions.Item>
                    <Descriptions.Item label="状态">
                      {statusConfig[posting.status]?.text || posting.status}
                    </Descriptions.Item>
                    <Descriptions.Item label="仓库">{posting.warehouse_name || '-'}</Descriptions.Item>
                    <Descriptions.Item label="订单类型">
                      {selectedOrder.order_type || 'FBS'}
                    </Descriptions.Item>
                    <Descriptions.Item label="配送方式">
                      {formatDeliveryMethodTextWhite(posting.delivery_method_name)}
                    </Descriptions.Item>
                    <Descriptions.Item label="国内单号">
                      {posting.domestic_tracking_number || selectedOrder.domestic_tracking_number || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="国际单号">
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
                  </Descriptions>
                </Card>
              )),
            },
            {
              label: '额外信息',
              key: '4',
              children: (
                <Descriptions bordered column={1} labelStyle={{ width: '120px' }}>
                  <Descriptions.Item label="采购平台">
                    {selectedPosting?.source_platform || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="订单备注">
                    {selectedOrder.order_notes || '-'}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              label: '财务信息',
              key: '5',
              children: (() => {
                // 检查订单状态是否为"已签收"
                const isDelivered = selectedPosting?.status === 'delivered';

                // 计算订单金额（商品总价）
                const orderAmount = parseFloat(selectedOrder.total_price || selectedOrder.total_amount || '0');

                // 获取各项费用
                const purchasePrice = parseFloat(selectedPosting?.purchase_price || '0');
                const ozonCommission = parseFloat(selectedPosting?.ozon_commission_cny || '0');
                const internationalLogistics = parseFloat(selectedPosting?.international_logistics_fee_cny || '0');
                const lastMileDelivery = parseFloat(selectedPosting?.last_mile_delivery_fee_cny || '0');
                const packingFee = parseFloat(selectedPosting?.material_cost || '0');

                // 只有在已签收状态下且有进货金额和Ozon佣金时才计算利润
                const shouldCalculateProfit = isDelivered && purchasePrice > 0 && ozonCommission > 0;

                const profitAmount = shouldCalculateProfit
                  ? orderAmount - (purchasePrice + ozonCommission + internationalLogistics + lastMileDelivery + packingFee)
                  : null;

                // 计算利润比率 = (利润金额 / 订单金额) * 100，保留2位小数
                const profitRate = (shouldCalculateProfit && orderAmount > 0 && profitAmount !== null)
                  ? ((profitAmount / orderAmount) * 100).toFixed(2)
                  : null;

                return (
                  <Descriptions bordered column={1} labelStyle={{ width: '120px' }}>
                    <Descriptions.Item label="订单金额">
                      {formatPriceWithFallback(
                        selectedOrder.total_price || selectedOrder.total_amount,
                        selectedOrder.currency_code,
                        userCurrency
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="进货金额">
                      {selectedPosting?.purchase_price
                        ? formatPriceWithFallback(
                            selectedPosting.purchase_price,
                            selectedOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Ozon佣金">
                      {selectedPosting?.ozon_commission_cny
                        ? formatPriceWithFallback(
                            selectedPosting.ozon_commission_cny,
                            selectedOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="国际物流">
                      {selectedPosting?.international_logistics_fee_cny
                        ? formatPriceWithFallback(
                            selectedPosting.international_logistics_fee_cny,
                            selectedOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="尾程派送">
                      {selectedPosting?.last_mile_delivery_fee_cny
                        ? formatPriceWithFallback(
                            selectedPosting.last_mile_delivery_fee_cny,
                            selectedOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="打包费用">
                      {selectedPosting?.material_cost
                        ? formatPriceWithFallback(
                            selectedPosting.material_cost,
                            selectedOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="利润金额">
                      {profitAmount !== null ? (
                        <Text strong style={{ color: profitAmount >= 0 ? '#52c41a' : '#ff4d4f' }}>
                          {formatPriceWithFallback(
                            profitAmount.toString(),
                            selectedOrder.currency_code,
                            userCurrency
                          )}
                        </Text>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="利润比率">
                      {profitRate !== null ? (
                        <Text strong style={{ color: parseFloat(profitRate) >= 0 ? '#52c41a' : '#ff4d4f' }}>
                          {profitRate}%
                        </Text>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                );
              })(),
            },
          ]}
        />
      )}
    </Modal>
  );
};

export default OrderDetailModal;
