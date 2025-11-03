/**
 * OZON 财务交易页面
 */
import { DollarOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Select,
  DatePicker,
  Input,
  Statistic,
  Row,
  Col,
  Pagination,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import React, { useState, useMemo } from 'react';

import styles from './FinanceTransactions.module.scss';

import OrderDetailModal from '@/components/ozon/OrderDetailModal';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { ORDER_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';
import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozonApi';
import { notifyInfo, notifyError } from '@/utils/notification';

const { RangePicker } = DatePicker;
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

const FinanceTransactions: React.FC = () => {
  const { formatDate, toUTCRange } = useDateTime();
  // 状态管理
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>([
    dayjs().subtract(45, 'days'),
    dayjs(),
  ]);
  const [transactionType, setTransactionType] = useState<string>('all');
  const [operationType, setOperationType] = useState<string>('');
  const [postingNumber, setPostingNumber] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // 订单详情Modal状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 货币和状态配置
  const { currency: userCurrency } = useCurrency();
  const statusConfig = ORDER_STATUS_CONFIG;

  // 查询财务交易列表
  const { data: transactionsData, isLoading } = useQuery({
    queryKey: [
      'financeTransactions',
      selectedShop,
      dateRange,
      transactionType,
      operationType,
      postingNumber,
      currentPage,
      pageSize,
    ],
    queryFn: async () => {
      const filter: ozonApi.FinanceTransactionsFilter = {
        shop_id: selectedShop,
        page: currentPage,
        page_size: pageSize,
      };

      if (dateRange && dateRange[0] && dateRange[1]) {
        filter.date_from = toUTCRange(dateRange[0], false);
        filter.date_to = toUTCRange(dateRange[1], true);
      }

      if (transactionType && transactionType !== 'all') {
        filter.transaction_type = transactionType;
      }

      if (operationType) {
        filter.operation_type = operationType;
      }

      if (postingNumber) {
        filter.posting_number = postingNumber.trim();
      }

      return await ozonApi.getFinanceTransactions(filter);
    },
    staleTime: 60000, // 1分钟缓存
  });

  // 查询汇总数据
  const { data: summaryData } = useQuery({
    queryKey: ['financeTransactionsSummary', selectedShop, dateRange, transactionType],
    queryFn: async () => {
      const dateFrom = dateRange?.[0] ? toUTCRange(dateRange[0], false) : undefined;
      const dateTo = dateRange?.[1] ? toUTCRange(dateRange[1], true) : undefined;
      const txType = transactionType !== 'all' ? transactionType : undefined;

      return await ozonApi.getFinanceTransactionsSummary(selectedShop, dateFrom, dateTo, txType);
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

  // offer_id到图片的映射（财务交易没有商品图片，返回空映射）
  const offerIdImageMap = useMemo(() => {
    return {};
  }, []);

  // 格式化配送方式文本（用于白色背景显示）
  const formatDeliveryMethodTextWhite = (text: string | undefined): React.ReactNode => {
    if (!text) return '-';

    // 如果包含括号，提取括号内的内容
    const match = text.match(/^(.+?)[\(（](.+?)[\)）]$/);
    if (!match) return text;

    const mainPart = match[1].trim();
    const detailPart = match[2].trim();

    // 解析限制信息为三行：重量、价格、体积
    const parseRestrictions = (restriction: string): string[] => {
      // 移除"限制:"前缀
      const content = restriction.replace(/^限制[:：]\s*/, '');

      // 使用正则提取三个部分
      const parts: string[] = [];
      const weightMatch = content.match(/重量[:：\s]*([^，,]+)/);
      const priceMatch = content.match(/价格[:：\s]*([^，,]+)/);
      const volumeMatch = content.match(/体积[:：\s]*(.+)$/);

      if (weightMatch) parts.push(weightMatch[1].trim());
      if (priceMatch) parts.push(priceMatch[1].trim());
      if (volumeMatch) parts.push(volumeMatch[1].trim());

      return parts;
    };

    const restrictions = parseRestrictions(detailPart);

    return (
      <div>
        <div>{mainPart}</div>
        {restrictions.map((line, idx) => (
          <div key={idx} style={{ fontSize: '12px', color: '#666' }}>
            {line}
          </div>
        ))}
      </div>
    );
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
        setDetailModalVisible(true);
      }
    } catch (error) {
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

  // 导出CSV
  const handleExport = () => {
    notifyInfo('提示', 'CSV导出功能开发中');
  };

  // 判断货件编号是否为有效格式（数字-数字-数字）
  const isValidPostingNumber = (postingNumber: string): boolean => {
    return /^\d+-\d+-\d+$/.test(postingNumber);
  };

  // 表格列定义
  const columns: ColumnsType<ozonApi.FinanceTransaction> = [
    {
      title: '操作日期',
      dataIndex: 'operation_date',
      width: 110,
      ellipsis: true,
      render: (date: string) => formatDate(date),
    },
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      width: 160,
      ellipsis: true,
      render: (text, record) => {
        if (!text) return '-';
        // 只有数字-数字-数字格式才显示为链接
        if (isValidPostingNumber(text)) {
          return (
            <a
              onClick={() => {
                // 使用交易记录中的 shop_id，而不是全局选择的店铺
                showPostingDetail(text, record.shop_id);
              }}
              style={{ cursor: 'pointer', color: '#1890ff' }}
            >
              {text}
            </a>
          );
        }
        // 其它格式显示为纯文本
        return <span>{text}</span>;
      },
    },
    {
      title: '操作类型',
      dataIndex: 'operation_type_name',
      width: 170,
      ellipsis: true,
      render: (text, record) => text || record.operation_type || '-',
    },
    {
      title: '交易类型',
      dataIndex: 'transaction_type',
      width: 80,
      ellipsis: true,
      render: (type: string) => TRANSACTION_TYPE_MAP[type] || type,
    },
    {
      title: '商品SKU',
      dataIndex: 'ozon_sku',
      width: 90,
      ellipsis: true,
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
        const displayText = text.length > 50 ? text.substring(0, 50) + '...' : text;
        return (
          <Text
            ellipsis={{
              tooltip: text.length > 50 ? text : undefined,
            }}
          >
            {displayText}
          </Text>
        );
      },
    },
    {
      title: '销售收入',
      dataIndex: 'accruals_for_sale',
      width: 110,
      align: 'right',
      ellipsis: true,
      render: formatAmount,
    },
    {
      title: '总金额',
      dataIndex: 'amount',
      width: 110,
      align: 'right',
      ellipsis: true,
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
      width: 100,
      align: 'right',
      ellipsis: true,
      render: formatAmount,
    },
    {
      title: '退货配送费',
      dataIndex: 'return_delivery_charge',
      width: 110,
      align: 'right',
      ellipsis: true,
      render: formatAmount,
    },
    {
      title: '销售佣金',
      dataIndex: 'sale_commission',
      width: 100,
      align: 'right',
      ellipsis: true,
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
              <RangePicker
                value={dateRange}
                onChange={(dates) => {
                  setDateRange(dates);
                  setCurrentPage(1);
                }}
                format="YYYY-MM-DD"
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
            <Col>
              <Input
                placeholder="操作类型"
                value={operationType}
                onChange={(e) => setOperationType(e.target.value)}
                onPressEnter={() => setCurrentPage(1)}
                allowClear
                style={{ width: 150 }}
              />
            </Col>
            <Col>
              <Input
                placeholder="货件编号"
                value={postingNumber}
                onChange={(e) => setPostingNumber(e.target.value)}
                onPressEnter={() => setCurrentPage(1)}
                prefix={<SearchOutlined />}
                allowClear
                style={{ width: 180 }}
              />
            </Col>
            <Col>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleExport}
              >
                导出CSV
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

        {/* 交易列表 */}
        <Card className={styles.listCard}>
          <Table
            loading={isLoading}
            columns={columns}
            dataSource={transactionsData?.items || []}
            rowKey="id"
            pagination={false}
            scroll={{ x: '100%' }}
            size="small"
            style={{ width: '100%' }}
          />
          <div className={styles.paginationWrapper}>
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={transactionsData?.total || 0}
              showSizeChanger
              showQuickJumper
              pageSizeOptions={[50, 100, 200, 500]}
              showTotal={(total) => `共 ${total} 条记录`}
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
