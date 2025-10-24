/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * 订单详情弹窗组件 - 供 OrderList 和 PackingShipment 共用
 */
import {
  ShoppingCartOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  SyncOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import {
  Modal,
  Tabs,
  Descriptions,
  Table,
  Avatar,
  Card,
  Tag,
  Typography,
  Button,
  InputNumber,
  Space,
  Select,
  Input,
} from 'antd';
import moment from 'moment';
import React, { useState } from 'react';

import { usePermission } from '@/hooks/usePermission';
import styles from '@/pages/ozon/OrderList.module.scss';
import * as ozonApi from '@/services/ozonApi';
import { formatPriceWithFallback } from '@/utils/currency';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

const { Text } = Typography;
const { TextArea } = Input;

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
  // 权限检查
  const { canOperate, canSync } = usePermission();

  // 本地状态存储订单和posting数据，用于立即更新显示
  const [localOrder, setLocalOrder] = useState(selectedOrder);
  const [localPosting, setLocalPosting] = useState(selectedPosting);

  // 当props变化时更新本地状态
  React.useEffect(() => {
    setLocalOrder(selectedOrder);
    setLocalPosting(selectedPosting);
  }, [selectedOrder, selectedPosting]);

  // 可编辑状态判断：从"分配中"状态开始允许编辑
  const canEdit =
    localPosting?.operation_status &&
    ['allocating', 'allocated', 'tracking_confirmed', 'printed'].includes(
      localPosting.operation_status
    );

  // 编辑状态管理
  const [isEditingPurchasePrice, setIsEditingPurchasePrice] = useState(false);
  const [isEditingMaterialCost, setIsEditingMaterialCost] = useState(false);
  const [isEditingSourcePlatform, setIsEditingSourcePlatform] = useState(false);
  const [isEditingOrderNotes, setIsEditingOrderNotes] = useState(false);
  const [editPurchasePrice, setEditPurchasePrice] = useState<string>('');
  const [editMaterialCost, setEditMaterialCost] = useState<string>('');
  const [editSourcePlatform, setEditSourcePlatform] = useState<string>('');
  const [editOrderNotes, setEditOrderNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // 同步状态管理
  const [syncingMaterialCost, setSyncingMaterialCost] = useState(false);
  const [syncingFinance, setSyncingFinance] = useState(false);

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

  // 保存进货金额
  const handleSavePurchasePrice = async () => {
    if (!localPosting?.posting_number) return;

    try {
      setSaving(true);
      await ozonApi.updatePostingBusinessInfo(localPosting.posting_number, {
        purchase_price: editPurchasePrice,
      });
      notifySuccess('更新成功', '进货金额已更新');
      setIsEditingPurchasePrice(false);
      // 立即更新本地显示
      setLocalPosting({ ...localPosting, purchase_price: editPurchasePrice });
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('更新失败', error?.response?.data?.detail || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 保存打包费用
  const handleSaveMaterialCost = async () => {
    if (!localPosting?.posting_number) return;

    try {
      setSaving(true);
      await ozonApi.updatePostingBusinessInfo(localPosting.posting_number, {
        material_cost: editMaterialCost,
      });
      notifySuccess('更新成功', '打包费用已更新');
      setIsEditingMaterialCost(false);
      // 立即更新本地显示
      setLocalPosting({ ...localPosting, material_cost: editMaterialCost });
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('更新失败', error?.response?.data?.detail || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 同步打包费用
  const handleSyncMaterialCost = async () => {
    if (!localPosting?.posting_number) return;

    try {
      setSyncingMaterialCost(true);
      await ozonApi.syncMaterialCost(localPosting.posting_number);
      notifySuccess('同步成功', '打包费用同步成功');
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('同步失败', error?.response?.data?.detail || '同步失败');
    } finally {
      setSyncingMaterialCost(false);
    }
  };

  // 同步财务费用
  const handleSyncFinance = async () => {
    if (!localPosting?.posting_number) return;

    try {
      setSyncingFinance(true);
      await ozonApi.syncFinance(localPosting.posting_number);
      notifySuccess('同步成功', '财务费用同步成功');
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('同步失败', error?.response?.data?.detail || '同步失败');
    } finally {
      setSyncingFinance(false);
    }
  };

  // 保存采购平台
  const handleSaveSourcePlatform = async () => {
    if (!localPosting?.posting_number) return;

    try {
      setSaving(true);
      await ozonApi.updatePostingBusinessInfo(localPosting.posting_number, {
        source_platform: editSourcePlatform,
      });
      notifySuccess('更新成功', '采购平台已更新');
      setIsEditingSourcePlatform(false);
      // 立即更新本地显示
      setLocalPosting({ ...localPosting, source_platform: editSourcePlatform });
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('更新失败', error?.response?.data?.detail || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 保存订单备注
  const handleSaveOrderNotes = async () => {
    if (!localPosting?.posting_number) return;

    try {
      setSaving(true);
      await ozonApi.updatePostingBusinessInfo(localPosting.posting_number, {
        order_notes: editOrderNotes,
      });
      notifySuccess('更新成功', '订单备注已更新');
      setIsEditingOrderNotes(false);
      // 立即更新本地显示
      if (localOrder) {
        setLocalOrder({ ...localOrder, order_notes: editOrderNotes });
      }
      onUpdate?.(); // 触发父组件刷新
    } catch (error: any) {
      // 如果是403权限错误，不显示自定义错误，让axios拦截器统一处理
      if (error.response?.status === 403) {
        return;
      }
      notifyError('更新失败', error?.response?.data?.detail || '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 订单备注区域渲染函数
  const renderOrderNotesSection = () => (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
      <div style={{ marginBottom: 8 }}>
        <Text strong>订单备注</Text>
      </div>
      {canEdit && isEditingOrderNotes && canOperate ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <TextArea
            value={editOrderNotes}
            onChange={(e) => setEditOrderNotes(e.target.value)}
            placeholder="请输入订单备注"
            rows={3}
            maxLength={500}
            showCount
          />
          <Space>
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSaveOrderNotes}
            >
              保存
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setIsEditingOrderNotes(false)}
            >
              取消
            </Button>
          </Space>
        </Space>
      ) : (
        <Space>
          <Text>{localOrder?.order_notes || '-'}</Text>
          {canEdit && canOperate && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditOrderNotes(localOrder?.order_notes || '');
                setIsEditingOrderNotes(true);
              }}
            >
              编辑
            </Button>
          )}
        </Space>
      )}
    </div>
  );

  return (
    <Modal
      title={`订单详情 - ${localPosting?.posting_number || localOrder?.order_id}`}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={900}
    >
      {localOrder && (
        <Tabs
          defaultActiveKey="1"
          items={[
            {
              label: '基本信息',
              key: '1',
              children: (
                <>
                  <Descriptions bordered column={2} labelStyle={{ width: '120px' }}>
                    <Descriptions.Item label="Ozon订单号">
                      {localOrder.ozon_order_id || localOrder.order_id}
                    </Descriptions.Item>
                    <Descriptions.Item label="状态">
                      <Tag color={statusConfig[localPosting?.status || localOrder.status]?.color}>
                        {statusConfig[localPosting?.status || localOrder.status]?.text}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="总金额">
                      {formatPriceWithFallback(
                        localOrder.total_price || localOrder.total_amount,
                        localOrder.currency_code,
                        userCurrency
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="进货价格">
                      {localOrder.purchase_price
                        ? formatPriceWithFallback(
                            localOrder.purchase_price,
                            localOrder.currency_code,
                            userCurrency
                          )
                        : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="国内单号">
                      {localPosting?.domestic_tracking_numbers &&
                      localPosting.domestic_tracking_numbers.length > 0 ? (
                        <div>
                          {localPosting.domestic_tracking_numbers.map((number, index) => (
                            <div
                              key={index}
                              style={{
                                marginBottom:
                                  index < localPosting.domestic_tracking_numbers.length - 1
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
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="国际单号">
                      {localPosting?.posting_number || localOrder.posting_number || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="下单时间">
                      {localOrder.ordered_at
                        ? moment(localOrder.ordered_at).format('YYYY-MM-DD HH:mm:ss')
                        : localOrder.created_at
                          ? moment(localOrder.created_at).format('YYYY-MM-DD HH:mm:ss')
                          : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="发货截止">
                      {localPosting?.shipment_date
                        ? moment(localPosting.shipment_date).format('YYYY-MM-DD HH:mm:ss')
                        : '-'}
                    </Descriptions.Item>
                  </Descriptions>
                  {renderOrderNotesSection()}
                </>
              ),
            },
            {
              label: '商品明细',
              key: '2',
              children: (
                <>
                  <Table
                    dataSource={localOrder.items}
                    rowKey="sku"
                    pagination={false}
                    columns={[
                      {
                        title: '图片',
                        dataIndex: 'sku',
                        key: 'image',
                        width: 80,
                        render: (sku, record) => {
                          const rawImageUrl =
                            record.image ||
                            (record.offer_id && offerIdImageMap[record.offer_id]
                              ? offerIdImageMap[record.offer_id]
                              : undefined);
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
                      {
                        title: 'SKU',
                        dataIndex: 'sku',
                        key: 'sku',
                        width: 120,
                      },
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
                        },
                      },
                      {
                        title: '数量',
                        dataIndex: 'quantity',
                        key: 'quantity',
                        width: 80,
                      },
                      {
                        title: '单价',
                        dataIndex: 'price',
                        key: 'price',
                        width: 100,
                        render: (price) =>
                          formatPriceWithFallback(price, localOrder?.currency_code, userCurrency),
                      },
                      {
                        title: '小计',
                        dataIndex: 'total_amount',
                        key: 'total_amount',
                        width: 100,
                        render: (amount) =>
                          formatPriceWithFallback(amount, localOrder?.currency_code, userCurrency),
                      },
                    ]}
                  />
                  {renderOrderNotesSection()}
                </>
              ),
            },
            {
              label: '物流信息',
              key: '3',
              children: (
                <>
                  {localOrder.postings?.map((posting) => (
                    <Card key={posting.id} className={styles.postingCard}>
                      <Descriptions
                        bordered
                        size="small"
                        column={1}
                        labelStyle={{ width: '120px' }}
                      >
                        <Descriptions.Item label="Posting号">
                          {posting.posting_number}
                        </Descriptions.Item>
                        <Descriptions.Item label="状态">
                          {statusConfig[posting.status]?.text || posting.status}
                        </Descriptions.Item>
                        <Descriptions.Item label="仓库">
                          {posting.warehouse_name || '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="订单类型">
                          {localOrder.order_type || 'FBS'}
                        </Descriptions.Item>
                        <Descriptions.Item label="配送方式">
                          {formatDeliveryMethodTextWhite(posting.delivery_method_name)}
                        </Descriptions.Item>
                        <Descriptions.Item label="国内单号">
                          {posting.domestic_tracking_numbers &&
                          posting.domestic_tracking_numbers.length > 0 ? (
                            <div>
                              {posting.domestic_tracking_numbers.map((number, index) => (
                                <div
                                  key={index}
                                  style={{
                                    marginBottom:
                                      index < posting.domestic_tracking_numbers.length - 1
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
                                  {pkg.carrier_name && (
                                    <Text type="secondary"> ({pkg.carrier_name})</Text>
                                  )}
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
                  ))}
                  {renderOrderNotesSection()}
                </>
              ),
            },
            {
              label: '财务信息',
              key: '5',
              children: (() => {
                // 检查订单状态是否为"已签收"
                const isDelivered = localPosting?.status === 'delivered';

                // 计算订单金额（商品总价）
                const orderAmount = parseFloat(
                  localOrder.total_price || localOrder.total_amount || '0'
                );

                // 获取各项费用
                const purchasePrice = parseFloat(localPosting?.purchase_price || '0');
                const ozonCommission = parseFloat(localPosting?.ozon_commission_cny || '0');
                const internationalLogistics = parseFloat(
                  localPosting?.international_logistics_fee_cny || '0'
                );
                const lastMileDelivery = parseFloat(
                  localPosting?.last_mile_delivery_fee_cny || '0'
                );
                const packingFee = parseFloat(localPosting?.material_cost || '0');

                // 只有在已签收状态下且有进货金额和Ozon佣金时才计算利润
                const shouldCalculateProfit =
                  isDelivered && purchasePrice > 0 && ozonCommission > 0;

                const profitAmount = shouldCalculateProfit
                  ? orderAmount -
                    (purchasePrice +
                      ozonCommission +
                      internationalLogistics +
                      lastMileDelivery +
                      packingFee)
                  : null;

                // 计算利润比率 = (利润金额 / 订单金额) * 100，保留2位小数
                const profitRate =
                  shouldCalculateProfit && orderAmount > 0 && profitAmount !== null
                    ? ((profitAmount / orderAmount) * 100).toFixed(2)
                    : null;

                return (
                  <>
                    <Descriptions bordered column={1} labelStyle={{ width: '120px' }}>
                      <Descriptions.Item label="订单金额">
                        {formatPriceWithFallback(
                          localOrder.total_price || localOrder.total_amount,
                          localOrder.currency_code,
                          userCurrency
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="进货金额">
                        {canEdit && isEditingPurchasePrice && canOperate ? (
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
                              {localPosting?.purchase_price
                                ? formatPriceWithFallback(
                                    localPosting.purchase_price,
                                    localOrder.currency_code,
                                    userCurrency
                                  )
                                : '-'}
                            </Text>
                            {canEdit && canOperate && (
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditPurchasePrice(localPosting?.purchase_price || '');
                                  setIsEditingPurchasePrice(true);
                                }}
                              >
                                编辑
                              </Button>
                            )}
                          </Space>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="采购平台">
                        {canEdit && isEditingSourcePlatform && canOperate ? (
                          <Space>
                            <Select
                              value={editSourcePlatform}
                              onChange={(value) => setEditSourcePlatform(value)}
                              placeholder="请选择采购平台"
                              style={{ width: 150 }}
                              options={[
                                { label: '1688', value: '1688' },
                                { label: '拼多多', value: '拼多多' },
                                { label: '咸鱼', value: '咸鱼' },
                                { label: '淘宝', value: '淘宝' },
                              ]}
                            />
                            <Button
                              type="primary"
                              size="small"
                              icon={<SaveOutlined />}
                              loading={saving}
                              onClick={handleSaveSourcePlatform}
                            >
                              保存
                            </Button>
                            <Button
                              size="small"
                              icon={<CloseOutlined />}
                              onClick={() => setIsEditingSourcePlatform(false)}
                            >
                              取消
                            </Button>
                          </Space>
                        ) : (
                          <Space>
                            <Text>{localPosting?.source_platform || '-'}</Text>
                            {canEdit && canOperate && (
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditSourcePlatform(localPosting?.source_platform || '');
                                  setIsEditingSourcePlatform(true);
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
                            {localPosting?.ozon_commission_cny
                              ? formatPriceWithFallback(
                                  localPosting.ozon_commission_cny,
                                  localOrder.currency_code,
                                  userCurrency
                                )
                              : '-'}
                          </Text>
                          {isDelivered && canSync && (
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
                        {localPosting?.international_logistics_fee_cny
                          ? formatPriceWithFallback(
                              localPosting.international_logistics_fee_cny,
                              localOrder.currency_code,
                              userCurrency
                            )
                          : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="尾程派送">
                        {localPosting?.last_mile_delivery_fee_cny
                          ? formatPriceWithFallback(
                              localPosting.last_mile_delivery_fee_cny,
                              localOrder.currency_code,
                              userCurrency
                            )
                          : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="打包费用">
                        {isDelivered && isEditingMaterialCost && canOperate ? (
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
                              {localPosting?.material_cost
                                ? formatPriceWithFallback(
                                    localPosting.material_cost,
                                    localOrder.currency_code,
                                    userCurrency
                                  )
                                : '-'}
                            </Text>
                            {isDelivered && canSync && (
                              <Button
                                type="link"
                                size="small"
                                icon={<SyncOutlined spin={syncingMaterialCost} />}
                                loading={syncingMaterialCost}
                                onClick={handleSyncMaterialCost}
                              >
                                同步
                              </Button>
                            )}
                            {isDelivered && canOperate && (
                              <Button
                                type="link"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  setEditMaterialCost(localPosting?.material_cost || '');
                                  setIsEditingMaterialCost(true);
                                }}
                              >
                                编辑
                              </Button>
                            )}
                          </Space>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="利润金额">
                        {profitAmount !== null ? (
                          <Text
                            strong
                            style={{
                              color: profitAmount >= 0 ? '#52c41a' : '#ff4d4f',
                            }}
                          >
                            {formatPriceWithFallback(
                              profitAmount.toString(),
                              localOrder.currency_code,
                              userCurrency
                            )}
                          </Text>
                        ) : (
                          '-'
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="利润比率">
                        {profitRate !== null ? (
                          <Text
                            strong
                            style={{
                              color: parseFloat(profitRate) >= 0 ? '#52c41a' : '#ff4d4f',
                            }}
                          >
                            {profitRate}%
                          </Text>
                        ) : (
                          '-'
                        )}
                      </Descriptions.Item>
                    </Descriptions>
                    {renderOrderNotesSection()}
                  </>
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
