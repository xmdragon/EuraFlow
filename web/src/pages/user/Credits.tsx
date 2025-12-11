/**
 * 额度中心页面 - 用户查看余额和消费记录
 */
import {
  WalletOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Statistic,
  Row,
  Col,
  Table,
  DatePicker,
  Space,
  Tag,
  Typography,
  Spin,
  Empty,
  Button,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useState } from 'react';

import PageTitle from '@/components/PageTitle';
import * as creditApi from '@/services/credit';
import type { CreditTransaction } from '@/types/credit';

import styles from './UserPages.module.scss';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const Credits: React.FC = () => {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 获取余额信息
  const { data: balance, isLoading: balanceLoading, refetch: refetchBalance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: creditApi.getBalance,
  });

  // 获取交易记录
  const { data: transactions, isLoading: transactionsLoading, refetch: refetchTransactions } = useQuery({
    queryKey: ['credit-transactions', dateRange, page, pageSize],
    queryFn: () =>
      creditApi.getTransactions({
        start_date: dateRange[0]?.format('YYYY-MM-DD'),
        end_date: dateRange[1]?.format('YYYY-MM-DD'),
        page,
        page_size: pageSize,
      }),
  });

  // 交易类型配置
  const transactionTypeConfig: Record<string, { color: string; label: string }> = {
    recharge: { color: 'green', label: '充值' },
    consume: { color: 'red', label: '消费' },
    refund: { color: 'blue', label: '退还' },
    adjust: { color: 'orange', label: '调整' },
  };

  // 模块名称映射
  const moduleNameMap: Record<string, string> = {
    print_label: '打印面单',
  };

  // 表格列定义
  const columns: ColumnsType<CreditTransaction> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '类型',
      dataIndex: 'transaction_type',
      key: 'transaction_type',
      width: 80,
      render: (type: string) => {
        const config = transactionTypeConfig[type] || { color: 'default', label: type };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '模块',
      dataIndex: 'module',
      key: 'module',
      width: 100,
      render: (module: string | null) => module ? (moduleNameMap[module] || module) : '-',
    },
    {
      title: balance?.credit_name || '积分',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (amount: string) => {
        const num = parseFloat(amount);
        const color = num >= 0 ? '#52c41a' : '#ff4d4f';
        const prefix = num >= 0 ? '+' : '';
        return <Text style={{ color }}>{prefix}{num.toFixed(2)}</Text>;
      },
    },
    {
      title: '余额',
      dataIndex: 'balance_after',
      key: 'balance_after',
      width: 120,
      align: 'right',
      render: (balance: string) => parseFloat(balance).toFixed(2),
    },
    {
      title: '操作人',
      dataIndex: 'operator_username',
      key: 'operator_username',
      width: 100,
    },
    {
      title: '明细',
      dataIndex: 'details',
      key: 'details',
      ellipsis: true,
      render: (details: CreditTransaction['details']) => {
        if (!details) return '-';
        if (details.posting_numbers && details.posting_numbers.length > 0) {
          const count = details.posting_numbers.length;
          const display = details.posting_numbers.slice(0, 3).join(', ');
          return count > 3 ? `${display}... 共${count}个` : display;
        }
        return '-';
      },
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      ellipsis: true,
      render: (notes: string | null) => notes || '-',
    },
  ];

  const handleRefresh = () => {
    refetchBalance();
    refetchTransactions();
  };

  if (balanceLoading) {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <PageTitle title="额度中心" />

      {/* 余额卡片 */}
      <Card className={styles.balanceCard}>
        <Row gutter={24}>
          <Col xs={24} sm={8}>
            <Statistic
              title={`当前${balance?.credit_name || '积分'}`}
              value={parseFloat(balance?.balance || '0').toFixed(2)}
              prefix={<WalletOutlined />}
              valueStyle={{
                color: balance?.is_low_balance ? '#ff4d4f' : '#1890ff',
                fontSize: 32,
              }}
            />
            {balance?.is_low_balance && (
              <Text type="danger" style={{ fontSize: 12 }}>
                余额不足预警阈值 ({parseFloat(balance.low_balance_threshold).toFixed(0)})
              </Text>
            )}
          </Col>
          <Col xs={12} sm={8}>
            <Statistic
              title="累计充值"
              value={parseFloat(balance?.total_recharged || '0').toFixed(2)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
          <Col xs={12} sm={8}>
            <Statistic
              title="累计消费"
              value={parseFloat(balance?.total_consumed || '0').toFixed(2)}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Col>
        </Row>
        {balance?.account_username && (
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">
              账户所有者：{balance.account_username}
            </Text>
          </div>
        )}
      </Card>

      {/* 交易记录 */}
      <Card
        title={
          <Space>
            <HistoryOutlined />
            交易记录
          </Space>
        }
        extra={
          <Space>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null]);
                setPage(1);
              }}
              allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
              刷新
            </Button>
          </Space>
        }
        style={{ marginTop: 16 }}
      >
        <Table
          columns={columns}
          dataSource={transactions?.items || []}
          rowKey="id"
          loading={transactionsLoading}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: transactions?.total || 0,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          scroll={{ x: 1000 }}
          locale={{
            emptyText: <Empty description="暂无交易记录" />,
          }}
        />
      </Card>
    </div>
  );
};

export default Credits;
