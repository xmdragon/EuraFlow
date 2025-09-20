/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ozon 订单报表页面
 */
import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  message,
  Spin,
  Typography,
  Divider,
} from 'antd';
import {
  DownloadOutlined,
  FileExcelOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  PercentageOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import type { ColumnsType } from 'antd/es/table';

import ShopSelector from '@/components/ozon/ShopSelector';

const { Title } = Typography;
const { Option } = Select;

interface OrderReportData {
  date: string;
  shop_name: string;
  product_name: string;
  posting_number: string;
  purchase_price: string | null;
  sale_price: string;
  tracking_number: string | null;
  domestic_tracking_number: string | null;
  material_cost: string | null;
  order_notes: string | null;
  profit: string;
  sku?: string;
  quantity?: number;
  offer_id?: string;
}

interface ReportSummary {
  total_sales: string;
  total_purchase: string;
  total_cost: string;
  total_profit: string;
  profit_rate: number;
  order_count: number;
  month: string;
}

interface ReportResponse {
  summary: ReportSummary;
  data: OrderReportData[];
}

const OrderReport: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState(moment().format('YYYY-MM'));
  const [selectedShops, setSelectedShops] = useState<number[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // 获取报表数据
  const { data: reportData, isLoading, refetch } = useQuery<ReportResponse>({
    queryKey: ['ozonOrderReport', selectedMonth, selectedShops],
    queryFn: async () => {
      const shopIds = selectedShops.length > 0 ? selectedShops.join(',') : '';
      const response = await fetch(
        `/api/ef/v1/ozon/reports/orders?month=${selectedMonth}${
          shopIds ? `&shop_ids=${shopIds}` : ''
        }`
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '获取报表失败');
      }

      return response.json();
    },
    enabled: !!selectedMonth,
  });

  // 格式化金额
  const formatMoney = (value: string | number | null): string => {
    if (!value) return '¥0.00';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `¥${num.toFixed(2)}`;
  };

  // 格式化百分比
  const formatPercent = (value: number): string => {
    return `${value.toFixed(2)}%`;
  };

  // 表格列配置
  const columns: ColumnsType<OrderReportData> = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 100,
      fixed: 'left',
    },
    {
      title: '店铺名称',
      dataIndex: 'shop_name',
      key: 'shop_name',
      width: 120,
    },
    {
      title: '商品名称',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 200,
      ellipsis: true,
    },
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 150,
    },
    {
      title: '进货价格',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: 100,
      render: (value) => formatMoney(value),
      align: 'right',
    },
    {
      title: '出售价格',
      dataIndex: 'sale_price',
      key: 'sale_price',
      width: 100,
      render: (value) => formatMoney(value),
      align: 'right',
    },
    {
      title: '国际运单号',
      dataIndex: 'tracking_number',
      key: 'tracking_number',
      width: 150,
      render: (value) => value || '-',
    },
    {
      title: '国内运单号',
      dataIndex: 'domestic_tracking_number',
      key: 'domestic_tracking_number',
      width: 150,
      render: (value) => value || '-',
    },
    {
      title: '材料费用',
      dataIndex: 'material_cost',
      key: 'material_cost',
      width: 100,
      render: (value) => formatMoney(value),
      align: 'right',
    },
    {
      title: '备注',
      dataIndex: 'order_notes',
      key: 'order_notes',
      width: 200,
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: '利润',
      dataIndex: 'profit',
      key: 'profit',
      width: 100,
      fixed: 'right',
      render: (value) => {
        const profit = parseFloat(value || '0');
        return (
          <span style={{ color: profit >= 0 ? '#52c41a' : '#ff4d4f' }}>
            {formatMoney(value)}
          </span>
        );
      },
      align: 'right',
    },
  ];

  // 导出Excel
  const handleExport = async () => {
    try {
      setIsExporting(true);
      const shopIds = selectedShops.length > 0 ? selectedShops.join(',') : '';
      const url = `/api/ef/v1/ozon/reports/orders/export?month=${selectedMonth}${
        shopIds ? `&shop_ids=${shopIds}` : ''
      }`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('导出失败');
      }

      // 获取文件名
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename=(.+)/);
      const filename = filenameMatch ? filenameMatch[1] : `ozon_order_report_${selectedMonth}.xlsx`;

      // 下载文件
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      message.success('报表导出成功');
    } catch (error) {
      message.error('报表导出失败');
      console.error(error);
    } finally {
      setIsExporting(false);
    }
  };

  // 生成月份选项（最近12个月）
  const generateMonthOptions = () => {
    const options = [];
    const now = moment();

    for (let i = 0; i < 12; i++) {
      const month = now.clone().subtract(i, 'months');
      options.push({
        label: month.format('YYYY年MM月'),
        value: month.format('YYYY-MM'),
      });
    }

    return options;
  };

  const summary = reportData?.summary;

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <Title level={4}>订单报表</Title>

        {/* 筛选区域 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <label style={{ display: 'block', marginBottom: 8 }}>选择月份：</label>
            <Select
              value={selectedMonth}
              onChange={setSelectedMonth}
              style={{ width: '100%' }}
              options={generateMonthOptions()}
            />
          </Col>
          <Col span={10}>
            <label style={{ display: 'block', marginBottom: 8 }}>选择店铺：</label>
            <ShopSelector
              value={selectedShops}
              onChange={(value) => setSelectedShops(Array.isArray(value) ? value : [value])}
              mode="multiple"
              placeholder="全部店铺"
              style={{ width: '100%' }}
              showAllOption={false}
            />
          </Col>
          <Col span={8}>
            <label style={{ display: 'block', marginBottom: 8 }}>&nbsp;</label>
            <Space>
              <Button type="primary" onClick={() => refetch()}>
                查询
              </Button>
              <Button
                type="default"
                icon={<FileExcelOutlined />}
                onClick={handleExport}
                loading={isExporting}
              >
                导出Excel
              </Button>
            </Space>
          </Col>
        </Row>

        {/* 统计汇总卡片 */}
        {summary && (
          <>
            <Divider orientation="left">统计汇总</Divider>
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={4}>
                <Card>
                  <Statistic
                    title="销售总额"
                    value={summary.total_sales}
                    prefix="¥"
                    precision={2}
                    valueStyle={{ color: '#1890ff' }}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic
                    title="进货总额"
                    value={summary.total_purchase}
                    prefix="¥"
                    precision={2}
                    valueStyle={{ color: '#faad14' }}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic
                    title="费用总额"
                    value={summary.total_cost}
                    prefix="¥"
                    precision={2}
                    valueStyle={{ color: '#ff7875' }}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic
                    title="利润总额"
                    value={summary.total_profit}
                    prefix="¥"
                    precision={2}
                    valueStyle={{
                      color: parseFloat(summary.total_profit) >= 0 ? '#52c41a' : '#ff4d4f',
                    }}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic
                    title="利润率"
                    value={summary.profit_rate}
                    suffix="%"
                    precision={2}
                    valueStyle={{
                      color: summary.profit_rate >= 0 ? '#52c41a' : '#ff4d4f',
                    }}
                    prefix={summary.profit_rate >= 0 ? <RiseOutlined /> : null}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic
                    title="订单总数"
                    value={summary.order_count}
                    prefix={<ShoppingCartOutlined />}
                  />
                </Card>
              </Col>
            </Row>
          </>
        )}

        {/* 报表表格 */}
        <Divider orientation="left">订单明细</Divider>
        <Table
          columns={columns}
          dataSource={reportData?.data || []}
          loading={isLoading}
          rowKey={(record) => `${record.posting_number}_${record.sku}_${record.date}`}
          scroll={{ x: 1500, y: 500 }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`,
          }}
          summary={() => {
            if (!reportData?.data?.length) return null;

            // 计算当前页的汇总
            const pageData = reportData.data;
            const pageSales = pageData.reduce(
              (sum, item) => sum + parseFloat(item.sale_price || '0'),
              0
            );
            const pagePurchase = pageData.reduce(
              (sum, item) => sum + parseFloat(item.purchase_price || '0'),
              0
            );
            const pageCost = pageData.reduce(
              (sum, item) => sum + parseFloat(item.material_cost || '0'),
              0
            );
            const pageProfit = pageData.reduce(
              (sum, item) => sum + parseFloat(item.profit || '0'),
              0
            );

            return (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    <strong>本页合计</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <strong>{formatMoney(pagePurchase)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <strong>{formatMoney(pageSales)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6}>-</Table.Summary.Cell>
                  <Table.Summary.Cell index={7}>-</Table.Summary.Cell>
                  <Table.Summary.Cell index={8} align="right">
                    <strong>{formatMoney(pageCost)}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={9}>-</Table.Summary.Cell>
                  <Table.Summary.Cell index={10} align="right">
                    <strong style={{ color: pageProfit >= 0 ? '#52c41a' : '#ff4d4f' }}>
                      {formatMoney(pageProfit)}
                    </strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </Card>
    </div>
  );
};

export default OrderReport;