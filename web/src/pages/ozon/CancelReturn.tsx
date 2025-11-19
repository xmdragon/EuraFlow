/**
 * OZON 取消和退货申请管理页面
 */
import { CloseCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Table,
  Tabs,
  Select,
  DatePicker,
  Input,
  Button,
  Tag,
  Row,
  Col,
  Space,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import React, { useState } from 'react';

import styles from './CancelReturn.module.scss';

import ColumnSetting from '@/components/ColumnSetting';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import {
  getCancellationStateText,
  getCancellationInitiatorText,
  getReturnGroupStateText,
  getReturnStateText,
} from '@/constants/ozonStatus';
import { useColumnSettings } from '@/hooks/useColumnSettings';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozonApi';
import { notifyError, notifySuccess } from '@/utils/notification';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Text } = Typography;
const { TabPane } = Tabs;

// 状态配置
const CANCELLATION_STATE_CONFIG: Record<string, { label: string; color: string }> = {
  ON_APPROVAL: { label: '待审核', color: 'orange' },
  APPROVED: { label: '已同意', color: 'green' },
  REJECTED: { label: '已拒绝', color: 'red' },
};

const RETURN_STATE_CONFIG: Record<string, { label: string; color: string }> = {
  ON_APPROVAL: { label: '待审核', color: 'orange' },
  WAITING_FOR_RECEIVE: { label: '待收货', color: 'blue' },
  RECEIVED: { label: '已收货', color: 'cyan' },
  REJECTED: { label: '已拒绝', color: 'red' },
  REFUNDED: { label: '已退款', color: 'green' },
};

const INITIATOR_CONFIG: Record<string, string> = {
  CLIENT: '客户',
  SELLER: '卖家',
  OZON: 'OZON',
  SYSTEM: '系统',
  DELIVERY: '配送',
};

