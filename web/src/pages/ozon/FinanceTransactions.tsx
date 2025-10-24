/**
 * OZON 财务交易页面
 */
import { DollarOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Input,
  Statistic,
  Row,
  Col,
  Pagination,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import React, { useState } from 'react';

import styles from './FinanceTransactions.module.scss';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import * as ozonApi from '@/services/ozonApi';
import { notifyInfo } from '@/utils/notification';

const { RangePicker } = DatePicker;
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

const FinanceTransactions: React.FC = () => {
  // 状态管理
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>([
    dayjs().subtract(7, 'days'),
    dayjs(),
  ]);
  const [transactionType, setTransactionType] = useState<string>('all');
  const [operationType, setOperationType] = useState<string>('');
  const [postingNumber, setPostingNumber] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

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
      if (!selectedShop) return null;

      const filter: ozonApi.FinanceTransactionsFilter = {
        shop_id: selectedShop,
        page: currentPage,
        page_size: pageSize,
      };

      if (dateRange && dateRange[0] && dateRange[1]) {
        filter.date_from = dateRange[0].format('YYYY-MM-DD');
        filter.date_to = dateRange[1].format('YYYY-MM-DD');
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
    enabled: selectedShop !== null,
    staleTime: 60000, // 1分钟缓存
  });

  // 查询汇总数据
  const { data: summaryData } = useQuery({
    queryKey: ['financeTransactionsSummary', selectedShop, dateRange, transactionType],
    queryFn: async () => {
      if (!selectedShop) return null;

      const dateFrom = dateRange?.[0]?.format('YYYY-MM-DD');
      const dateTo = dateRange?.[1]?.format('YYYY-MM-DD');
      const txType = transactionType !== 'all' ? transactionType : undefined;

      return await ozonApi.getFinanceTransactionsSummary(selectedShop, dateFrom, dateTo, txType);
    },
    enabled: selectedShop !== null,
    staleTime: 60000,
  });

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

  // 表格列定义
  const columns: ColumnsType<ozonApi.FinanceTransaction> = [
    {
      title: '操作日期',
      dataIndex: 'operation_date',
      width: 110,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      width: 140,
      render: (text) => text || '-',
    },
    {
      title: '操作类型',
      dataIndex: 'operation_type_name',
      width: 120,
      render: (text, record) => text || record.operation_type || '-',
    },
    {
      title: '交易类型',
      dataIndex: 'transaction_type',
      width: 100,
      render: (type: string) => TRANSACTION_TYPE_MAP[type] || type,
    },
    {
      title: '商品SKU',
      dataIndex: 'item_sku',
      width: 140,
      render: (text) => text || '-',
    },
    {
      title: '商品名称',
      dataIndex: 'item_name',
      width: 200,
      ellipsis: true,
      render: (text) => text || '-',
    },
    {
      title: '数量',
      dataIndex: 'item_quantity',
      width: 70,
      align: 'right',
      render: (qty) => qty || '-',
    },
    {
      title: '销售收入',
      dataIndex: 'accruals_for_sale',
      width: 110,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '总金额',
      dataIndex: 'amount',
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
      title: '配送费',
      dataIndex: 'delivery_charge',
      width: 100,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '退货配送费',
      dataIndex: 'return_delivery_charge',
      width: 110,
      align: 'right',
      render: formatAmount,
    },
    {
      title: '销售佣金',
      dataIndex: 'sale_commission',
      width: 100,
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
                disabled={!selectedShop}
              >
                导出CSV
              </Button>
            </Col>
          </Row>
        </Card>

        {/* 汇总统计卡片 */}
        {summaryData && selectedShop && (
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
              </Card>
            </Col>
          </Row>
        )}

        {/* 交易列表 */}
        <Card className={styles.listCard}>
          {!selectedShop ? (
            <div className={styles.emptyState}>
              <p>请先选择店铺</p>
            </div>
          ) : (
            <>
              <Table
                loading={isLoading}
                columns={columns}
                dataSource={transactionsData?.items || []}
                rowKey="id"
                pagination={false}
                scroll={{ x: 'max-content' }}
                size="small"
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
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

export default FinanceTransactions;
