/**
 * 批量备货弹窗组件
 * 按 SKU 分组，对多个 posting 执行批量备货操作
 * 商品部分与普通备货弹窗一致，支持库存操作
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Progress,
  Tag,
  Tooltip,
} from 'antd';
import { CopyOutlined, ExpandOutlined, CompressOutlined, LinkOutlined } from '@ant-design/icons';
import axios from 'axios';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozon';
import { useCurrency } from '@/hooks/useCurrency';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';
import type { SkuGroup } from './packing/SkuGroupCard';

// 进货价格历史记录类型
interface PurchasePriceRecord {
  posting_number: string;
  purchase_price: string;
  updated_at: string;
  source_platform: string[];
}

const { Text } = Typography;

interface BatchPrepareStockModalProps {
  visible: boolean;
  onCancel: () => void;
  skuGroup: SkuGroup | null;
  onSuccess?: (postingNumbers: string[]) => void;
  shopNameMap?: Record<number, string>;
}

// 商品备货数据（与 PrepareStockModal 保持一致）
interface ItemPrepareData {
  sku: string;
  productTitle: string;
  productImage: string | null;
  stockAvailable: number;
  orderQuantity: number;
  useStock: boolean;
  addStockQuantity: number | undefined;
  unitPrice: number | undefined;
  purchasePrice: number | undefined;
  sourcePlatform: string[];
  notes: string;
  shopId?: number;
}

const BatchPrepareStockModal: React.FC<BatchPrepareStockModalProps> = ({
  visible,
  onCancel,
  skuGroup,
  onSuccess,
  shopNameMap = {},
}) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { symbol: currencySymbol } = useCurrency();
  const { copyToClipboard } = useCopy();
  const { formatDateTime } = useDateTime();

  // 商品备货数据
  const [itemsData, setItemsData] = useState<ItemPrepareData[]>([]);

  // 每个 posting 的单独备注
  const [postingNotes, setPostingNotes] = useState<Record<string, string>>({});

  // 批量操作进度
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0 });

  // 进货价格历史状态
  const [showPriceHistory, setShowPriceHistory] = useState(false);
  const [isPriceHistoryExpanded, setIsPriceHistoryExpanded] = useState(false);

  // 图片预览状态
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');

  // 查询库存信息（使用第一个 posting）
  const firstPostingNumber = skuGroup?.postings[0]?.posting_number;
  const { data: stockCheckData, isLoading: stockLoading } = useQuery({
    queryKey: ['stockCheck', firstPostingNumber],
    queryFn: () => ozonApi.checkStockForPosting(firstPostingNumber!),
    enabled: visible && !!firstPostingNumber,
    staleTime: 30000,
  });

  // 查询进货价格历史
  const { data: priceHistoryData, isLoading: priceHistoryLoading } = useQuery<PurchasePriceRecord[]>({
    queryKey: ['purchasePriceHistory', skuGroup?.sku],
    queryFn: async () => {
      const response = await axios.get(`/api/ef/v1/ozon/products/${skuGroup?.sku}/purchase-price-history`, {
        params: { limit: 10 },
      });
      return response.data.history || [];
    },
    enabled: visible && showPriceHistory && !!skuGroup?.sku,
    staleTime: 60000,
  });

  // 初始化商品数据（与 PrepareStockModal 逻辑一致）
  useEffect(() => {
    if (visible && stockCheckData?.items && skuGroup) {
      // 只取当前 SKU 的商品信息
      const skuItem = stockCheckData.items.find(item => item.sku === skuGroup.sku);

      if (skuItem) {
        const unitPrice = skuItem.unit_price ?? undefined;
        const purchasePrice = skuItem.is_sufficient && unitPrice
          ? unitPrice
          : (skuItem.is_sufficient ? 0 : undefined);

        const itemData: ItemPrepareData = {
          sku: skuItem.sku,
          productTitle: skuItem.product_title || skuItem.sku,
          productImage: skuItem.product_image,
          stockAvailable: skuItem.stock_available,
          orderQuantity: skuGroup.totalQuantity, // 使用分组的总数量
          useStock: skuItem.is_sufficient,
          addStockQuantity: undefined,
          unitPrice,
          purchasePrice,
          sourcePlatform: skuItem.is_sufficient ? ['库存'] : [],
          notes: '',
          shopId: skuGroup.postings[0]?.order?.shop_id,
        };
        setItemsData([itemData]);
      } else {
        // 如果没找到库存信息，创建默认数据
        setItemsData([{
          sku: skuGroup.sku,
          productTitle: skuGroup.productName,
          productImage: skuGroup.productImage,
          stockAvailable: 0,
          orderQuantity: skuGroup.totalQuantity,
          useStock: false,
          addStockQuantity: undefined,
          unitPrice: undefined,
          purchasePrice: undefined,
          sourcePlatform: [],
          notes: '',
          shopId: skuGroup.postings[0]?.order?.shop_id,
        }]);
      }
    }

    if (visible) {
      form.setFieldsValue({ sync_to_ozon: true });
    }
  }, [visible, stockCheckData, skuGroup, form]);

  // 更新商品数据
  const updateItemData = (sku: string, field: keyof ItemPrepareData, value: unknown) => {
    setItemsData((prev) =>
      prev.map((item) => {
        if (item.sku === sku) {
          const updated = { ...item, [field]: value };

          if (field === 'useStock' && value && item.stockAvailable >= item.orderQuantity) {
            updated.purchasePrice = item.unitPrice ?? 0;
            updated.sourcePlatform = ['库存'];
          }

          if (field === 'useStock' && !value) {
            updated.purchasePrice = undefined;
            updated.sourcePlatform = updated.sourcePlatform.filter((p) => p !== '库存');
          }

          // 如果只有1个订单，且填写增加库存数量大于订单需要，自动添加"发X库存Y"备注
          if (field === 'addStockQuantity' && skuGroup?.postings.length === 1) {
            const addQty = Number(value) || 0;
            const orderQty = item.orderQuantity;
            if (addQty > orderQty) {
              const stockQty = addQty - orderQty;
              updated.notes = `发${orderQty}库存${stockQty}`;
            } else {
              // 数量不超过订单需要时，清空自动生成的备注（如果是自动生成的格式）
              if (/^发\d+库存\d+$/.test(item.notes)) {
                updated.notes = '';
              }
            }
          }

          return updated;
        }
        return item;
      })
    );
  };

  // 计算汇总数据
  const getSummaryData = () => {
    // 计算总价 = 单价 × 数量 的总和
    const totalPrice = itemsData.reduce(
      (sum, item) => sum + (Number(item.purchasePrice) || 0) * item.orderQuantity,
      0
    );
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

  // 重置状态
  const handleClose = () => {
    form.resetFields();
    setItemsData([]);
    setPostingNotes({});
    setIsProcessing(false);
    setProcessProgress({ current: 0, total: 0 });
    setShowPriceHistory(false);
    setIsPriceHistoryExpanded(false);
    onCancel();
  };

  // 批量备货
  const handleBatchPrepare = async () => {
    if (!skuGroup || skuGroup.postings.length === 0) return;

    try {
      await form.validateFields();

      // 1. 检查是否需要增加库存
      const itemsNeedAddStock = itemsData.filter(
        (item) => item.stockAvailable === 0 && item.addStockQuantity && item.addStockQuantity > 0
      );

      // 2. 先添加库存（如果需要）
      if (itemsNeedAddStock.length > 0) {
        loggers.stock.info('批量备货：需要增加库存的商品', { items: itemsNeedAddStock });

        for (const item of itemsNeedAddStock) {
          if (!item.shopId) {
            notifyError('添加库存失败', `商品 ${item.sku} 缺少店铺信息`);
            return;
          }

          try {
            const unitPrice = item.purchasePrice ? Number(item.purchasePrice) : undefined;
            // 传递用户选择的采购平台（不含"库存"，因为这是外部采购）
            const stockSourcePlatform = item.sourcePlatform.filter(p => p !== '库存');

            await ozonApi.addStock({
              shop_id: item.shopId,
              sku: item.sku,
              quantity: item.addStockQuantity!,
              unit_price: unitPrice,
              source_platform: stockSourcePlatform.length > 0 ? stockSourcePlatform : undefined,
              notes: `批量备货时添加库存`,
            });
            loggers.stock.info('添加库存成功', {
              sku: item.sku,
              quantity: item.addStockQuantity,
              unitPrice,
              sourcePlatform: stockSourcePlatform
            });
          } catch (error) {
            const errorMsg = axios.isAxiosError(error)
              ? error.response?.data?.detail || error.message || '添加库存失败'
              : error instanceof Error
                ? error.message
                : '添加库存失败';
            notifyError('添加库存失败', `商品 ${item.sku}: ${errorMsg}`);
            return;
          }
        }
      }

      // 3. 批量提交备货
      const summary = getSummaryData();
      const postingNumbers = skuGroup.postings.map(p => p.posting_number);
      const syncToOzon = form.getFieldValue('sync_to_ozon') !== false;

      // 确定备货时的 source_platform
      // - 场景A（库存充足）：强制 ['库存']
      // - 场景C（新增库存后备货）：['库存']（从刚添加的库存扣减）
      // - 场景B（有部分库存）：合并用户选择的平台
      const item = itemsData[0]; // 当前SKU的商品
      let prepareSourcePlatform: string[];
      if (item.stockAvailable >= item.orderQuantity) {
        // 场景A：库存充足，强制使用库存
        prepareSourcePlatform = ['库存'];
      } else if (itemsNeedAddStock.length > 0) {
        // 场景C：新增了库存，从库存扣减
        prepareSourcePlatform = ['库存'];
      } else {
        // 场景B：使用用户选择的平台
        prepareSourcePlatform = summary.platforms;
      }

      setIsProcessing(true);
      setProcessProgress({ current: 0, total: postingNumbers.length });

      const failedPostings: string[] = [];

      // 顺序执行备货操作，每个 posting 可能有不同的备注
      for (let i = 0; i < postingNumbers.length; i++) {
        const pn = postingNumbers[i];
        // 优先使用 posting 单独的备注，否则使用汇总备注
        const individualNotes = postingNotes[pn]?.trim();
        const finalNotes = individualNotes || summary.notes || undefined;

        const prepareData: ozonApi.PrepareStockRequest = {
          purchase_price: String(summary.totalPrice),
          source_platform: prepareSourcePlatform,
          order_notes: finalNotes,
          sync_to_ozon: syncToOzon,
        };

        try {
          await ozonApi.prepareStock(pn, prepareData);
          setProcessProgress({ current: i + 1, total: postingNumbers.length });
        } catch (error) {
          loggers.stock.error(`备货失败: ${pn}`, error);
          failedPostings.push(pn);
        }
      }

      setIsProcessing(false);

      if (failedPostings.length === 0) {
        notifySuccess('批量备货成功', `已完成 ${postingNumbers.length} 个订单的备货`);
        queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
        queryClient.invalidateQueries({ queryKey: ['packingStats'] });
        queryClient.invalidateQueries({ queryKey: ['stock'] });
        onSuccess?.(postingNumbers);
        handleClose();
      } else if (failedPostings.length < postingNumbers.length) {
        const successCount = postingNumbers.length - failedPostings.length;
        notifySuccess(
          '部分备货成功',
          `成功 ${successCount} 个，失败 ${failedPostings.length} 个`
        );
        queryClient.invalidateQueries({ queryKey: ['packingOrders'] });
        queryClient.invalidateQueries({ queryKey: ['packingStats'] });
        const successPostings = postingNumbers.filter(pn => !failedPostings.includes(pn));
        onSuccess?.(successPostings);
        handleClose();
      } else {
        notifyError('批量备货失败', '所有订单备货均失败，请检查后重试');
      }
    } catch (error) {
      loggers.stock.error('表单验证失败', error);
    }
  };

  // 商品表格列定义（与 PrepareStockModal 一致）
  const itemColumns = [
    {
      title: '商品',
      dataIndex: 'productTitle',
      key: 'productTitle',
      width: 250,
      render: (_: unknown, record: ItemPrepareData) => (
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
                cursor: 'pointer',
              }}
              onClick={() => {
                setPreviewImageUrl(record.productImage!);
                setImagePreviewVisible(true);
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
              SKU:{' '}
              <Text
                type="secondary"
                style={{ fontSize: 11, cursor: 'pointer', color: '#1890ff' }}
                onClick={() => setShowPriceHistory(!showPriceHistory)}
              >
                {record.sku}
              </Text>
              <CopyOutlined
                style={{ marginLeft: 4, color: '#1890ff', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(record.sku, 'SKU');
                }}
              />
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
      render: (_: unknown, record: ItemPrepareData) => (
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
      title: '库存操作',
      dataIndex: 'useStock',
      key: 'useStock',
      width: 200,
      render: (_: unknown, record: ItemPrepareData) => {
        // 场景C：无库存 - 显示新增库存输入框
        if (record.stockAvailable === 0) {
          return (
            <InputNumber
              value={record.addStockQuantity}
              onChange={(value) => {
                updateItemData(record.sku, 'addStockQuantity', value ?? undefined);
                // 不再自动添加"库存"到 sourcePlatform
              }}
              min={1}
              max={9999}
              style={{ width: '100%' }}
              placeholder="新增库存数量"
              size="small"
            />
          );
        }
        // 场景A：库存充足 - 强制使用库存（禁用复选框）
        if (record.stockAvailable >= record.orderQuantity) {
          return (
            <Checkbox checked disabled>
              使用库存（优先消耗）
            </Checkbox>
          );
        }
        // 场景B：库存不足但>0 - 可选择是否使用库存
        return (
          <Checkbox
            checked={record.useStock}
            onChange={(e) => updateItemData(record.sku, 'useStock', e.target.checked)}
          >
            使用库存
          </Checkbox>
        );
      },
    },
    {
      title: '商品单价',
      dataIndex: 'purchasePrice',
      key: 'purchasePrice',
      width: 120,
      render: (_: unknown, record: ItemPrepareData) => (
        <InputNumber
          value={record.purchasePrice}
          onChange={(value) => updateItemData(record.sku, 'purchasePrice', value ?? undefined)}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          addonBefore={currencySymbol}
          controls={false}
          placeholder="单价"
        />
      ),
    },
    {
      title: '采购平台',
      dataIndex: 'sourcePlatform',
      key: 'sourcePlatform',
      width: 150,
      render: (_: unknown, record: ItemPrepareData) => {
        // 场景A：库存充足 - 禁用并只显示"库存"
        if (record.stockAvailable >= record.orderQuantity) {
          return (
            <Select
              mode="multiple"
              value={['库存']}
              disabled
              style={{ width: '100%' }}
            >
              <Select.Option value="库存">库存</Select.Option>
            </Select>
          );
        }
        // 场景B/C：显示外部平台选项
        return (
          <Select
            mode="multiple"
            value={record.sourcePlatform}
            onChange={(value) => updateItemData(record.sku, 'sourcePlatform', value)}
            style={{ width: '100%' }}
            placeholder="选择平台"
          >
            <Select.Option value="1688">1688</Select.Option>
            <Select.Option value="拼多多">拼多多</Select.Option>
            <Select.Option value="咸鱼">咸鱼</Select.Option>
            <Select.Option value="淘宝">淘宝</Select.Option>
            {/* 场景B：有部分库存时才显示"库存"选项 */}
            {record.stockAvailable > 0 && (
              <Select.Option value="库存">库存</Select.Option>
            )}
            <Select.Option value="其他">其他</Select.Option>
          </Select>
        );
      },
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      render: (_: unknown, record: ItemPrepareData) => (
        <Input
          value={record.notes}
          onChange={(e) => updateItemData(record.sku, 'notes', e.target.value)}
          placeholder="备注"
          maxLength={200}
        />
      ),
    },
  ];

  // 获取商品汇总备注（用于 placeholder 显示）
  const summaryNotes = getSummaryData().notes;

  // Posting 表格列定义
  const postingColumns = [
    {
      title: '店铺',
      key: 'shop_name',
      width: 80,
      render: (_: unknown, posting: ozonApi.PostingWithOrder) => {
        const shopId = posting.shop_id || posting.order?.shop_id;
        const shopName = shopId ? shopNameMap[shopId] : '-';
        // 只显示俄文名称（去掉中文部分）
        const russianName = shopName?.split(' [')[0] || shopName || '-';
        // 只显示第一个单词
        const firstWord = russianName.split(' ')[0] || russianName;
        return (
          <Tooltip title={russianName}>
            <Text style={{ fontSize: 11, cursor: 'help' }}>{firstWord}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 170,
      render: (text: string) => (
        <span>
          {text}
          <CopyOutlined
            style={{ marginLeft: 6, color: '#1890ff', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(text, '货件编号');
            }}
          />
        </span>
      ),
    },
    {
      title: '数量',
      key: 'quantity',
      width: 50,
      align: 'center' as const,
      render: (_: unknown, posting: ozonApi.PostingWithOrder) => {
        const products = posting.products || posting.order?.items || [];
        const product = products.find(p => p.sku === skuGroup?.sku);
        const qty = product?.quantity || 1;
        if (qty > 1) {
          return (
            <span
              style={{
                color: '#ff0000',
                fontWeight: 'bold',
                backgroundColor: '#ffe0e0',
                border: '1px solid #ff0000',
                borderRadius: 4,
                padding: '2px 6px',
              }}
            >
              {qty}
            </span>
          );
        }
        return qty;
      },
    },
    {
      title: '配送',
      key: 'delivery_method',
      width: 180,
      render: (_: unknown, posting: ozonApi.PostingWithOrder) => {
        const deliveryMethod = posting.delivery_method_name || posting.order?.delivery_method || '-';
        // 只显示括号之前的部分（支持中文（和英文(）
        const parenIndexEn = deliveryMethod.indexOf('(');
        const parenIndexZh = deliveryMethod.indexOf('（');
        // 取最小的有效索引
        let parenIndex = -1;
        if (parenIndexEn > 0 && parenIndexZh > 0) {
          parenIndex = Math.min(parenIndexEn, parenIndexZh);
        } else if (parenIndexEn > 0) {
          parenIndex = parenIndexEn;
        } else if (parenIndexZh > 0) {
          parenIndex = parenIndexZh;
        }
        const displayText = parenIndex > 0 ? deliveryMethod.substring(0, parenIndex).trim() : deliveryMethod;

        return (
          <Tooltip title={deliveryMethod}>
            <Text style={{ fontSize: 11, cursor: 'help' }}>{displayText}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '下单',
      key: 'ordered_at',
      width: 60,
      render: (_: unknown, posting: ozonApi.PostingWithOrder) => {
        const orderedAt = posting.order?.ordered_at || posting.in_process_at;
        const fullDate = orderedAt ? formatDateTime(orderedAt, 'YYYY-MM-DD HH:mm') : '-';
        const shortDate = orderedAt ? formatDateTime(orderedAt, 'MM-DD') : '-';
        return (
          <Tooltip title={fullDate}>
            <Text style={{ fontSize: 11, cursor: 'help' }}>{shortDate}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '截止',
      dataIndex: 'shipment_date',
      key: 'shipment_date',
      width: 60,
      render: (text: string) => {
        const fullDate = text ? formatDateTime(text, 'YYYY-MM-DD HH:mm') : '-';
        const shortDate = text ? formatDateTime(text, 'MM-DD') : '-';
        return (
          <Tooltip title={fullDate}>
            <Text type="danger" style={{ fontSize: 11, cursor: 'help' }}>{shortDate}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '备注',
      key: 'notes',
      width: 150,
      render: (_: unknown, posting: ozonApi.PostingWithOrder) => (
        <Input
          value={postingNotes[posting.posting_number] || ''}
          onChange={(e) => {
            setPostingNotes(prev => ({
              ...prev,
              [posting.posting_number]: e.target.value,
            }));
          }}
          placeholder={summaryNotes || '备注'}
          maxLength={200}
          size="small"
        />
      ),
    },
  ];

  const summary = getSummaryData();

  return (
    <>
    <Modal
      title="批量备货"
      open={visible}
      onCancel={handleClose}
      onOk={handleBatchPrepare}
      confirmLoading={isProcessing}
      okText={isProcessing ? '处理中...' : `批量备货 (${skuGroup?.postings.length || 0})`}
      cancelText="取消"
      width={1200}
      okButtonProps={{ disabled: isProcessing }}
    >
      {stockLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="正在查询库存..." />
        </div>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 商品列表（与普通备货弹窗一致） */}
          <Table
            columns={itemColumns}
            dataSource={itemsData}
            rowKey="sku"
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
          />

          {/* 进货价格历史（内联展示） */}
          {showPriceHistory && (
            <div
              style={{
                border: '1px solid #e8e8e8',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              {/* 标题栏 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: '#fafafa',
                  borderBottom: '1px solid #e8e8e8',
                }}
              >
                <Text strong style={{ fontSize: 13 }}>
                  进货价格历史 ({priceHistoryData?.length || 0})
                </Text>
                <Space size="small">
                  <span
                    style={{ cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => setIsPriceHistoryExpanded(!isPriceHistoryExpanded)}
                  >
                    {isPriceHistoryExpanded ? (
                      <CompressOutlined style={{ fontSize: 14 }} />
                    ) : (
                      <ExpandOutlined style={{ fontSize: 14 }} />
                    )}
                  </span>
                </Space>
              </div>

              {/* 历史记录列表 */}
              <div
                style={{
                  maxHeight: isPriceHistoryExpanded ? 400 : 180,
                  overflowY: 'auto',
                  transition: 'max-height 0.3s ease',
                }}
              >
                {priceHistoryLoading ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <Spin size="small" tip="加载中..." />
                  </div>
                ) : priceHistoryData && priceHistoryData.length > 0 ? (
                  <Table
                    columns={[
                      {
                        title: '日期',
                        dataIndex: 'updated_at',
                        key: 'updated_at',
                        width: 120,
                        render: (text: string) => formatDateTime(text, 'MM-DD HH:mm'),
                      },
                      {
                        title: '价格',
                        dataIndex: 'purchase_price',
                        key: 'purchase_price',
                        width: 100,
                        render: (text: string) => (
                          <Text strong style={{ color: '#1890ff' }}>
                            {currencySymbol}{Number(text).toFixed(2)}
                          </Text>
                        ),
                      },
                      {
                        title: '平台',
                        dataIndex: 'source_platform',
                        key: 'source_platform',
                        width: 150,
                        render: (platforms: string[]) => (
                          <Space size={2} wrap>
                            {platforms?.map((p: string) => (
                              <Tag key={p} style={{ margin: 0 }}>
                                {p}
                              </Tag>
                            ))}
                          </Space>
                        ),
                      },
                      {
                        title: '货件编号',
                        dataIndex: 'posting_number',
                        key: 'posting_number',
                        width: 180,
                        render: (text: string) => text || '-',
                      },
                    ]}
                    dataSource={priceHistoryData}
                    rowKey="posting_number"
                    pagination={false}
                    size="small"
                    showHeader={true}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#999' }}>
                    暂无进货记录
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 汇总信息 */}
          <div
            style={{
              padding: '12px',
              background: '#f5f5f5',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <Text strong>汇总信息：</Text>
              <Text style={{ marginLeft: 8 }}>总进货金额 </Text>
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
          </div>

          {/* 待备货订单列表 */}
          <div>
            <Text strong style={{ marginBottom: 8, display: 'block' }}>
              待备货订单 ({skuGroup?.postings.length || 0})
            </Text>
            <Table
              columns={postingColumns}
              dataSource={skuGroup?.postings || []}
              rowKey="posting_number"
              pagination={false}
              size="small"
              scroll={{ y: 200 }}
            />
          </div>

          {/* 同步到 Ozon */}
          <Form form={form} layout="horizontal">
            <Form.Item name="sync_to_ozon" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>同步到 Ozon</Checkbox>
            </Form.Item>
          </Form>

          {/* 处理进度 */}
          {isProcessing && (
            <Progress
              percent={Math.round((processProgress.current / processProgress.total) * 100)}
              status="active"
              format={() => `${processProgress.current}/${processProgress.total}`}
            />
          )}
        </Space>
      )}
    </Modal>

      {/* 图片预览 - 右上角显示商品链接 */}
      <Modal
        open={imagePreviewVisible}
        footer={null}
        onCancel={() => setImagePreviewVisible(false)}
        centered
        width="auto"
        styles={{
          body: { padding: 0, background: 'transparent' },
          content: { background: 'transparent', boxShadow: 'none' },
        }}
      >
        <div style={{ position: 'relative' }}>
          {/* 商品链接 - 右上角 */}
          {skuGroup?.sku && (
            <a
              href={`https://www.ozon.ru/product/${skuGroup.sku}/`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 10,
                background: 'rgba(0, 0, 0, 0.6)',
                color: '#fff',
                padding: '4px 12px',
                borderRadius: 4,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                textDecoration: 'none',
              }}
            >
              <LinkOutlined />
              OZON商品页
            </a>
          )}
          {/* 大图 */}
          {previewImageUrl && (
            <img
              src={previewImageUrl}
              alt="商品图片"
              style={{
                maxWidth: '80vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: 8,
              }}
            />
          )}
        </div>
      </Modal>
    </>
  );
};

export default BatchPrepareStockModal;
