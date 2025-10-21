/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * 订单详情弹窗组件 - 供 OrderList 和 PackingShipment 共用
 */
import React, { useState } from 'react';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { Modal, Tabs, Descriptions, Table, Avatar, Card, Tag, Typography, Button, InputNumber, message, Space } from 'antd';
import { ShoppingCartOutlined, EditOutlined, SaveOutlined, CloseOutlined, SyncOutlined } from '@ant-design/icons';
import moment from 'moment';
import * as ozonApi from '@/services/ozonApi';
import { formatPriceWithFallback } from '@/utils/currency';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
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
  onUpdate?: () => void; // 添加更新回调
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
  onUpdate,
}) => {
  // 编辑状态管理
  const [isEditingPurchasePrice, setIsEditingPurchasePrice] = useState(false);
  const [isEditingMaterialCost, setIsEditingMaterialCost] = useState(false);
  const [editPurchasePrice, setEditPurchasePrice] = useState<string>('');
  const [editMaterialCost, setEditMaterialCost] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // 同步状态管理
  const [syncingMaterialCost, setSyncingMaterialCost] = useState(false);
  const [syncingFinance, setSyncingFinance] = useState(false);

  // 保存进货金额
  const handleSavePurchasePrice = async () => {
    if (!selectedPosting?.posting_number) return;

    try {
      setSaving(true);
      await ozonApi.updatePostingBusinessInfo(selectedPosting.posting_number, {
        purchase_price: editPurchasePrice,
      });
      message.success('进货金额已更新');
      setIsEditingPurchasePrice(false);
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 保存打包费用
  const handleSaveMaterialCost = async () => {
    if (!selectedPosting?.posting_number) return;

    try {
      setSaving(true);
      await ozonApi.updatePostingBusinessInfo(selectedPosting.posting_number, {
        material_cost: editMaterialCost,
      });
      message.success('打包费用已更新');
      setIsEditingMaterialCost(false);
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 同步打包费用
  const handleSyncMaterialCost = async () => {
    if (!selectedPosting?.posting_number) return;

    try {
      setSyncingMaterialCost(true);
      await ozonApi.syncMaterialCost(selectedPosting.posting_number);
      message.success('打包费用同步成功');
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '同步失败');
    } finally {
      setSyncingMaterialCost(false);
    }
  };

  // 同步财务费用
  const handleSyncFinance = async () => {
    if (!selectedPosting?.posting_number) return;

    try {
      setSyncingFinance(true);
      await ozonApi.syncFinance(selectedPosting.posting_number);
      message.success('财务费用同步成功');
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '同步失败');
    } finally {
      setSyncingFinance(false);
    }
  };

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
                    {selectedPosting?.domestic_tracking_numbers && selectedPosting.domestic_tracking_numbers.length > 0 ? (
                      <div>
                        {selectedPosting.domestic_tracking_numbers.map((number, index) => (
                          <div key={index}>{number}</div>
                        ))}
                      </div>
                    ) : (
                      '-'
                    )}
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
                        const rawImageUrl = record.image || (record.offer_id && offerIdImageMap[record.offer_id] ? offerIdImageMap[record.offer_id] : undefined);
                        const imageUrl = optimizeOzonImageUrl(rawImageUrl, 60);
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
                      {posting.domestic_tracking_numbers && posting.domestic_tracking_numbers.length > 0 ? (
                        <div>
                          {posting.domestic_tracking_numbers.map((number, index) => (
                            <div key={index}>{number}</div>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
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
                      {isDelivered && isEditingPurchasePrice ? (
                        <Space>
                          <InputNumber
                            value={editPurchasePrice ? parseFloat(editPurchasePrice) : undefined}
                            onChange={(value) => setEditPurchasePrice(value?.toString() || '')}
                            placeholder="请输入进货金额"
                            min={0}
                            formatter={getNumberFormatter(2)}
                            parser={getNumberParser()}
                            style={{ width: 150 }}
                            controls={false}
                          />
                          <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            loading={saving}
                            onClick={handleSavePurchasePrice}
                          >
                            保存
                          </Button>
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => setIsEditingPurchasePrice(false)}
                          >
                            取消
                          </Button>
                        </Space>
                      ) : (
                        <Space>
                          <Text>
                            {selectedPosting?.purchase_price
                              ? formatPriceWithFallback(
                                  selectedPosting.purchase_price,
                                  selectedOrder.currency_code,
                                  userCurrency
                                )
                              : '-'}
                          </Text>
                          {isDelivered && (
                            <Button
                              type="link"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => {
                                setEditPurchasePrice(selectedPosting?.purchase_price || '');
                                setIsEditingPurchasePrice(true);
                              }}
                            >
                              编辑
                            </Button>
                          )}
                        </Space>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Ozon佣金">
                      <Space>
                        <Text>
                          {selectedPosting?.ozon_commission_cny
                            ? formatPriceWithFallback(
                                selectedPosting.ozon_commission_cny,
                                selectedOrder.currency_code,
                                userCurrency
                              )
                            : '-'}
                        </Text>
                        {isDelivered && (
                          <Button
                            type="link"
                            size="small"
                            icon={<SyncOutlined spin={syncingFinance} />}
                            loading={syncingFinance}
                            onClick={handleSyncFinance}
                          >
                            同步
                          </Button>
                        )}
                      </Space>
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
                      {isDelivered && isEditingMaterialCost ? (
                        <Space>
                          <InputNumber
                            value={editMaterialCost ? parseFloat(editMaterialCost) : undefined}
                            onChange={(value) => setEditMaterialCost(value?.toString() || '')}
                            placeholder="请输入打包费用"
                            min={0}
                            formatter={getNumberFormatter(2)}
                            parser={getNumberParser()}
                            style={{ width: 150 }}
                            controls={false}
                          />
                          <Button
                            type="primary"
                            size="small"
                            icon={<SaveOutlined />}
                            loading={saving}
                            onClick={handleSaveMaterialCost}
                          >
                            保存
                          </Button>
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => setIsEditingMaterialCost(false)}
                          >
                            取消
                          </Button>
                        </Space>
                      ) : (
                        <Space>
                          <Text>
                            {selectedPosting?.material_cost
                              ? formatPriceWithFallback(
                                  selectedPosting.material_cost,
                                  selectedOrder.currency_code,
                                  userCurrency
                                )
                              : '-'}
                          </Text>
                          {isDelivered && (
                            <>
                              <Button
                                type="link"
                                size="small"
                                icon={<SyncOutlined spin={syncingMaterialCost} />}
                                loading={syncingMaterialCost}
                                onClick={handleSyncMaterialCost}
                              >
                                同步
                              </Button>
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditMaterialCost(selectedPosting?.material_cost || '');
                                  setIsEditingMaterialCost(true);
                                }}
                              >
                                编辑
                              </Button>
                            </>
                          )}
                        </Space>
                      )}
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
