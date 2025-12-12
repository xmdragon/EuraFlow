/**
 * OZON 财务交易页面
 */
import { CopyOutlined, DollarOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Select,
  Statistic,
  Row,
  Col,
  Pagination,
  Space,
  Button,
  Modal,
  DatePicker,
  Progress,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';

import styles from './FinanceTransactions.module.scss';

import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { ORDER_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';
import { useCopy } from '@/hooks/useCopy';
import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import * as ozonApi from '@/services/ozon';
import { notifyError, notifySuccess } from '@/utils/notification';

const { Option } = Select;

// 交易类型中文映射
const TRANSACTION_TYPE_MAP: Record<string, string> = {
  orders: '订单',
  returns: '退货',
  services: '服务',
  compensation: '补偿',
  transferDelivery: '配送转移',
  other: '其他',
  all: '全部',
};

// 展开详细数据的子组件
interface ExpandedDetailTableProps {
  date: string;
  getDateDetails: (date: string) => Promise<ozonApi.FinanceTransaction[]>;
  detailColumns: ColumnsType<ozonApi.FinanceTransaction>;
}

const ExpandedDetailTable: React.FC<ExpandedDetailTableProps> = ({
  date,
  getDateDetails,
  detailColumns,
}) => {
  const { data: details, isLoading } = useQuery({
    queryKey: ['financeTransactionDetails', date],
    queryFn: () => getDateDetails(date),
    staleTime: 60000,
  });

  return (
    <Table
      className={styles.compactTable}
      loading={isLoading}
      columns={detailColumns}
      dataSource={details || []}
      rowKey="id"
      pagination={false}
      size="small"
      style={{ marginLeft: 40, marginRight: 40 }}
    />
  );
};

// 生成日期周期选项
interface PeriodOption {
  label: string;
  value: string; // 格式: "YYYY-MM-DD|YYYY-MM-DD"
}

const generatePeriodOptions = (): PeriodOption[] => {
  const options: PeriodOption[] = [];
  const today = dayjs();
  const currentDay = today.date();

  // 确定起始月份和是否包含当月上半月
  // 如果当前是1-15号：从上个月开始（当月还没数据）
  // 如果当前是16-月底：从本月上半月开始
  const includeCurrentFirstHalf = currentDay >= 16;
  const startMonth = includeCurrentFirstHalf ? 0 : 1;

  // 最近3个月提供半月和整月选项
  for (let i = startMonth; i < startMonth + 3; i++) {
    const month = today.subtract(i, 'month');
    const monthLabel = month.format('YYYY年M月');
    const monthStart = month.startOf('month');
    const monthEnd = month.endOf('month');
    const mid15 = month.date(15);
    const mid16 = month.date(16);

    // 当月只显示上半月（如果includeCurrentFirstHalf为true且i=0）
    if (i === 0 && includeCurrentFirstHalf) {
      options.push({
        label: `${monthLabel} (1-15日)`,
        value: `${monthStart.format('YYYY-MM-DD')}|${mid15.format('YYYY-MM-DD')}`,
      });
    } else {
      // 完整月份：整月、下半月、上半月
      options.push({
        label: monthLabel,
        value: `${monthStart.format('YYYY-MM-DD')}|${monthEnd.format('YYYY-MM-DD')}`,
      });
      options.push({
        label: `${monthLabel} (16-${monthEnd.date()}日)`,
        value: `${mid16.format('YYYY-MM-DD')}|${monthEnd.format('YYYY-MM-DD')}`,
      });
      options.push({
        label: `${monthLabel} (1-15日)`,
        value: `${monthStart.format('YYYY-MM-DD')}|${mid15.format('YYYY-MM-DD')}`,
      });
    }
  }

  // 更早的月份（往前12个月）只提供整月
  for (let i = startMonth + 3; i < startMonth + 15; i++) {
    const month = today.subtract(i, 'month');
    const monthLabel = month.format('YYYY年M月');
    const monthStart = month.startOf('month');
    const monthEnd = month.endOf('month');

    options.push({
      label: monthLabel,
      value: `${monthStart.format('YYYY-MM-DD')}|${monthEnd.format('YYYY-MM-DD')}`,
    });
  }

  return options;
};

const FinanceTransactions: React.FC = () => {
  const { formatDate } = useDateTime();
  const queryClient = useQueryClient();

  // 生成周期选项
  const periodOptions = useMemo(() => generatePeriodOptions(), []);

  // 店铺选择（带验证）
  const { selectedShop, setSelectedShop } = useShopSelection();
  const [selectedPeriod, setSelectedPeriod] = useState<string>(periodOptions[0]?.value || '');
  const [transactionType, setTransactionType] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // 从选中的周期解析日期范围
  const dateRange = useMemo(() => {
    if (!selectedPeriod) return null;
    const [dateFrom, dateTo] = selectedPeriod.split('|');
    return { dateFrom, dateTo };
  }, [selectedPeriod]);

  // 展开的日期行
  const [expandedDates, setExpandedDates] = useState<string[]>([]);

  // 订单详情Modal状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 历史同步Modal状态
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [syncMonth, setSyncMonth] = useState<dayjs.Dayjs | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<ozonApi.FinanceHistorySyncProgress | null>(null);
  const syncPollingRef = useRef<NodeJS.Timeout | null>(null);

  // 货币和状态配置
  const { currency: userCurrency } = useCurrency();
  const { copyToClipboard } = useCopy();
  const statusConfig = ORDER_STATUS_CONFIG;

  // 停止同步进度轮询
  const stopSyncPolling = useCallback(() => {
    if (syncPollingRef.current) {
      clearInterval(syncPollingRef.current);
      syncPollingRef.current = null;
    }
  }, []);

  // 清理轮询
  useEffect(() => {
    return () => {
      stopSyncPolling();
    };
  }, [stopSyncPolling]);

  // 开始历史同步
  const handleStartSync = async () => {
    if (!syncMonth) {
      notifyError('请选择月份', '请先选择要同步的月份');
      return;
    }

    const dateFrom = syncMonth.startOf('month').format('YYYY-MM-DD');
    const dateTo = syncMonth.endOf('month').format('YYYY-MM-DD');

    try {
      setSyncing(true);
      setSyncProgress({
        status: 'running',
        current: 0,
        total: 0,
        progress: 0,
        message: '正在启动同步任务...',
      });

      // 启动同步任务
      const response = await ozonApi.startFinanceHistorySync({
        date_from: dateFrom,
        date_to: dateTo,
        shop_id: selectedShop || undefined,
      });

      if (!response.success) {
        throw new Error(response.message);
      }

      const taskId = response.task_id;

      // 开始轮询进度
      syncPollingRef.current = setInterval(async () => {
        try {
          const progress = await ozonApi.getFinanceHistorySyncProgress(taskId);
          setSyncProgress(progress);

          if (progress.status === 'completed') {
            stopSyncPolling();
            setSyncing(false);
            notifySuccess('同步完成', progress.result?.message || '财务数据同步成功');
            // 刷新数据
            queryClient.invalidateQueries({ queryKey: ['financeTransactionsDailySummary'] });
            queryClient.invalidateQueries({ queryKey: ['financeTransactionsSummary'] });
            // 延迟关闭 Modal
            setTimeout(() => {
              setSyncModalVisible(false);
              setSyncProgress(null);
              setSyncMonth(null);
            }, 2000);
          } else if (progress.status === 'failed') {
            stopSyncPolling();
            setSyncing(false);
            notifyError('同步失败', progress.result?.message || progress.message || '同步任务执行失败');
          }
        } catch (error) {
          // 轮询错误静默处理
        }
      }, 2000);

    } catch (error) {
      setSyncing(false);
      setSyncProgress(null);
      notifyError('启动失败', error instanceof Error ? error.message : '无法启动同步任务');
    }
  };

  // 关闭同步Modal
  const handleCloseSyncModal = () => {
    if (syncing) {
      Modal.confirm({
        title: '确认关闭',
        content: '同步任务正在进行中，关闭后任务将在后台继续执行。是否关闭？',
        onOk: () => {
          stopSyncPolling();
          setSyncModalVisible(false);
          setSyncing(false);
          setSyncProgress(null);
        },
      });
    } else {
      setSyncModalVisible(false);
      setSyncProgress(null);
      setSyncMonth(null);
    }
  };

  // 查询财务交易按日期汇总（主表格）
  const { data: dailySummaryData, isLoading } = useQuery({
    queryKey: [
      'financeTransactionsDailySummary',
      selectedShop,
      selectedPeriod,
      transactionType,
      currentPage,
      pageSize,
    ],
    queryFn: async () => {
      const filter: ozonApi.FinanceTransactionsFilter = {
        shop_id: selectedShop,
        page: currentPage,
        page_size: pageSize,
      };

      if (dateRange) {
        filter.date_from = dateRange.dateFrom;
        filter.date_to = dateRange.dateTo;
      }

      if (transactionType && transactionType !== 'all') {
        filter.transaction_type = transactionType;
      }

      return await ozonApi.getFinanceTransactionsDailySummary(filter);
    },
    staleTime: 60000, // 1分钟缓存
  });

  // 查询汇总数据
  const { data: summaryData } = useQuery({
    queryKey: ['financeTransactionsSummary', selectedShop, selectedPeriod, transactionType],
    queryFn: async () => {
      const txType = transactionType !== 'all' ? transactionType : undefined;

      return await ozonApi.getFinanceTransactionsSummary(
        selectedShop,
        dateRange?.dateFrom,
        dateRange?.dateTo,
        txType
      );
    },
    staleTime: 60000,
  });

  // 查询汇率（RUB to CNY）
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchangeRate', 'RUB', 'CNY'],
    queryFn: async () => {
      const { getExchangeRate } = await import('@/services/exchangeRateApi');
      return await getExchangeRate('RUB', 'CNY');
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });

  // 查询实收款（账单付款）
  const { data: invoicePaymentData } = useQuery({
    queryKey: ['invoicePaymentsByPeriod', selectedShop, dateRange?.dateFrom, dateRange?.dateTo],
    queryFn: async () => {
      if (!dateRange) return null;
      return await ozonApi.getInvoicePaymentsByPeriod(
        selectedShop,
        dateRange.dateFrom,
        dateRange.dateTo
      );
    },
    enabled: !!dateRange,
    staleTime: 60000,
  });

  // offer_id到图片的映射（从订单详情API返回中获取）
  const [offerIdImageMap, setOfferIdImageMap] = useState<Record<string, string>>({});

  // 获取某个日期的详细交易记录（用于展开行）
  const getDateDetails = async (date: string): Promise<ozonApi.FinanceTransaction[]> => {
    const filter: ozonApi.FinanceTransactionsFilter = {
      shop_id: selectedShop,
      date_from: date,
      date_to: date,
      page: 1,
      page_size: 1000, // 一天的交易数量通常不会太多
    };

    if (transactionType && transactionType !== 'all') {
      filter.transaction_type = transactionType;
    }

    const response = await ozonApi.getFinanceTransactions(filter);
    return response.items;
  };

  // 显示订单详情
  const showPostingDetail = async (postingNumber: string, shopId?: number) => {
    try {
      setLoadingDetail(true);
      const response = await ozonApi.getOrderDetail(postingNumber, shopId);

      if (response.data) {
        const orderData = response.data;
        const posting = orderData.postings?.find(p => p.posting_number === postingNumber);

        setSelectedOrder(orderData);
        setSelectedPosting(posting || null);

        // 更新商品图片映射
        if (response.offer_id_images) {
          setOfferIdImageMap(response.offer_id_images);
        }

        setDetailModalVisible(true);
      }
    } catch {
      notifyError('加载失败', '无法加载订单详情');
    } finally {
      setLoadingDetail(false);
    }
  };

  // 格式化金额（添加货币符号）
  const formatAmount = (amount: string | undefined): string => {
    if (!amount) return '₽0.00';
    const num = parseFloat(amount);
    return `₽${num.toFixed(2)}`;
  };

  // 格式化配送方式文本（用于白色背景显示）
  const formatDeliveryMethodTextWhite = (text: string | undefined): React.ReactNode => {
    if (!text) return '-';

    // 如果包含括号，提取括号内的内容
    const match = text.match(/^(.+?)[(（](.+?)[)）]$/);
    if (!match) return text;

    const mainText = match[1];
    const subText = match[2];

    return (
      <span>
        {mainText}
        <span style={{ color: '#1890ff' }}>({subText})</span>
      </span>
    );
  };

  // 判断货件编号是否为有效格式（数字-数字-数字）
  const isValidPostingNumber = (postingNumber: string): boolean => {
    return /^\d+-\d+-\d+$/.test(postingNumber);
  };

  // 主表格列定义（日汇总）
  const dailySummaryColumns: ColumnsType<ozonApi.FinanceTransactionDailySummary> = [
    {
      title: '日期',
      dataIndex: 'operation_date',
      width: 120,
      render: (date: string) => formatDate(date),
    },
    {
      title: '交易数量',
      dataIndex: 'transaction_count',
      width: 100,
      align: 'center',
    },
    {
      title: '销售收入',
      dataIndex: 'total_accruals_for_sale',
      width: 110,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '总金额',
      dataIndex: 'total_amount',
      width: 110,
      align: 'right',
      render: (amount: string) => {
        const num = parseFloat(amount);
        return (
          <span className={num >= 0 ? styles.positive : styles.negative}>
            {formatAmount(amount)}
          </span>
        );
      },
    },
    {
      title: '销售佣金',
      dataIndex: 'total_sale_commission',
      width: 110,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '配送费',
      dataIndex: 'total_delivery_charge',
      width: 110,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '退货配送费',
      dataIndex: 'total_return_delivery_charge',
      width: 110,
      align: 'right',
      render: formatAmount,
    },
  ];

  // 详细交易列定义（展开行）
  const detailColumns: ColumnsType<ozonApi.FinanceTransaction> = [
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      width: 200,
      render: (text, record) => {
        if (!text) return '-';
        // 只有数字-数字-数字格式才显示为链接
        if (isValidPostingNumber(text)) {
          return (
            <span>
              <a
                onClick={() => {
                  showPostingDetail(text, record.shop_id);
                }}
                style={{ cursor: 'pointer', color: '#1890ff' }}
              >
                {text}
              </a>
              <CopyOutlined
                style={{ marginLeft: 4, color: '#1890ff', cursor: 'pointer' }}
                onClick={() => copyToClipboard(text, '货件编号')}
              />
            </span>
          );
        }
        return (
          <span>
            {text}
            <CopyOutlined
              style={{ marginLeft: 4, color: '#1890ff', cursor: 'pointer' }}
              onClick={() => copyToClipboard(text, '货件编号')}
            />
          </span>
        );
      },
    },
    {
      title: '操作类型',
      dataIndex: 'operation_type_name',
      width: 150,
      render: (text, record) => text || record.operation_type || '-',
    },
    {
      title: '交易类型',
      dataIndex: 'transaction_type',
      width: 80,
      render: (type: string) => TRANSACTION_TYPE_MAP[type] || type,
    },
    {
      title: '商品SKU',
      dataIndex: 'ozon_sku',
      width: 160,
      render: (text) => {
        if (!text) return '-';
        return (
          <span>
            {text}
            <CopyOutlined
              style={{ marginLeft: 4, color: '#1890ff', cursor: 'pointer' }}
              onClick={() => copyToClipboard(text, 'SKU')}
            />
          </span>
        );
      },
    },
    {
      title: '销售收入',
      dataIndex: 'accruals_for_sale',
      width: 100,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '总金额',
      dataIndex: 'amount',
      width: 100,
      align: 'right',
      render: (amount: string) => {
        const num = parseFloat(amount);
        return (
          <span className={num >= 0 ? styles.positive : styles.negative}>
            {formatAmount(amount)}
          </span>
        );
      },
    },
    {
      title: '配送费',
      dataIndex: 'delivery_charge',
      width: 60,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '退货配送费',
      dataIndex: 'return_delivery_charge',
      width: 90,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '销售佣金',
      dataIndex: 'sale_commission',
      width: 90,
      align: 'right',
      render: formatAmount,
    },
  ];

  return (
    <div>
      <PageTitle icon={<DollarOutlined />} title="财务记录" />

      <div className={styles.contentContainer}>
        <Card className={styles.filterCard}>
          <Row gutter={[16, 16]} align="middle">
            <Col>
              <ShopSelector
                value={selectedShop}
                onChange={(value) => {
                  setSelectedShop(value as number | null);
                  setCurrentPage(1);
                }}
                showAllOption={true}
              />
            </Col>
            <Col>
              <Select
                value={selectedPeriod}
                onChange={(value) => {
                  setSelectedPeriod(value);
                  setCurrentPage(1);
                }}
                style={{ minWidth: 200 }}
                options={periodOptions}
              />
            </Col>
            <Col>
              <Select
                value={transactionType}
                onChange={(value) => {
                  setTransactionType(value);
                  setCurrentPage(1);
                }}
                style={{ minWidth: 120 }}
              >
                {Object.entries(TRANSACTION_TYPE_MAP).map(([key, label]) => (
                  <Option key={key} value={key}>
                    {label}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col flex="auto" />
            <Col>
              <Button
                icon={<SyncOutlined />}
                onClick={() => setSyncModalVisible(true)}
              >
                同步历史数据
              </Button>
            </Col>
          </Row>
        </Card>

        {/* 汇总统计卡片 */}
        {summaryData && (
          <Row gutter={16} className={styles.summaryRow}>
            <Col span={4}>
              <Card>
                <Statistic
                  title="交易总数"
                  value={summaryData.transaction_count}
                  prefix={<DollarOutlined />}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="实收款"
                  value={invoicePaymentData ? parseFloat(invoicePaymentData.total_amount_cny) : 0}
                  precision={2}
                  prefix="¥"
                  valueStyle={{ color: '#52c41a' }}
                />
                {invoicePaymentData && parseFloat(invoicePaymentData.pending_amount_cny) > 0 && (
                  <div style={{ fontSize: '12px', color: '#faad14', marginTop: '4px' }}>
                    待付款: ¥{parseFloat(invoicePaymentData.pending_amount_cny).toFixed(2)}
                  </div>
                )}
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="销售收入总额"
                  value={parseFloat(summaryData.total_accruals_for_sale)}
                  precision={2}
                  prefix="₽"
                  valueStyle={{ color: '#3f8600' }}
                />
                {exchangeRateData && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    ≈ ¥{(parseFloat(summaryData.total_accruals_for_sale) * parseFloat(exchangeRateData.rate)).toFixed(2)}
                  </div>
                )}
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="总金额"
                  value={parseFloat(summaryData.total_amount)}
                  precision={2}
                  prefix="₽"
                  valueStyle={{
                    color: parseFloat(summaryData.total_amount) >= 0 ? '#3f8600' : '#cf1322',
                  }}
                />
                {exchangeRateData && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    ≈ ¥{(parseFloat(summaryData.total_amount) * parseFloat(exchangeRateData.rate)).toFixed(2)}
                  </div>
                )}
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="销售佣金总额"
                  value={parseFloat(summaryData.total_sale_commission)}
                  precision={2}
                  prefix="₽"
                  valueStyle={{ color: '#cf1322' }}
                />
                {exchangeRateData && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    ≈ ¥{(parseFloat(summaryData.total_sale_commission) * parseFloat(exchangeRateData.rate)).toFixed(2)}
                  </div>
                )}
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="配送费总额"
                  value={parseFloat(summaryData.total_delivery_charge)}
                  precision={2}
                  prefix="₽"
                />
                {exchangeRateData && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    ≈ ¥{(parseFloat(summaryData.total_delivery_charge) * parseFloat(exchangeRateData.rate)).toFixed(2)}
                  </div>
                )}
              </Card>
            </Col>
          </Row>
        )}

        {/* 按日期汇总的交易列表 */}
        <Card className={styles.listCard}>
          <Table
            className={styles.compactTable}
            loading={isLoading}
            columns={dailySummaryColumns}
            dataSource={dailySummaryData?.items || []}
            rowKey="operation_date"
            pagination={false}
            scroll={{ x: '100%' }}
            size="small"
            style={{ width: '100%' }}
            expandable={{
              expandedRowKeys: expandedDates,
              onExpand: (expanded, record) => {
                if (expanded) {
                  setExpandedDates([...expandedDates, record.operation_date]);
                } else {
                  setExpandedDates(expandedDates.filter(date => date !== record.operation_date));
                }
              },
              expandedRowRender: (record) => {
                return (
                  <ExpandedDetailTable
                    date={record.operation_date}
                    getDateDetails={getDateDetails}
                    detailColumns={detailColumns}
                  />
                );
              },
            }}
          />
          <div className={styles.paginationWrapper}>
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={dailySummaryData?.total || 0}
              showSizeChanger
              showQuickJumper
              pageSizeOptions={[50, 100, 200, 500]}
              showTotal={(total) => `共 ${total} 天`}
              onChange={(page, size) => {
                setCurrentPage(page);
                setPageSize(size || 100);
              }}
            />
          </div>
        </Card>
      </div>

      {/* 订单详情Modal（统一组件） */}
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
          // 财务交易页面无需刷新
        }}
      />

      {/* 历史数据同步Modal */}
      <Modal
        title="同步历史财务数据"
        open={syncModalVisible}
        onCancel={handleCloseSyncModal}
        footer={
          syncing ? null : [
            <Button key="cancel" onClick={handleCloseSyncModal}>
              取消
            </Button>,
            <Button
              key="sync"
              type="primary"
              icon={<SyncOutlined />}
              onClick={handleStartSync}
              disabled={!syncMonth}
            >
              开始同步
            </Button>,
          ]
        }
        maskClosable={!syncing}
        closable={!syncing}
        width={480}
      >
        {syncing && syncProgress ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Progress
              type="circle"
              percent={Math.round(syncProgress.progress || 0)}
              status={syncProgress.status === 'failed' ? 'exception' : 'active'}
            />
            <div style={{ marginTop: 16, color: '#666' }}>
              {syncProgress.message}
            </div>
            {syncProgress.current > 0 && syncProgress.total > 0 && (
              <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                进度: {syncProgress.current} / {syncProgress.total}
              </div>
            )}
            {syncProgress.status === 'completed' && syncProgress.result && (
              <div style={{ marginTop: 16, color: '#52c41a' }}>
                同步完成: {syncProgress.result.synced || 0} 条记录
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>选择要同步的月份：</div>
              <DatePicker
                picker="month"
                value={syncMonth}
                onChange={setSyncMonth}
                style={{ width: '100%' }}
                placeholder="请选择月份"
                disabledDate={(current) => {
                  // 不能选择未来月份
                  return current && current.isAfter(dayjs(), 'month');
                }}
              />
            </div>
            <div style={{ color: '#666', fontSize: 12 }}>
              <p style={{ marginBottom: 4 }}>说明：</p>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                <li>将从 OZON 同步选定月份的所有财务交易记录</li>
                <li>已存在的记录会自动跳过，不会重复导入</li>
                <li>同步过程可能需要几分钟，请耐心等待</li>
                {selectedShop ? (
                  <li>仅同步当前选中店铺的数据</li>
                ) : (
                  <li>将同步所有店铺的数据</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default FinanceTransactions;
