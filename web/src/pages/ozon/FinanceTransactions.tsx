/**
 * OZON 财务交易页面
 */
import { DollarOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Table,
  Select,
  Statistic,
  Row,
  Col,
  Pagination,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useState, useMemo } from 'react';

import styles from './FinanceTransactions.module.scss';

import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { ORDER_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';
import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozon';
import { notifyError } from '@/utils/notification';

const { Option } = Select;
const { Text } = Typography;

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
      // 完整月份：上半月、下半月、整月
      options.push({
        label: `${monthLabel} (1-15日)`,
        value: `${monthStart.format('YYYY-MM-DD')}|${mid15.format('YYYY-MM-DD')}`,
      });
      options.push({
        label: `${monthLabel} (16-${monthEnd.date()}日)`,
        value: `${mid16.format('YYYY-MM-DD')}|${monthEnd.format('YYYY-MM-DD')}`,
      });
      options.push({
        label: monthLabel,
        value: `${monthStart.format('YYYY-MM-DD')}|${monthEnd.format('YYYY-MM-DD')}`,
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

  // 生成周期选项
  const periodOptions = useMemo(() => generatePeriodOptions(), []);

  // 状态管理
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
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

  // 货币和状态配置
  const { currency: userCurrency } = useCurrency();
  const statusConfig = ORDER_STATUS_CONFIG;

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
      width: 145,
      render: (text, record) => {
        if (!text) return '-';
        // 只有数字-数字-数字格式才显示为链接
        if (isValidPostingNumber(text)) {
          return (
            <a
              onClick={() => {
                showPostingDetail(text, record.shop_id);
              }}
              style={{ cursor: 'pointer', color: '#1890ff' }}
            >
              {text}
            </a>
          );
        }
        return <span>{text}</span>;
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
      width: 110,
      render: (text) => text || '-',
    },
    {
      title: '商品名称',
      dataIndex: 'item_name',
      ellipsis: {
        showTitle: false,
      },
      render: (text) => {
        if (!text) return '-';
        return (
          <Text
            ellipsis={{
              tooltip: text,
            }}
          >
            {text}
          </Text>
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
      <PageTitle icon={<DollarOutlined />} title="财务交易" />

      <div className={styles.contentContainer}>
        <Card className={styles.filterCard}>
          <Row gutter={[16, 16]} align="middle">
            <Col>
              <span>选择店铺:</span>
            </Col>
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
            <Col span={5}>
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
            <Col span={5}>
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
            <Col span={5}>
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
            <Col span={5}>
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
    </div>
  );
};

export default FinanceTransactions;
