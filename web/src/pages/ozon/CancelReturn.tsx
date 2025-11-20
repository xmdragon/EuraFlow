/**
 * OZON 取消和退货申请管理页面
 */
import { CloseCircleOutlined, ReloadOutlined, SearchOutlined, CopyOutlined, TranslationOutlined } from '@ant-design/icons';
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
  Tooltip,
  Modal,
  Descriptions,
  Spin,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import React, { useState } from 'react';

import styles from './CancelReturn.module.scss';

import ColumnSetting from '@/components/ColumnSetting';
import ProductImage from '@/components/ozon/ProductImage';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import {
  getCancellationStateText,
  getCancellationInitiatorText,
  getReturnGroupStateText,
  getReturnStateText,
} from '@/constants/ozonStatus';
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import { useColumnSettings } from '@/hooks/useColumnSettings';
import { useCopy } from '@/hooks/useCopy';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozonApi';
import { translateText } from '@/services/translationApi';
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
  const [activeTab, setActiveTab] = useState<string>('returns'); // 默认激活"退货申请"

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
    dateRange: [dayjs().subtract(30, 'days'), dayjs()] as [Dayjs | null, Dayjs | null] | null,
  });

  // 详情 Modal 状态
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedReturnId, setSelectedReturnId] = useState<number | null>(null);

  // 查询退货详情
  const { data: returnDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['returnDetail', selectedReturnId],
    queryFn: async () => {
      if (!selectedReturnId) return null;
      return await ozonApi.getReturnDetail(selectedReturnId);
    },
    enabled: !!selectedReturnId && detailModalVisible,
  });

  // 打开详情 Modal
  const handleOpenDetail = (returnId: number) => {
    setSelectedReturnId(returnId);
    setDetailModalVisible(true);
  };

  // 关闭详情 Modal
  const handleCloseDetail = () => {
    setDetailModalVisible(false);
    setSelectedReturnId(null);
  };

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

  // 取消申请同步轮询
  const { startPolling: startCancellationSync } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const result = await ozonApi.getSyncStatus(taskId);
      const status = result.data || result;

      // 转换为统一格式
      if (status.status === 'completed') {
        return { state: 'SUCCESS', result: status };
      } else if (status.status === 'failed') {
        return { state: 'FAILURE', error: status.error || status.message || '未知错误' };
      } else {
        return { state: 'PROGRESS', info: status };
      }
    },
    pollingInterval: 2000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'cancellation-sync',
    initialMessage: '取消申请同步进行中',
    onSuccess: (result) => {
      notifySuccess(`取消申请同步完成：${result.result?.records_synced || 0} 条记录`);
      refetchCancellations();
    },
    onFailure: (error) => {
      notifyError(`取消申请同步失败：${error}`);
    },
  });

  // 退货申请同步轮询
  const { startPolling: startReturnSync } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const result = await ozonApi.getSyncStatus(taskId);
      const status = result.data || result;

      // 转换为统一格式
      if (status.status === 'completed') {
        return { state: 'SUCCESS', result: status };
      } else if (status.status === 'failed') {
        return { state: 'FAILURE', error: status.error || status.message || '未知错误' };
      } else {
        return { state: 'PROGRESS', info: status };
      }
    },
    pollingInterval: 2000,
    timeout: 30 * 60 * 1000,
    notificationKey: 'return-sync',
    initialMessage: '退货申请同步进行中',
    onSuccess: (result) => {
      notifySuccess(`退货申请同步完成：${result.result?.records_synced || 0} 条记录`);
      refetchReturns();
    },
    onFailure: (error) => {
      notifyError(`退货申请同步失败：${error}`);
    },
  });

  // 手动同步（异步）
  const handleSync = async () => {
    if (selectedShop === null) {
      notifyError('请先选择具体店铺，不支持同步全部店铺');
      return;
    }

    try {
      if (activeTab === 'cancellations') {
        // 启动取消申请同步
        const response = await ozonApi.syncCancellations(selectedShop);
        const taskId = response.data.task_id;

        // 开始轮询任务状态
        startCancellationSync(taskId);
      } else {
        // 启动退货申请同步
        const response = await ozonApi.syncReturns(selectedShop);
        const taskId = response.data.task_id;

        // 开始轮询任务状态
        startReturnSync(taskId);
      }
    } catch (error: any) {
      notifyError(error.response?.data?.detail?.detail || '同步启动失败');
    }
  };

  // 取消申请表格列
  const cancellationColumns: ColumnsType<ozonApi.Cancellation> = [
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 160,
      render: (text: string) => (
        <div>
          <span className={styles.postingNumber}>{text}</span>
          <CopyOutlined
            style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
            onClick={() => copyToClipboard(text, '货件编号')}
          />
        </div>
      ),
    },
    {
      title: '订单日期',
      dataIndex: 'order_date',
      key: 'order_date',
      width: 80,
      render: (text: string | null) => (text ? formatDateTime(text) : '-'),
    },
    {
      title: '取消日期',
      dataIndex: 'cancelled_at',
      key: 'cancelled_at',
      width: 80,
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
      width: 80,
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
      title: '图片',
      dataIndex: 'image_url',
      key: 'product_image',
      width: 100,
      render: (_: string | null, record: ozonApi.Return) => (
        <ProductImage
          imageUrl={record.image_url || undefined}
          size="small"
          hoverBehavior="none"
          name={record.product_name || ''}
          offerId={record.offer_id || undefined}
          sku={record.sku?.toString() || undefined}
          disablePreview={false}
        />
      ),
    },
    {
      title: '申请号',
      dataIndex: 'return_number',
      key: 'return_number',
      width: 150,
      render: (text: string, record: ozonApi.Return) => {
        // 优先显示 return_number，如果为空则显示 return_id
        const displayNumber = text || String(record.return_id);
        return (
          <span
            style={{ cursor: 'pointer', color: '#1890ff' }}
            onClick={() => handleOpenDetail(record.return_id)}
          >
            {displayNumber}
          </span>
        );
      },
    },
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 160,
      render: (text: string) => (
        <div>
          <span>{text}</span>
          <CopyOutlined
            style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
            onClick={() => copyToClipboard(text, '货件编号')}
          />
        </div>
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
      render: (text: string | null) => (
        <div>
          {text ? (
            <>
              <span>{text}</span>
              <CopyOutlined
                style={{ marginLeft: 8, cursor: 'pointer', color: '#1890ff' }}
                onClick={() => copyToClipboard(text, 'Offer ID')}
              />
            </>
          ) : (
            '-'
          )}
        </div>
      ),
    },
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 90,
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
      title: '退货原因',
      dataIndex: 'return_reason_name',
      key: 'return_reason_name',
      width: 80,
      ellipsis: true,
      render: (text: string | null) => text || '-',
    },
    {
      title: '配送',
      dataIndex: 'delivery_method_name',
      key: 'delivery_method_name',
      width: 200,
      ellipsis: true,
      render: (text: string | null) => {
        if (!text) return '-';

        // 解析配送方式：提取主要部分和括号内容
        const match = text.match(/^([^（(]+)[\s]*[（(](.+)[)）]$/);
        if (match) {
          const mainPart = match[1].trim();
          const detailPart = `（${match[2]}）`;
          return (
            <Tooltip title={detailPart}>
              <span>{mainPart}</span>
            </Tooltip>
          );
        }

        return text;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at_ozon',
      key: 'created_at_ozon',
      width: 100,
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
                  placeholder="搜索货件编号或SKU"
                  prefix={<SearchOutlined />}
                  style={{ width: 250 }}
                  allowClear
                  value={returnFilters.posting_number}
                  onChange={(e) =>
                    setReturnFilters({ ...returnFilters, posting_number: e.target.value, page: 1 })
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

      {/* 退货详情 Modal */}
      <Modal
        title="退货申请详情"
        open={detailModalVisible}
        onCancel={handleCloseDetail}
        footer={[
          <Button key="close" onClick={handleCloseDetail}>
            关闭
          </Button>,
        ]}
        width={800}
      >
        {loadingDetail ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin />
          </div>
        ) : returnDetail ? (
          <>
            {/* 商品图片 */}
            {returnDetail.image_url && (
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <ProductImage
                  imageUrl={returnDetail.image_url}
                  size="medium"
                  name={returnDetail.product_name || ''}
                  offerId={returnDetail.offer_id || undefined}
                  sku={returnDetail.sku?.toString() || undefined}
                  hoverBehavior="none"
                />
              </div>
            )}

            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="申请号" span={2}>
                {returnDetail.return_number || returnDetail.return_id}
              </Descriptions.Item>
              <Descriptions.Item label="货件编号" span={2}>
                {returnDetail.posting_number}
              </Descriptions.Item>
              <Descriptions.Item label="订单号">
                {returnDetail.order_number || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="客户姓名">
                {returnDetail.client_name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="商品名称" span={2}>
                {returnDetail.product_name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Offer ID">
                {returnDetail.offer_id || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="SKU">
                {returnDetail.sku || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="价格">
                {returnDetail.price ? `${Number(returnDetail.price).toFixed(2)} ${returnDetail.currency_code}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="配送方式">
                {returnDetail.delivery_method_name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="状态组">
                <Tag color={RETURN_STATE_CONFIG[returnDetail.group_state]?.color || 'default'}>
                  {getReturnGroupStateText(returnDetail.group_state)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="详细状态">
                {getReturnStateText(returnDetail.state) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="退款状态" span={2}>
                {returnDetail.money_return_state_name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="退货原因" span={2}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{returnDetail.return_reason_name || '-'}</span>
                  {returnDetail.return_reason_name && (
                    <Button
                      type="link"
                      size="small"
                      icon={<TranslationOutlined />}
                      onClick={async () => {
                        const russianText = returnDetail.return_reason_name;
                        if (russianText) {
                          try {
                            const translation = await translateText(russianText, 'ru', 'zh');
                            Modal.info({
                              title: '翻译结果',
                              content: (
                                <div>
                                  <p><strong>原文（俄语）：</strong></p>
                                  <p>{russianText}</p>
                                  <p style={{ marginTop: 16 }}><strong>译文（中文）：</strong></p>
                                  <p>{translation}</p>
                                </div>
                              ),
                              width: 500,
                            });
                          } catch (error) {
                            notifyError('翻译失败，请稍后重试');
                          }
                        }
                      }}
                      style={{ padding: 0 }}
                    >
                      翻译
                    </Button>
                  )}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="拒绝原因" span={2}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{returnDetail.rejection_reason_name || '-'}</span>
                  {returnDetail.rejection_reason_name && (
                    <Button
                      type="link"
                      size="small"
                      icon={<TranslationOutlined />}
                      onClick={async () => {
                        const russianText = returnDetail.rejection_reason_name;
                        if (russianText) {
                          try {
                            const translation = await translateText(russianText, 'ru', 'zh');
                            Modal.info({
                              title: '翻译结果',
                              content: (
                                <div>
                                  <p><strong>原文（俄语）：</strong></p>
                                  <p>{russianText}</p>
                                  <p style={{ marginTop: 16 }}><strong>译文（中文）：</strong></p>
                                  <p>{translation}</p>
                                </div>
                              ),
                              width: 500,
                            });
                          } catch (error) {
                            notifyError('翻译失败，请稍后重试');
                          }
                        }
                      }}
                      style={{ padding: 0 }}
                    >
                      翻译
                    </Button>
                  )}
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="退货方式" span={2}>
                {returnDetail.return_method_description || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间" span={2}>
                {returnDetail.created_at_ozon ? formatDateTime(returnDetail.created_at_ozon) : '-'}
              </Descriptions.Item>
            </Descriptions>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Text type="secondary">未找到详情数据</Text>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CancelReturn;
