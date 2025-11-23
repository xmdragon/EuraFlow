/**
 * 备货弹窗组件（表格形式）
 * 每个商品一行，独立填写库存、价格、平台、备注
 * 提交时汇总：价格相加，平台合并，备注合并
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Table,
  InputNumber,
  Select,
  Input,
  Checkbox,
  Spin,
  Typography,
  Space,
  Form,
} from 'antd';
import axios from 'axios';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { useCurrency } from '@/hooks/useCurrency';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;
const { TextArea } = Input;

interface PrepareStockModalProps {
  visible: boolean;
  onCancel: () => void;
  postingNumber: string;
  posting?: ozonApi.Posting;
  onSuccess?: () => void;
}

// 商品备货数据
interface ItemPrepareData {
  sku: string;
  productTitle: string;
  productImage: string | null;
  stockAvailable: number;
  orderQuantity: number;
  useStock: boolean; // 是否使用库存
  purchasePrice: number; // 进货价格
  sourcePlatform: string[]; // 采购平台
  notes: string; // 备注
}

const PrepareStockModal: React.FC<PrepareStockModalProps> = ({
  visible,
  onCancel,
  postingNumber,
  posting,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { symbol: currencySymbol } = useCurrency();

  // 商品备货数据
  const [itemsData, setItemsData] = useState<ItemPrepareData[]>([]);

  // 查询订单商品的库存情况
  const { data: stockCheckData, isLoading: stockLoading, refetch: refetchStock } = useQuery({
    queryKey: ['stockCheck', postingNumber],
    queryFn: () => ozonApi.checkStockForPosting(postingNumber),
    enabled: visible,
    staleTime: 30000,
  });

  // 同步订单 Mutation
  const syncOrderMutation = useMutation({
    mutationFn: () => {
      if (!posting?.shop_id) {
        throw new Error('缺少店铺ID');
      }
      return ozonApi.syncSingleOrder(postingNumber, posting.shop_id);
    },
    onSuccess: () => {
      notifySuccess('同步成功', '订单数据已同步，正在重新加载...');
      // 重新查询库存数据
      refetchStock();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? error.response?.data?.message || error.message || '同步失败'
        : error instanceof Error
          ? error.message
          : '同步失败';
      notifyError('同步失败', errorMsg);
    },
  });

  // 初始化商品数据
  useEffect(() => {
    if (visible && stockCheckData?.items) {
      const items: ItemPrepareData[] = stockCheckData.items.map((item) => ({
        sku: item.sku,
        productTitle: item.product_title || item.sku,
        productImage: item.product_image,
        stockAvailable: item.stock_available,
        orderQuantity: item.order_quantity,
        useStock: item.is_sufficient, // 库存充足时默认使用库存
        purchasePrice: item.is_sufficient ? 0 : 0, // 默认0，用户手动填写
        sourcePlatform: item.is_sufficient ? ['库存'] : [],
        notes: '',
      }));
      setItemsData(items);
    }

    // 设置同步选项默认值
    if (visible) {
      form.setFieldsValue({
        sync_to_ozon: true,
      });
    }
  }, [visible, stockCheckData, form]);

  // 更新商品数据
  const updateItemData = (sku: string, field: keyof ItemPrepareData, value: any) => {
    setItemsData((prev) =>
      prev.map((item) => {
        if (item.sku === sku) {
          const updated = { ...item, [field]: value };

          // 如果勾选使用库存且库存充足，自动设置价格为0，平台为库存
          if (field === 'useStock' && value && item.stockAvailable >= item.orderQuantity) {
            updated.purchasePrice = 0;
            updated.sourcePlatform = ['库存'];
          }

          // 如果取消使用库存，清空库存平台
          if (field === 'useStock' && !value) {
            updated.sourcePlatform = updated.sourcePlatform.filter((p) => p !== '库存');
          }

          return updated;
        }
        return item;
      })
    );
  };

  // 计算汇总数据
  const getSummaryData = () => {
    const totalPrice = itemsData.reduce((sum, item) => sum + (item.purchasePrice || 0), 0);

    const allPlatforms = itemsData.flatMap((item) => item.sourcePlatform);
    const uniquePlatforms = Array.from(new Set(allPlatforms));

    const allNotes = itemsData.map((item) => item.notes).filter((n) => n.trim());
    const mergedNotes = allNotes.join('; ');

    return {
      totalPrice,
      platforms: uniquePlatforms,
      notes: mergedNotes,
    };
  };

  // 备货操作 mutation
  const prepareStockMutation = useMutation({
    mutationFn: (data: ozonApi.PrepareStockRequest) => {
      return ozonApi.prepareStock(postingNumber, data);
    },
    onSuccess: () => {
      notifySuccess('操作成功', '备货操作成功');
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      if (onSuccess) {
        onSuccess();
      }
      handleClose();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? error.response?.data?.message || error.message || '备货操作失败'
        : error instanceof Error
          ? error.message
          : '备货操作失败';
      notifyError('操作失败', errorMsg);
    },
  });

  const handleClose = () => {
    form.resetFields();
    setItemsData([]);
    onCancel();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const summary = getSummaryData();

      const data: ozonApi.PrepareStockRequest = {
        source_platform: summary.platforms,
        purchase_price: String(summary.totalPrice),
        order_notes: summary.notes || undefined,
        sync_to_ozon: values.sync_to_ozon !== false,
      };

      loggers.stock.info('提交备货数据', { data, itemsData });
      prepareStockMutation.mutate(data);
    } catch (error) {
      loggers.stock.error('表单验证失败', error);
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '商品',
      dataIndex: 'productTitle',
      key: 'productTitle',
      width: 250,
      render: (_: any, record: ItemPrepareData) => (
        <Space>
          {record.productImage ? (
            <img
              src={record.productImage}
              alt={record.productTitle}
              style={{
                width: 50,
                height: 50,
                objectFit: 'cover',
                borderRadius: 4,
              }}
            />
          ) : (
            <div
              style={{
                width: 50,
                height: 50,
                background: '#f0f0f0',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
              }}
            >
              无图
            </div>
          )}
          <div>
            <Text strong style={{ fontSize: 12 }}>
              {record.productTitle.length > 30
                ? record.productTitle.substring(0, 30) + '...'
                : record.productTitle}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              SKU: {record.sku}
            </Text>
          </div>
        </Space>
      ),
    },
    {
      title: '库存',
      dataIndex: 'stockAvailable',
      key: 'stockAvailable',
      width: 100,
      render: (_: any, record: ItemPrepareData) => (
        <div>
          <Text
            type={record.stockAvailable >= record.orderQuantity ? 'success' : 'danger'}
            style={{ fontSize: 12 }}
          >
            {record.stockAvailable} / {record.orderQuantity}
          </Text>
        </div>
      ),
    },
    {
      title: '使用库存',
      dataIndex: 'useStock',
      key: 'useStock',
      width: 80,
      render: (_: any, record: ItemPrepareData) => (
        <Checkbox
          checked={record.useStock}
          onChange={(e) => updateItemData(record.sku, 'useStock', e.target.checked)}
          disabled={record.stockAvailable === 0}
        />
      ),
    },
    {
      title: '进货价格',
      dataIndex: 'purchasePrice',
      key: 'purchasePrice',
      width: 120,
      render: (_: any, record: ItemPrepareData) => (
        <InputNumber
          value={record.purchasePrice}
          onChange={(value) => updateItemData(record.sku, 'purchasePrice', value || 0)}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          addonBefore={currencySymbol}
          controls={false}
          disabled={record.useStock && record.stockAvailable >= record.orderQuantity}
        />
      ),
    },
    {
      title: '采购平台',
      dataIndex: 'sourcePlatform',
      key: 'sourcePlatform',
      width: 150,
      render: (_: any, record: ItemPrepareData) => (
        <Select
          mode="multiple"
          value={record.sourcePlatform}
          onChange={(value) => updateItemData(record.sku, 'sourcePlatform', value)}
          style={{ width: '100%' }}
          placeholder="选择平台"
          disabled={record.useStock && record.stockAvailable >= record.orderQuantity}
        >
          <Select.Option value="1688">1688</Select.Option>
          <Select.Option value="拼多多">拼多多</Select.Option>
          <Select.Option value="咸鱼">咸鱼</Select.Option>
          <Select.Option value="淘宝">淘宝</Select.Option>
          <Select.Option value="库存">库存</Select.Option>
        </Select>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      render: (_: any, record: ItemPrepareData) => (
        <Input
          value={record.notes}
          onChange={(e) => updateItemData(record.sku, 'notes', e.target.value)}
          placeholder="备注"
          maxLength={200}
        />
      ),
    },
  ];

  const summary = getSummaryData();

  return (
    <Modal
      title={`备货操作 - ${postingNumber}`}
      open={visible}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={prepareStockMutation.isPending}
      okText="确认备货"
      cancelText="取消"
      width={1200}
    >
      {stockLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="正在查询库存..." />
        </div>
      ) : itemsData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Space direction="vertical" size="middle">
            <Typography.Text type="secondary">
              ⚠️ 订单数据不完整，无法进行备货操作
            </Typography.Text>
            <Button
              type="primary"
              loading={syncOrderMutation.isPending}
              onClick={() => syncOrderMutation.mutate()}
            >
              同步该订单数据
            </Button>
          </Space>
        </div>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 商品列表 */}
          <Table
            columns={columns}
            dataSource={itemsData}
            rowKey="sku"
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
          />

          {/* 汇总信息 */}
          <div
            style={{
              padding: '12px',
              background: '#f5f5f5',
              borderRadius: 4,
            }}
          >
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <div>
                <Text strong>汇总信息：</Text>
              </div>
              <div>
                <Text>总进货价格：</Text>
                <Text strong style={{ color: '#1890ff', fontSize: 16 }}>
                  {currencySymbol}
                  {summary.totalPrice.toFixed(2)}
                </Text>
              </div>
              <div>
                <Text>采购平台：</Text>
                <Text strong>{summary.platforms.join(', ') || '无'}</Text>
              </div>
              {summary.notes && (
                <div>
                  <Text>备注：</Text>
                  <Text>{summary.notes}</Text>
                </div>
              )}
            </Space>
          </div>

          {/* 同步到 Ozon */}
          <Form form={form} layout="horizontal">
            <Form.Item name="sync_to_ozon" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>同步到 Ozon</Checkbox>
            </Form.Item>
          </Form>
        </Space>
      )}
    </Modal>
  );
};

export default PrepareStockModal;
