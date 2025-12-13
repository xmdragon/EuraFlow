/**
 * 扫描单号页面
 *
 * 独立的扫描单号功能页面，支持：
 * - 发货员（shipper）：只能看到启用发货托管的店铺订单
 * - 主账号/子账号：只能看到授权店铺订单
 */
import {
  SearchOutlined,
  CloseCircleOutlined,
  PrinterOutlined,
  ScanOutlined,
  SyncOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import {
  Card,
  Input,
  Button,
  Space,
  Empty,
  Spin,
  Select,
  message,
  Typography,
  App,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

import styles from './PackingShipment.module.scss';

import PageTitle from '@/components/PageTitle';
import PrintLabelModal from '@/components/ozon/packing/PrintLabelModal';
import ScanResultTable from '@/components/ozon/packing/ScanResultTable';
import EditNotesModal from '@/components/ozon/packing/EditNotesModal';
import DomesticTrackingModal from '@/components/ozon/DomesticTrackingModal';
import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import PurchasePriceHistoryModal from '@/components/ozon/PurchasePriceHistoryModal';
import { useBatchPrint } from '@/hooks/useBatchPrint';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import { usePermission } from '@/hooks/usePermission';
import { useShopNameFormat } from '@/hooks/useShopNameFormat';
import { readAndValidateClipboard, markClipboardRejected } from '@/hooks/useClipboard';
import axios from '@/services/axios';
import * as ozonApi from '@/services/ozon';
import * as creditApi from '@/services/credit';
import { statusConfig, formatDeliveryMethodTextWhite } from '@/utils/packingHelpers';
import { notifySuccess, notifyError } from '@/utils/notification';
import { useCurrency } from '@/hooks/useCurrency';

import type { InputRef } from 'antd';

const { Text } = Typography;

// 判断订单是否超过10天（逾期）
const isOrderOverdue = (inProcessAt: string | undefined): boolean => {
  if (!inProcessAt) return false;
  const orderDate = dayjs(inProcessAt);
  const daysDiff = dayjs().diff(orderDate, 'day');
  return daysDiff > 10;
};

// 检查订单是否有多件商品
const hasMultipleItems = (posting: ozonApi.Posting | ozonApi.PostingWithOrder): boolean => {
  const items = posting.products || posting.items || [];
  if (items.length > 1) return true;
  return items.some((item: ozonApi.OrderItem) => item.quantity > 1);
};

// 托管店铺信息
interface ManagedShop {
  id: number;
  shop_name: string;
  shop_name_cn?: string;
  display_name: string;
}

const ScanShipping: React.FC = () => {
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const { canOperate, isShipper } = usePermission();
  const { formatDateTime } = useDateTime();
  const { copyToClipboard } = useCopy();
  const { formatShopName } = useShopNameFormat();
  const { currency: userCurrency } = useCurrency();

  // 状态
  const [searchValue, setSearchValue] = useState('');
  const [isAutoFilled, setIsAutoFilled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanResults, setScanResults] = useState<ozonApi.PostingWithOrder[]>([]);
  const [selectedPostings, setSelectedPostings] = useState<string[]>([]);
  const [shopNameMap, setShopNameMap] = useState<Record<number, string>>({});
  const [printStatus, setPrintStatus] = useState<'all' | 'printed' | 'unprinted'>('all');
  const [currentSearchValue, setCurrentSearchValue] = useState(''); // 当前搜索的单号
  const [scanTotal, setScanTotal] = useState(0);
  const [scanOffset, setScanOffset] = useState(0);
  const [scanHasMore, setScanHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // 打印弹窗状态
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printPdfUrl, setPrintPdfUrl] = useState('');
  const [printingPostings, setPrintingPostings] = useState<ozonApi.PostingWithOrder[]>([]);

  // 编辑备注弹窗状态
  const [editNotesModalVisible, setEditNotesModalVisible] = useState(false);
  const [editingPosting, setEditingPosting] = useState<ozonApi.PostingWithOrder | null>(null);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // 国内物流单号弹窗状态
  const [domesticTrackingModalVisible, setDomesticTrackingModalVisible] = useState(false);
  const [currentPosting, setCurrentPosting] = useState<ozonApi.PostingWithOrder | null>(null);

  // 订单详情弹窗状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.PostingWithOrder | null>(null);

  // 进货价格历史弹窗状态
  const [priceHistoryModalVisible, setPriceHistoryModalVisible] = useState(false);
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [selectedProductName, setSelectedProductName] = useState<string>('');

  // 使用批量打印 hook
  const { isPrinting, batchPrint } = useBatchPrint();

  const searchInputRef = useRef<InputRef>(null);
  const batchPrintButtonRef = useRef<HTMLButtonElement>(null);
  // 延迟聚焦的 timer ref
  const delayedFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 获取额度余额信息
  const { data: creditBalance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: creditApi.getBalance,
    staleTime: 30 * 1000,
    retry: 1,
  });

  // 计算选中订单的打印费用
  const printCostInfo = useMemo(() => {
    if (!creditBalance || selectedPostings.length === 0) {
      return null;
    }

    const billablePostings = scanResults.filter(
      (p) => selectedPostings.includes(p.posting_number) && (p.label_print_count || 0) === 0
    );
    const reprintPostings = scanResults.filter(
      (p) => selectedPostings.includes(p.posting_number) && (p.label_print_count || 0) > 0
    );

    const billableCount = billablePostings.length;
    const reprintCount = reprintPostings.length;
    const unitCost = 1;
    const totalCost = billableCount * unitCost;
    const currentBalance = parseFloat(creditBalance.balance);
    const sufficient = currentBalance >= totalCost;

    return {
      billableCount,
      reprintCount,
      unitCost,
      totalCost,
      currentBalance,
      sufficient,
      creditName: creditBalance.credit_name,
    };
  }, [creditBalance, selectedPostings, scanResults]);

  // 加载托管店铺列表
  useEffect(() => {
    const loadManagedShops = async () => {
      try {
        const response = await axios.get('/api/ef/v1/ozon/scan-shipping/shops');
        if (response.data?.data) {
          const map: Record<number, string> = {};
          response.data.data.forEach((shop: ManagedShop) => {
            map[shop.id] = formatShopName(shop);
          });
          setShopNameMap(map);
        }
      } catch (error) {
        console.error('加载托管店铺失败:', error);
      }
    };
    loadManagedShops();
  }, [formatShopName]);

  // 打印弹窗打开时，取消延迟聚焦的 timer
  useEffect(() => {
    if (showPrintModal && delayedFocusTimerRef.current) {
      clearTimeout(delayedFocusTimerRef.current);
      delayedFocusTimerRef.current = null;
    }
  }, [showPrintModal]);

  // 处理搜索
  const handleSearch = useCallback(async () => {
    const value = searchValue.trim();
    if (!value) {
      message.warning('请输入追踪号码/国内单号/货件编号');
      return;
    }

    setLoading(true);
    setScanResults([]);
    setSelectedPostings([]);
    setScanOffset(0);
    setScanHasMore(false);
    setScanTotal(0);
    setCurrentSearchValue(value);

    try {
      const result = await ozonApi.scanShippingSearch(value, 0, 20, printStatus);
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        setScanResults(result.data);
        setScanTotal(result.total || result.data.length);
        setScanHasMore(result.has_more || false);
        setScanOffset(result.data.length);
        // 自动全选
        setSelectedPostings(result.data.map((p: ozonApi.PostingWithOrder) => p.posting_number));
        // 清空输入框并聚焦到批量打印按钮
        setSearchValue('');
        setTimeout(() => {
          batchPrintButtonRef.current?.focus();
        }, 100);
        // 延迟10秒后聚焦回输入框
        if (delayedFocusTimerRef.current) {
          clearTimeout(delayedFocusTimerRef.current);
        }
        delayedFocusTimerRef.current = setTimeout(() => {
          searchInputRef.current?.focus();
          delayedFocusTimerRef.current = null;
        }, 10000);
      } else {
        message.info('未找到匹配的订单');
        setSearchValue('');
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 100);
      }
    } catch (error: unknown) {
      console.error('搜索失败:', error);
      const errorMessage = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '搜索失败';
      message.error(errorMessage);
      setSearchValue('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    } finally {
      setLoading(false);
    }
  }, [searchValue, printStatus]);

  // 加载更多结果
  const handleLoadMore = useCallback(async () => {
    if (!currentSearchValue || isLoadingMore || !scanHasMore) return;

    setIsLoadingMore(true);
    try {
      const result = await ozonApi.scanShippingSearch(
        currentSearchValue,
        scanOffset,
        20,
        printStatus
      );
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        setScanResults((prev) => [...prev, ...result.data]);
        setScanOffset((prev) => prev + result.data.length);
        setScanHasMore(result.has_more || false);
      } else {
        setScanHasMore(false);
      }
    } catch (error) {
      console.error('加载更多失败:', error);
      notifyError('加载失败', '加载更多结果失败，请重试');
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentSearchValue, scanOffset, printStatus, isLoadingMore, scanHasMore]);

  // 切换打印状态过滤时重新查询
  const handlePrintStatusChange = useCallback(async (newStatus: 'all' | 'printed' | 'unprinted') => {
    setPrintStatus(newStatus);

    if (!currentSearchValue) return;

    setScanOffset(0);
    setScanHasMore(false);
    setScanTotal(0);
    setSelectedPostings([]);
    setIsLoadingMore(true);

    try {
      const result = await ozonApi.scanShippingSearch(currentSearchValue, 0, 20, newStatus);
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        setScanResults(result.data);
        setScanTotal(result.total || result.data.length);
        setScanHasMore(result.has_more || false);
        setScanOffset(result.data.length);
      } else {
        setScanResults([]);
        setScanTotal(0);
        setScanHasMore(false);
      }
    } catch (error) {
      console.error('切换打印状态过滤失败:', error);
      notifyError('查询失败', '切换打印状态过滤失败，请重试');
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentSearchValue]);

  // 输入框获得焦点时，尝试自动填充剪贴板内容
  const handleInputFocus = async () => {
    if (searchValue) return;

    const clipboardText = await readAndValidateClipboard();
    if (clipboardText) {
      setSearchValue(clipboardText);
      setIsAutoFilled(true);
    }
  };

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    setIsAutoFilled(false);
  };

  // 清除输入框
  const handleClearInput = () => {
    if (searchValue && isAutoFilled) {
      markClipboardRejected(searchValue);
    }
    setSearchValue('');
    setIsAutoFilled(false);
    searchInputRef.current?.focus();
  };

  // 回车搜索
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // 生成打印确认内容
  const buildPrintConfirmContent = useCallback((postings: ozonApi.PostingWithOrder[]): React.ReactNode | null => {
    const warnings: React.ReactNode[] = [];

    postings.forEach((posting) => {
      const postingWarnings: React.ReactNode[] = [];

      if (isOrderOverdue(posting.in_process_at)) {
        postingWarnings.push(
          <span key="overdue" style={{ color: '#ff4d4f' }}>本订单已逾期！</span>
        );
      }

      if (hasMultipleItems(posting)) {
        postingWarnings.push(
          <span key="multiple">本订单有多件商品，请确认数量！</span>
        );
      }

      if (posting.order_notes && posting.order_notes.trim()) {
        postingWarnings.push(
          <span key="notes">{posting.order_notes}</span>
        );
      }

      if (postingWarnings.length > 0) {
        warnings.push(
          <div key={posting.posting_number} style={{ marginBottom: postings.length > 1 ? '12px' : '0' }}>
            {postingWarnings.map((warning, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontWeight: 500, flexShrink: 0 }}>{posting.posting_number}：</span>
                {warning}
              </div>
            ))}
          </div>
        );
      }
    });

    return warnings.length > 0 ? <div>{warnings}</div> : null;
  }, []);

  // 打印单个标签
  const handlePrintSingle = useCallback(async (postingNumber: string) => {
    const posting = scanResults.find((p) => p.posting_number === postingNumber);

    const doPrint = async () => {
      const result = await batchPrint([postingNumber]);
      if (result?.success && result.pdf_url) {
        setPrintPdfUrl(result.pdf_url);
        setPrintingPostings(posting ? [posting] : []);
        setShowPrintModal(true);
      } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        setPrintPdfUrl(result.pdf_url);
        setPrintingPostings(posting ? [posting] : []);
        setShowPrintModal(true);
      }
    };

    const confirmContent = posting ? buildPrintConfirmContent([posting]) : null;

    if (confirmContent) {
      const hasOverdue = posting && isOrderOverdue(posting.in_process_at);
      modal.confirm({
        title: '确认打印',
        content: confirmContent,
        okText: '确认打印',
        cancelText: '取消',
        okButtonProps: hasOverdue ? { danger: true } : undefined,
        onOk: doPrint,
      });
    } else {
      await doPrint();
    }
  }, [batchPrint, scanResults, buildPrintConfirmContent, modal]);

  // 批量打印
  const handleBatchPrint = useCallback(async () => {
    if (selectedPostings.length === 0) {
      message.warning('请选择要打印的订单');
      return;
    }

    const postingsToPrint = scanResults.filter((p) => selectedPostings.includes(p.posting_number));

    const doPrint = async () => {
      const result = await batchPrint(selectedPostings);
      if (result?.success && result.pdf_url) {
        setPrintPdfUrl(result.pdf_url);
        setPrintingPostings(postingsToPrint);
        setShowPrintModal(true);
      } else if (result?.error === 'PARTIAL_FAILURE' && result.pdf_url) {
        setPrintPdfUrl(result.pdf_url);
        const successPostings = postingsToPrint.filter(p => result.success_postings?.includes(p.posting_number));
        setPrintingPostings(successPostings);
        setShowPrintModal(true);
      }
    };

    const confirmContent = buildPrintConfirmContent(postingsToPrint);

    if (confirmContent) {
      const hasOverdue = postingsToPrint.some((p) => isOrderOverdue(p.in_process_at));
      modal.confirm({
        title: '确认打印',
        content: confirmContent,
        okText: '确认打印',
        cancelText: '取消',
        okButtonProps: hasOverdue ? { danger: true } : undefined,
        onOk: doPrint,
      });
    } else {
      await doPrint();
    }
  }, [batchPrint, scanResults, selectedPostings, buildPrintConfirmContent, modal]);

  // 关闭打印弹窗
  const handleClosePrintModal = useCallback(() => {
    setShowPrintModal(false);
    setPrintPdfUrl('');
    setPrintingPostings([]);
    setSearchValue(''); // 清空搜索框
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, []);

  // 标记已打印
  const handleMarkPrinted = useCallback(async () => {
    if (printingPostings.length === 0) return;

    try {
      const postingNumbers = printingPostings.map((p) => p.posting_number);
      const promises = postingNumbers.map((pn) => ozonApi.markPostingPrinted(pn));
      await Promise.all(promises);

      notifySuccess(
        '标记成功',
        printingPostings.length > 1 ? `已标记${printingPostings.length}个订单为已打印` : '已标记为已打印'
      );

      handleClosePrintModal();

      // 刷新扫描结果
      if (printStatus === 'unprinted') {
        setScanResults((prev) => prev.filter((p) => !postingNumbers.includes(p.posting_number)));
      } else {
        setScanResults((prev) =>
          prev.map((p) =>
            postingNumbers.includes(p.posting_number)
              ? { ...p, operation_status: 'printed', label_printed_at: new Date().toISOString() }
              : p
          )
        );
      }

      setSelectedPostings((prev) => prev.filter((pn) => !postingNumbers.includes(pn)));
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
    } catch (error) {
      console.error('标记已打印失败:', error);
      notifyError('标记失败', '标记失败');
    }
  }, [printingPostings, handleClosePrintModal, printStatus, queryClient]);

  // 打开编辑备注弹窗
  const handleOpenEditNotes = useCallback((posting: ozonApi.PostingWithOrder) => {
    setEditingPosting(posting);
    setEditNotesModalVisible(true);
  }, []);

  // 保存备注
  const handleSaveNotes = useCallback(async () => {
    if (!editingPosting) return;

    setIsSavingNotes(true);
    try {
      await ozonApi.updatePostingBusinessInfo(editingPosting.posting_number, {
        order_notes: editingPosting.order_notes,
      });
      notifySuccess('保存成功', '订单备注已更新');
      setScanResults((prev) =>
        prev.map((p) =>
          p.posting_number === editingPosting.posting_number
            ? { ...p, order_notes: editingPosting.order_notes }
            : p
        )
      );
      setEditNotesModalVisible(false);
      setEditingPosting(null);
    } catch (error) {
      console.error('保存备注失败:', error);
      notifyError('保存失败', '保存备注失败');
    } finally {
      setIsSavingNotes(false);
    }
  }, [editingPosting]);

  // 打开国内单号弹窗
  const handleOpenDomesticTracking = useCallback((posting: ozonApi.PostingWithOrder) => {
    setCurrentPosting(posting);
    setDomesticTrackingModalVisible(true);
  }, []);

  // 国内单号保存成功后刷新
  const handleDomesticTrackingSuccess = useCallback(async () => {
    if (!currentPosting) return;

    try {
      const result = await ozonApi.scanShippingSearch(currentPosting.posting_number);
      if (result.data && Array.isArray(result.data) && result.data.length > 0) {
        const updatedPosting = result.data[0];
        setScanResults((prev) =>
          prev.map((p) =>
            p.posting_number === currentPosting.posting_number ? updatedPosting : p
          )
        );
        setCurrentPosting(updatedPosting);
      } else {
        setScanResults((prev) =>
          prev.filter((p) => p.posting_number !== currentPosting.posting_number)
        );
      }
    } catch {
      setScanResults((prev) =>
        prev.filter((p) => p.posting_number !== currentPosting.posting_number)
      );
    }

    queryClient.invalidateQueries({ queryKey: ['packingStats'] });
    setDomesticTrackingModalVisible(false);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, [currentPosting, queryClient]);

  // 显示订单详情
  const handleShowDetail = useCallback((order: ozonApi.Order, posting: ozonApi.Posting) => {
    setSelectedOrder(order);
    setSelectedPosting(posting as ozonApi.PostingWithOrder);
    setDetailModalVisible(true);
  }, []);

  // 打开进价历史
  const handleOpenPriceHistory = useCallback((sku: string, productName: string) => {
    setSelectedSku(sku);
    setSelectedProductName(productName);
    setPriceHistoryModalVisible(true);
  }, []);

  // 复制
  const handleCopy = useCallback((text: string, label: string) => {
    copyToClipboard(text, label);
  }, [copyToClipboard]);

  // 全选/取消全选
  const handleToggleSelectAll = useCallback(() => {
    if (selectedPostings.length === scanResults.length) {
      setSelectedPostings([]);
    } else {
      setSelectedPostings(scanResults.map((p) => p.posting_number));
    }
  }, [selectedPostings, scanResults]);

  // 判断是否可以操作（发货员也可以）
  const canAction = canOperate || isShipper;

  return (
    <div className={styles.container}>
      <PageTitle title="扫描单号" />

      {/* 搜索区域 */}
      <Card className={styles.filterCard}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Input
              ref={searchInputRef}
              placeholder="输入追踪号码/国内单号/货件编号"
              prefix={<ScanOutlined />}
              style={{ width: 320 }}
              value={searchValue}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              onKeyDown={handleKeyDown}
              suffix={
                searchValue ? (
                  <CloseCircleOutlined
                    onClick={handleClearInput}
                    style={{ color: '#999', cursor: 'pointer' }}
                  />
                ) : null
              }
            />
            <Select
              value={printStatus}
              onChange={handlePrintStatusChange}
              style={{ width: 100 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'unprinted', label: '未打印' },
                { value: 'printed', label: '已打印' },
              ]}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading}>
              搜索
            </Button>
          </Space>

          {/* 批量操作 */}
          {scanResults.length > 0 && canAction && (
            <Space>
              {/* 打印费用提示 */}
              {printCostInfo && printCostInfo.billableCount > 0 && (
                <Space size={4}>
                  <WalletOutlined style={{ color: printCostInfo.sufficient ? '#1890ff' : '#ff4d4f' }} />
                  <Text style={{ fontSize: 13 }}>
                    本次消耗 <Text strong style={{ color: printCostInfo.sufficient ? undefined : '#ff4d4f' }}>{printCostInfo.totalCost}</Text> {printCostInfo.creditName}
                    {printCostInfo.reprintCount > 0 && (
                      <Text type="secondary">（{printCostInfo.reprintCount}个补打印免费）</Text>
                    )}
                  </Text>
                  {!printCostInfo.sufficient && (
                    <Text type="danger" style={{ fontSize: 13 }}>余额不足</Text>
                  )}
                </Space>
              )}
              <Button
                type={selectedPostings.length === scanResults.length && scanResults.length > 0 ? 'primary' : 'default'}
                onClick={handleToggleSelectAll}
                disabled={scanResults.length === 0}
              >
                {selectedPostings.length === scanResults.length && scanResults.length > 0 ? '取消全选' : '全选'}
              </Button>
              <Button
                ref={batchPrintButtonRef}
                type="primary"
                icon={<PrinterOutlined />}
                loading={isPrinting}
                disabled={selectedPostings.length === 0 || (printCostInfo && !printCostInfo.sufficient)}
                onClick={handleBatchPrint}
              >
                批量打印 ({selectedPostings.length}/{scanResults.length})
              </Button>
            </Space>
          )}
        </Space>
      </Card>

      {/* 结果区域 */}
      <Card className={styles.tableCard}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <Spin size="large" />
          </div>
        ) : scanResults.length === 0 ? (
          <Empty
            description={
              <span>
                {isShipper
                  ? '请扫描单号查询订单（仅显示启用发货托管的店铺订单）'
                  : '请扫描单号查询订单'}
              </span>
            }
          />
        ) : (
          <>
            <ScanResultTable
              scanResults={scanResults}
              scanSelectedPostings={selectedPostings}
              onSelectedPostingsChange={setSelectedPostings}
              onPrintSingle={handlePrintSingle}
              onOpenEditNotes={handleOpenEditNotes}
              onOpenDomesticTracking={handleOpenDomesticTracking}
              onShowDetail={handleShowDetail}
              onOpenPriceHistory={handleOpenPriceHistory}
              shopNameMap={shopNameMap}
              canOperate={canAction}
              isPrinting={isPrinting}
              onCopy={handleCopy}
            />
            {/* 加载更多 */}
            {isLoadingMore && (
              <div className={styles.loadingMore}>
                <SyncOutlined spin /> 加载更多...
              </div>
            )}
            {scanHasMore && !isLoadingMore && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Button onClick={handleLoadMore}>加载更多</Button>
              </div>
            )}
            {!scanHasMore && scanResults.length > 0 && scanTotal > 20 && (
              <div className={styles.loadingMore}>
                <Text type="secondary">已加载全部 {scanResults.length} 条结果</Text>
              </div>
            )}
          </>
        )}
      </Card>

      {/* 打印标签弹窗 */}
      <PrintLabelModal
        visible={showPrintModal}
        pdfUrl={printPdfUrl}
        postings={printingPostings}
        onClose={handleClosePrintModal}
        onAfterClose={() => {
          setTimeout(() => {
            searchInputRef.current?.focus();
          }, 100);
        }}
        onPrint={async (weights) => {
          const postingNumbers = printingPostings.map(p => p.posting_number);
          if (postingNumbers.length === 0) return;
          await batchPrint(postingNumbers, weights);
        }}
        onMarkPrinted={handleMarkPrinted}
      />

      {/* 编辑备注弹窗 */}
      <EditNotesModal
        visible={editNotesModalVisible}
        posting={editingPosting}
        onClose={() => {
          setEditNotesModalVisible(false);
          setEditingPosting(null);
        }}
        onSave={handleSaveNotes}
        loading={isSavingNotes}
        onNotesChange={(notes) => {
          if (editingPosting) {
            setEditingPosting({
              ...editingPosting,
              order_notes: notes,
            });
          }
        }}
      />

      {/* 国内物流单号弹窗 */}
      {currentPosting && (
        <DomesticTrackingModal
          visible={domesticTrackingModalVisible}
          onCancel={() => setDomesticTrackingModalVisible(false)}
          postingNumber={currentPosting.posting_number}
          initialTrackingNumbers={currentPosting.domestic_tracking_numbers}
          initialOrderNotes={currentPosting.order?.order_notes}
          onSuccess={handleDomesticTrackingSuccess}
        />
      )}

      {/* 订单详情弹窗 */}
      <OrderDetailModal
        visible={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        selectedOrder={selectedOrder}
        selectedPosting={selectedPosting}
        statusConfig={statusConfig}
        userCurrency={userCurrency}
        offerIdImageMap={{}}
        formatDeliveryMethodTextWhite={formatDeliveryMethodTextWhite}
        onUpdate={() => {
          // 刷新后不需要特殊处理
        }}
      />

      {/* 进货价格历史弹窗 */}
      <PurchasePriceHistoryModal
        visible={priceHistoryModalVisible}
        onCancel={() => setPriceHistoryModalVisible(false)}
        sku={selectedSku}
        productName={selectedProductName}
      />
    </div>
  );
};

export default ScanShipping;