const CancelReturn: React.FC = () => {
  const { formatDateTime } = useDateTime();
  const { copyToClipboard } = useCopy();

  // 状态管理（允许null表示"全部店铺"）
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<string>('cancellations');

  // 取消申请筛选
  const [cancellationFilters, setCancellationFilters] = useState({
    page: 1,
    limit: 50,
    state: undefined as string | undefined,
    initiator: undefined as string | undefined,
    posting_number: undefined as string | undefined,
    dateRange: [dayjs().subtract(30, 'days'), dayjs()] as [Dayjs | null, Dayjs | null] | null,
  });

  // 退货申请筛选
  const [returnFilters, setReturnFilters] = useState({
    page: 1,
    limit: 50,
    group_state: undefined as string | undefined,
    posting_number: undefined as string | undefined,
    offer_id: undefined as string | undefined,
    dateRange: [dayjs().subtract(30, 'days'), dayjs()] as [Dayjs | null, Dayjs | null] | null,
  });

  // 查询取消申请列表
  const {
    data: cancellationData,
    isLoading: loadingCancellations,
    refetch: refetchCancellations,
  } = useQuery({
    queryKey: ['cancellations', selectedShop, cancellationFilters],
    queryFn: async () => {
      const filter: ozonApi.CancellationFilter = {
        shop_id: selectedShop,
        page: cancellationFilters.page,
        limit: cancellationFilters.limit,
        state: cancellationFilters.state,
        initiator: cancellationFilters.initiator,
        posting_number: cancellationFilters.posting_number,
      };

      if (cancellationFilters.dateRange && cancellationFilters.dateRange[0] && cancellationFilters.dateRange[1]) {
        filter.date_from = cancellationFilters.dateRange[0].format('YYYY-MM-DD');
        filter.date_to = cancellationFilters.dateRange[1].format('YYYY-MM-DD');
      }

      return await ozonApi.getCancellations(filter);
    },
    enabled: activeTab === 'cancellations',
    staleTime: 30000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // 查询退货申请列表
  const { data: returnData, isLoading: loadingReturns, refetch: refetchReturns } = useQuery({
    queryKey: ['returns', selectedShop, returnFilters],
    queryFn: async () => {
      const filter: ozonApi.ReturnFilter = {
        shop_id: selectedShop,
        page: returnFilters.page,
        limit: returnFilters.limit,
        group_state: returnFilters.group_state,
        posting_number: returnFilters.posting_number,
        offer_id: returnFilters.offer_id,
      };

      if (returnFilters.dateRange && returnFilters.dateRange[0] && returnFilters.dateRange[1]) {
        filter.date_from = returnFilters.dateRange[0].format('YYYY-MM-DD');
        filter.date_to = returnFilters.dateRange[1].format('YYYY-MM-DD');
      }

      return await ozonApi.getReturns(filter);
    },
    enabled: activeTab === 'returns',
    staleTime: 30000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // 手动同步
  const handleSync = async () => {
    if (selectedShop === null) {
      notifyError('请先选择具体店铺，不支持同步全部店铺');
      return;
    }

    try {
      if (activeTab === 'cancellations') {
        await ozonApi.syncCancellations(selectedShop);
        notifySuccess('取消申请同步成功');
        refetchCancellations();
      } else {
        await ozonApi.syncReturns(selectedShop);
        notifySuccess('退货申请同步成功');
        refetchReturns();
      }
    } catch (error: any) {
      notifyError(error.response?.data?.detail?.detail || '同步失败');
    }
  };

  // 取消申请表格列
  const cancellationColumns: ColumnsType<ozonApi.Cancellation> = [
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 180,
      render: (text: string) => (
        <span className={styles.postingNumber} onClick={() => copyToClipboard(text, '货件编号')}>
          {text}
        </span>
      ),
    },
    {
      title: '订单日期',
      dataIndex: 'order_date',
      key: 'order_date',
      width: 160,
      render: (text: string | null) => (text ? formatDateTime(text) : '-'),
    },
    {
      title: '取消日期',
      dataIndex: 'cancelled_at',
      key: 'cancelled_at',
      width: 160,
      render: (text: string | null) => (text ? formatDateTime(text) : '-'),
    },
    {
      title: '发起人',
      dataIndex: 'cancellation_initiator',
      key: 'cancellation_initiator',
      width: 100,
      render: (text: string | null) => getCancellationInitiatorText(text || '', text || '-'),
    },
    {
      title: '取消原因',
      dataIndex: 'cancellation_reason_name',
      key: 'cancellation_reason_name',
      ellipsis: true,
      render: (text: string | null) => text || '-',
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (state: string) => {
        const config = CANCELLATION_STATE_CONFIG[state];
        const stateText = getCancellationStateText(state, state);
        return (
          <Tag color={config?.color || 'default'} className={styles.statusTag}>
            {stateText}
          </Tag>
        );
      },
    },
    {
      title: '自动确认日期',
      dataIndex: 'auto_approve_date',
      key: 'auto_approve_date',
      width: 160,
      render: (text: string | null) => (text ? formatDateTime(text) : '-'),
    },
  ];

  // 取消申请列配置
  const cancellationColumnSettings = useColumnSettings({
    columns: cancellationColumns,
    storageKey: 'ozon-cancellations-columns',
    defaultHiddenKeys: [], // 默认显示所有列
  });

  // 退货申请表格列
  const returnColumns: ColumnsType<ozonApi.Return> = [
    {
      title: '退货编号',
      dataIndex: 'return_number',
      key: 'return_number',
      width: 150,
      render: (text: string) => (
        <span className={styles.postingNumber} onClick={() => copyToClipboard(text, '退货编号')}>
          {text || '-'}
        </span>
      ),
    },
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 180,
      render: (text: string) => (
        <span className={styles.postingNumber} onClick={() => copyToClipboard(text, '货件编号')}>
          {text}
        </span>
      ),
    },
    {
      title: '订单号',
      dataIndex: 'order_number',
      key: 'order_number',
      width: 150,
      render: (text: string | null) => text || '-',
    },
    {
      title: '客户姓名',
      dataIndex: 'client_name',
      key: 'client_name',
      width: 100,
      render: (text: string | null) => text || '-',
    },
    {
      title: '商品名称',
      dataIndex: 'product_name',
      key: 'product_name',
      ellipsis: true,
      render: (text: string | null) => text || '-',
    },
    {
      title: 'Offer ID',
      dataIndex: 'offer_id',
      key: 'offer_id',
      width: 120,
      render: (text: string | null) => (text ? (
        <span className={styles.postingNumber} onClick={() => copyToClipboard(text, 'Offer ID')}>
          {text}
        </span>
      ) : '-'),
    },
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 120,
      render: (text: number | null) => text || '-',
    },
    {
      title: '退货金额',
      dataIndex: 'price',
      key: 'price',
      width: 120,
      align: 'right',
      render: (price: string | null, record: ozonApi.Return) => {
        if (!price) return '-';
        return `${parseFloat(price).toFixed(2)} ${record.currency_code || 'CNY'}`;
      },
    },
    {
      title: '状态组',
      dataIndex: 'group_state',
      key: 'group_state',
      width: 100,
      render: (state: string) => {
        const stateText = getReturnGroupStateText(state, state);
        const colorMap: Record<string, string> = {
          approved: 'green',
          arbitration: 'orange',
          delivering: 'blue',
          rejected: 'red',
          utilization: 'purple',
        };
        return (
          <Tag color={colorMap[state] || 'default'} className={styles.statusTag}>
            {stateText}
          </Tag>
        );
      },
    },
    {
      title: '详细状态',
      dataIndex: 'state',
      key: 'state',
      width: 120,
      render: (state: string) => {
        const stateText = getReturnStateText(state, state);
        return <span>{stateText}</span>;
      },
    },
    {
      title: '退款状态',
      dataIndex: 'money_return_state_name',
      key: 'money_return_state_name',
      width: 120,
      render: (text: string | null) => text || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at_ozon',
      key: 'created_at_ozon',
      width: 160,
      render: (text: string | null) => (text ? formatDateTime(text) : '-'),
    },
  ];

  // 退货申请列配置
  const returnColumnSettings = useColumnSettings({
    columns: returnColumns,
    storageKey: 'ozon-returns-columns',
    defaultHiddenKeys: ['return_number', 'order_number', 'client_name', 'sku'], // 默认隐藏部分列
  });

  return (
    <div className={styles.cancelReturnPage}>
      <PageTitle icon={<CloseCircleOutlined />} title="取消和退货申请" />

      {/* 筛选器 */}
      <Card className={styles.filterCard}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Row gutter={16} align="middle">
            <Col>
              <Space>
                <Text strong>选择店铺：</Text>
                <ShopSelector
                  value={selectedShop}
                  onChange={(value) => {
                    // 支持单选和"全部"（null）
                    const shopId = Array.isArray(value) ? value[0] : value;
                    setSelectedShop(shopId);
                  }}
                  showAllOption={true}
                  style={{ width: 200 }}
                  placeholder="请选择店铺"
                />
              </Space>
            </Col>
            <Col>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={handleSync}
                disabled={selectedShop === null}
              >
                同步数据
              </Button>
            </Col>
          </Row>

          {activeTab === 'cancellations' && (
            <Row gutter={16}>
              <Col>
                <Select
                  style={{ width: 120 }}
                  placeholder="状态"
                  allowClear
                  value={cancellationFilters.state}
                  onChange={(value) =>
                    setCancellationFilters({ ...cancellationFilters, state: value, page: 1 })
                  }
                >
                  <Option value="ON_APPROVAL">待审核</Option>
                  <Option value="APPROVED">已同意</Option>
                  <Option value="REJECTED">已拒绝</Option>
                </Select>
              </Col>
              <Col>
                <Select
                  style={{ width: 120 }}
                  placeholder="发起人"
                  allowClear
                  value={cancellationFilters.initiator}
                  onChange={(value) =>
                    setCancellationFilters({ ...cancellationFilters, initiator: value, page: 1 })
                  }
                >
                  <Option value="CLIENT">客户</Option>
                  <Option value="SELLER">卖家</Option>
                  <Option value="OZON">OZON</Option>
                  <Option value="SYSTEM">系统</Option>
                  <Option value="DELIVERY">配送</Option>
                </Select>
              </Col>
              <Col>
                <RangePicker
                  value={cancellationFilters.dateRange}
                  onChange={(dates) =>
                    setCancellationFilters({ ...cancellationFilters, dateRange: dates, page: 1 })
                  }
                  format="YYYY-MM-DD"
                />
              </Col>
              <Col>
                <Input
                  placeholder="搜索货件编号"
                  prefix={<SearchOutlined />}
                  style={{ width: 200 }}
                  allowClear
                  value={cancellationFilters.posting_number}
                  onChange={(e) =>
                    setCancellationFilters({
                      ...cancellationFilters,
                      posting_number: e.target.value,
                      page: 1,
                    })
                  }
                />
              </Col>
            </Row>
          )}

          {activeTab === 'returns' && (
            <Row gutter={16}>
              <Col>
                <Select
                  style={{ width: 120 }}
                  placeholder="状态组"
                  allowClear
                  value={returnFilters.group_state}
                  onChange={(value) =>
                    setReturnFilters({ ...returnFilters, group_state: value, page: 1 })
                  }
                >
                  <Option value="approved">已批准</Option>
                  <Option value="arbitration">仲裁中</Option>
                  <Option value="delivering">配送中</Option>
                  <Option value="rejected">已拒绝</Option>
                  <Option value="utilization">已处置</Option>
                </Select>
              </Col>
              <Col>
                <RangePicker
                  value={returnFilters.dateRange}
                  onChange={(dates) =>
                    setReturnFilters({ ...returnFilters, dateRange: dates, page: 1 })
                  }
                  format="YYYY-MM-DD"
                />
              </Col>
              <Col>
                <Input
                  placeholder="搜索货件编号"
                  prefix={<SearchOutlined />}
                  style={{ width: 200 }}
                  allowClear
                  value={returnFilters.posting_number}
                  onChange={(e) =>
                    setReturnFilters({ ...returnFilters, posting_number: e.target.value, page: 1 })
                  }
                />
              </Col>
              <Col>
                <Input
                  placeholder="搜索Offer ID"
                  prefix={<SearchOutlined />}
                  style={{ width: 200 }}
                  allowClear
                  value={returnFilters.offer_id}
                  onChange={(e) =>
                    setReturnFilters({ ...returnFilters, offer_id: e.target.value, page: 1 })
                  }
                />
              </Col>
            </Row>
          )}
        </Space>
      </Card>

      {/* 双Tab列表 */}
      <Card className={styles.tabsCard}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          tabBarExtraContent={
            activeTab === 'cancellations' ? (
              <ColumnSetting
                columnConfig={cancellationColumnSettings.columnConfig}
                onToggle={cancellationColumnSettings.toggleColumn}
                onShowAll={cancellationColumnSettings.showAllColumns}
                onReset={cancellationColumnSettings.resetColumns}
              />
            ) : (
              <ColumnSetting
                columnConfig={returnColumnSettings.columnConfig}
                onToggle={returnColumnSettings.toggleColumn}
                onShowAll={returnColumnSettings.showAllColumns}
                onReset={returnColumnSettings.resetColumns}
              />
            )
          }
        >
          <TabPane
            tab={`取消申请 (${cancellationData?.total || 0})`}
            key="cancellations"
          >
            <Table
              className={styles.compactTable}
              columns={cancellationColumnSettings.visibleColumns}
              dataSource={cancellationData?.items || []}
              rowKey="id"
              loading={loadingCancellations}
              pagination={{
                current: cancellationFilters.page,
                pageSize: cancellationFilters.limit,
                total: cancellationData?.total || 0,
                showTotal: (total) => `共 ${total} 条`,
                showSizeChanger: true,
                pageSizeOptions: ['20', '50', '100'],
                onChange: (page, pageSize) =>
                  setCancellationFilters({ ...cancellationFilters, page, limit: pageSize || 50 }),
              }}
              scroll={{ x: 1200 }}
            />
          </TabPane>

          <TabPane tab={`退货申请 (${returnData?.total || 0})`} key="returns">
            <Table
              className={styles.compactTable}
              columns={returnColumnSettings.visibleColumns}
              dataSource={returnData?.items || []}
              rowKey="id"
              loading={loadingReturns}
              pagination={{
                current: returnFilters.page,
                pageSize: returnFilters.limit,
                total: returnData?.total || 0,
                showTotal: (total) => `共 ${total} 条`,
                showSizeChanger: true,
                pageSizeOptions: ['20', '50', '100'],
                onChange: (page, pageSize) =>
                  setReturnFilters({ ...returnFilters, page, limit: pageSize || 50 }),
              }}
              scroll={{ x: 1400 }}
            />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default CancelReturn;
