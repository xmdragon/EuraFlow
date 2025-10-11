/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */
/**
 * Ozon 订单列表页面
 */
import {
  SyncOutlined,
  PrinterOutlined,
  TruckOutlined,
  DownloadOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ShoppingCartOutlined,
  PhoneOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Space,
  Card,
  Row,
  Col,
  Statistic,
  Input,
  Select,
  Tag,
  Modal,
  message,
  DatePicker,
  Tooltip,
  Badge,
  Descriptions,
  Tabs,
  Form,
  Alert,
  Dropdown,
  Typography,
  Progress,
  Avatar,
  Flex,
  Table,
  InputNumber,
  Divider,
} from 'antd';
import moment from 'moment';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozonApi';
import { formatRuble } from '../../utils/currency';
import ShopSelector from '@/components/ozon/ShopSelector';
import styles from './OrderList.module.scss';

const { RangePicker } = DatePicker;
const { Option } = Select;
const { confirm } = Modal;
const { Text } = Typography;

// 额外信息表单组件
interface ExtraInfoFormProps {
  selectedOrder: ozonApi.Order | null;
  setIsUpdatingExtraInfo: (loading: boolean) => void;
}

const ExtraInfoForm: React.FC<ExtraInfoFormProps> = ({ selectedOrder, setIsUpdatingExtraInfo }) => {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // 当选中订单变化时，更新表单
  useEffect(() => {
    if (selectedOrder) {
      form.setFieldsValue({
        purchase_price: selectedOrder.purchase_price || '',
        domestic_tracking_number: selectedOrder.domestic_tracking_number || '',
        material_cost: selectedOrder.material_cost || '',
        order_notes: selectedOrder.order_notes || '',
      });
    } else {
      form.resetFields();
    }
  }, [selectedOrder, form]);

  const handleFinish = async (values: any) => {
    try {
      setIsUpdatingExtraInfo(true);

      // 调用API更新订单额外信息
      const response = await fetch(
        `/api/ef/v1/ozon/orders/${selectedOrder?.posting_number}/extra-info`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(values),
        }
      );

      if (!response.ok) {
        throw new Error('更新失败');
      }

      message.success('订单额外信息更新成功');

      // 刷新列表
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    } catch (error) {
      message.error('更新失败: ' + (error as Error).message);
    } finally {
      setIsUpdatingExtraInfo(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish}>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="purchase_price"
            label="进货价格"
            tooltip="商品的采购成本"
            rules={[
              {
                pattern: /^\d+(\.\d{1,2})?$/,
                message: '请输入有效的价格（最多2位小数）',
              },
            ]}
          >
            <Input placeholder="进货价格" prefix="₽" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="material_cost"
            label="物料成本"
            tooltip="包装、标签等物料成本"
            rules={[
              {
                pattern: /^\d+(\.\d{1,2})?$/,
                message: '请输入有效的价格（最多2位小数）',
              },
            ]}
          >
            <Input placeholder="物料成本" prefix="₽" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="domestic_tracking_number"
            label="国内物流单号"
            tooltip="国内物流配送的跟踪单号"
          >
            <Input placeholder="国内物流单号" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="tracking_number"
            label="国际物流单号"
            tooltip="国际物流的跟踪单号"
          >
            <Input placeholder="国际物流单号" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item
        name="order_notes"
        label="订单备注"
        tooltip="订单相关的备注信息"
      >
        <Input.TextArea
          placeholder="订单备注"
          autoSize={{ minRows: 3, maxRows: 6 }}
        />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit">
            保存信息
          </Button>
          <Button onClick={() => form.resetFields()}>
            重置
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );
};

const OrderList: React.FC = () => {
  const queryClient = useQueryClient();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedOrders, _setSelectedOrders] = useState<ozonApi.Order[]>([]);
  // 初始化时从localStorage读取店铺选择，默认为null让ShopSelector自动选择第一个
  const [selectedShop, setSelectedShop] = useState<number | null>(() => {
    const saved = localStorage.getItem('ozon_selected_shop');
    if (saved && saved !== 'all' && saved !== '') {
      return parseInt(saved, 10);
    }
    return null; // 默认null，让ShopSelector自动选择第一个店铺
  });
  const [filterForm] = Form.useForm();
  const [shipForm] = Form.useForm();
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [shipModalVisible, setShipModalVisible] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ozonApi.Order | null>(null);
  const [selectedPosting, setSelectedPosting] = useState<ozonApi.Posting | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [isUpdatingExtraInfo, setIsUpdatingExtraInfo] = useState(false);

  // 搜索参数状态
  const [searchParams, setSearchParams] = useState<any>({});

  // 状态配置
  const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
    pending: { color: 'default', text: '待确认', icon: <ClockCircleOutlined /> },
    confirmed: { color: 'processing', text: '已确认', icon: <CheckCircleOutlined /> },
    processing: { color: 'processing', text: '处理中', icon: <SyncOutlined spin /> },
    awaiting_packaging: { color: 'processing', text: '等待备货', icon: <ClockCircleOutlined /> },
    awaiting_deliver: { color: 'warning', text: '等待发运', icon: <TruckOutlined /> },
    delivering: { color: 'cyan', text: '运输中', icon: <TruckOutlined /> },
    shipped: { color: 'cyan', text: '已发货', icon: <TruckOutlined /> },
    delivered: { color: 'success', text: '已签收', icon: <CheckCircleOutlined /> },
    cancelled: { color: 'error', text: '已取消', icon: <CloseCircleOutlined /> },
  };

  // 查询订单列表
  const {
    data: ordersData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['ozonOrders', currentPage, pageSize, activeTab, selectedShop, searchParams],
    queryFn: () => {
      const dateRange = searchParams.dateRange;

      return ozonApi.getOrders(currentPage, pageSize, {
        ...searchParams,
        shop_id: selectedShop,
        status: activeTab === 'all' ? undefined : activeTab,
        date_from: dateRange?.[0]?.format('YYYY-MM-DD'),
        date_to: dateRange?.[1]?.format('YYYY-MM-DD'),
        dateRange: undefined,
      });
    },
    enabled: !!selectedShop, // 只在选择店铺后查询
    refetchInterval: 60000, // 1分钟自动刷新
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
    staleTime: 10000, // 数据10秒内不会被认为是过期的
  });

  // 展开订单数据为货件维度（PostingWithOrder 数组）
  const postingsData = React.useMemo<ozonApi.PostingWithOrder[]>(() => {
    if (!ordersData?.data) return [];

    const flattened: ozonApi.PostingWithOrder[] = [];
    ordersData.data.forEach((order: ozonApi.Order) => {
      // 如果订单有 postings，展开每个 posting
      if (order.postings && order.postings.length > 0) {
        order.postings.forEach((posting) => {
          flattened.push({
            ...posting,
            order: order  // 关联完整的订单信息
          });
        });
      } else {
        // 如果订单没有 postings，使用订单本身的 posting_number 创建一个虚拟 posting
        // 这是为了兼容可能存在的没有 postings 数组的订单
        if (order.posting_number) {
          flattened.push({
            id: order.id,
            posting_number: order.posting_number,
            status: order.status,
            shipment_date: order.shipment_date,
            delivery_method_name: order.delivery_method,
            warehouse_name: order.warehouse_name,
            packages_count: 1,
            is_cancelled: order.status === 'cancelled',
            order: order
          } as ozonApi.PostingWithOrder);
        }
      }
    });

    // 如果用户搜索了 posting_number，进行二次过滤，只保留匹配的货件
    const searchPostingNumber = searchParams.posting_number?.trim();
    if (searchPostingNumber) {
      return flattened.filter(posting =>
        posting.posting_number.toLowerCase().includes(searchPostingNumber.toLowerCase())
      );
    }

    return flattened;
  }, [ordersData, searchParams.posting_number]);

  // 使用统一的货币格式化函数
  const formatPrice = (price: any): string => {
    return formatRuble(price).replace('₽', '').trim(); // 返回不带符号的格式化数字
  };

  // offer_id到图片的映射，从订单数据中提取
  const offerIdImageMap = React.useMemo(() => {
    const map: Record<string, string> = {};

    // 从订单响应中获取offer_id图片映射
    if (ordersData?.offer_id_images) {
      Object.assign(map, ordersData.offer_id_images);
    }

    // 同时从订单项中提取图片（作为备用）
    if (ordersData?.data) {
      ordersData.data.forEach((order: any) => {
        if (order.items) {
          order.items.forEach((item: any) => {
            if (item.offer_id && item.image && !map[item.offer_id]) {
              map[item.offer_id] = item.image;
            }
          });
        }
      });
    }

    return map;
  }, [ordersData]);

  // 获取订单项的图片
  const getOrderItemImage = (order: ozonApi.Order): string => {
    if (!order.items || order.items.length === 0) {
      return '';
    }

    // 优先使用订单项自带的图片，否则从映射中获取
    const firstItem = order.items[0];
    if (firstItem.image) {
      return firstItem.image;
    }
    if (firstItem.offer_id && offerIdImageMap[firstItem.offer_id]) {
      return offerIdImageMap[firstItem.offer_id];
    }

    // 如果没有找到，返回空字符串使用占位符
    return '';
  };

  // 同步订单
  const syncOrdersMutation = useMutation({
    mutationFn: (fullSync: boolean) => {
      if (!selectedShop) {
        throw new Error('请先选择店铺');
      }
      return ozonApi.syncOrdersDirect(selectedShop, fullSync ? 'full' : 'incremental');
    },
    onSuccess: (data) => {
      message.success('订单同步任务已启动');
      setSyncTaskId(data.task_id);
      setSyncStatus({ status: 'running', progress: 0, message: '正在启动同步...' });
    },
    onError: (error: any) => {
      message.error(`同步失败: ${error.message}`);
    },
  });

  // 轮询同步任务状态
  useEffect(() => {
    if (!syncTaskId || syncStatus?.status === 'completed' || syncStatus?.status === 'failed') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const result = await ozonApi.getSyncStatus(syncTaskId);
        const status = result.data || result; // 兼容不同响应格式
        setSyncStatus(status);

        if (status.status === 'completed') {
          message.success('同步完成！');
          queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
          // 刷新页面数据
          refetch();
          setSyncTaskId(null);
        } else if (status.status === 'failed') {
          message.error(`同步失败: ${status.error || '未知错误'}`);
          setSyncTaskId(null);
        }
      } catch (error) {
        console.error('Failed to fetch sync status:', error);
      }
    }, 2000); // 每2秒检查一次

    return () => clearInterval(interval);
  }, [syncTaskId, syncStatus?.status, queryClient]);


  // 发货
  const shipOrderMutation = useMutation({
    mutationFn: ozonApi.shipOrder,
    onSuccess: () => {
      message.success('发货成功');
      setShipModalVisible(false);
      shipForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      message.error(`发货失败: ${error.message}`);
    },
  });

  // 取消订单
  const cancelOrderMutation = useMutation({
    mutationFn: ({ postingNumber, reason }: { postingNumber: string; reason: string }) =>
      ozonApi.cancelOrder(postingNumber, reason),
    onSuccess: () => {
      message.success('订单已取消');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
    onError: (error: any) => {
      message.error(`取消失败: ${error.message}`);
    },
  });

  // 表格列定义（货件维度）
  const columns: any[] = [
    {
      title: '货件编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 150,
      fixed: 'left',
      render: (text: string, record: ozonApi.PostingWithOrder) => (
        <a onClick={() => showOrderDetail(record.order)} className={styles.link}>
          {text}
        </a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const config = statusConfig[status] || statusConfig.pending;
        return (
          <Tag color={config.color} className={styles.tag}>
            {config.text}
          </Tag>
        );
      },
    },
    {
      title: '发货截止',
      dataIndex: 'shipment_date',
      key: 'shipment_date',
      width: 140,
      render: (date: string) => (date ? moment(date).format('MM-DD HH:mm') : '-'),
    },
    {
      title: '商品',
      key: 'items',
      width: 300,
      render: (_: any, record: ozonApi.PostingWithOrder) => {
        const items = record.order.items || [];
        const firstItem = items[0];
        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

        if (!firstItem) return '-';

        const imageUrl = firstItem.image || (firstItem.offer_id && offerIdImageMap[firstItem.offer_id]);

        return (
          <div className={styles.productCell}>
            <Avatar
              size={40}
              src={imageUrl}
              icon={<ShoppingCartOutlined />}
              shape="square"
              className={styles.productAvatar}
            />
            <div className={styles.productInfo}>
              <div className={styles.productName}>
                {firstItem.sku ? (
                  <a
                    href={`https://www.ozon.ru/product/${firstItem.sku}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.link}
                  >
                    {firstItem.name || firstItem.sku}
                  </a>
                ) : (
                  firstItem.name || firstItem.sku
                )}
              </div>
              <div className={styles.productCount}>
                {items.length} 种，共 {totalItems} 件
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: '价格',
      key: 'total_price',
      width: 100,
      align: 'right',
      render: (_: any, record: ozonApi.PostingWithOrder) => {
        const order = record.order;
        // 货币符号映射，默认CNY
        const currencySymbols: Record<string, string> = {
          'RUB': '₽',
          'CNY': '¥',
          'USD': '$',
          'EUR': '€',
        };
        const currency = order.currency_code || 'CNY';
        const symbol = currencySymbols[currency] || '¥';

        return (
          <span className={styles.price}>
            {symbol} {formatPrice(order.total_price || order.total_amount)}
          </span>
        );
      },
    },
    {
      title: '配送',
      key: 'order_type',
      width: 100,
      render: (_: any, record: ozonApi.PostingWithOrder) => (
        <span>{record.delivery_method_name || record.order.delivery_method || record.order.order_type || 'FBS'}</span>
      ),
    },
    {
      title: '预计送达',
      key: 'delivery_date',
      width: 100,
      render: (_: any, record: ozonApi.PostingWithOrder) => {
        const date = record.order.delivery_date;
        return date ? moment(date).format('MM-DD') : '-';
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 50,
      fixed: 'right',
      render: (_: any, record: ozonApi.PostingWithOrder) => {
        const canShip = ['awaiting_packaging', 'awaiting_deliver'].includes(record.status);
        const canCancel = record.status !== 'cancelled' && record.status !== 'delivered';

        return (
          <Dropdown
            menu={{
              items: [
                canShip && {
                  key: 'ship',
                  icon: <TruckOutlined />,
                  label: '发货',
                  onClick: () => handleShip(record),
                },
                {
                  key: 'print',
                  icon: <PrinterOutlined />,
                  label: '打印面单',
                },
                canCancel && {
                  key: 'cancel',
                  icon: <CloseCircleOutlined />,
                  label: '取消订单',
                  danger: true,
                  onClick: () => handleCancel(record),
                },
              ].filter(Boolean),
            }}
          >
            <Button type="link" size="small" icon={<MoreOutlined />} className={styles.linkButton} />
          </Dropdown>
        );
      },
    },
  ];

  // 处理函数
  const showOrderDetail = (order: ozonApi.Order) => {
    setSelectedOrder(order);
    setDetailModalVisible(true);
  };

  const handleShip = (postingWithOrder: ozonApi.PostingWithOrder) => {
    setSelectedOrder(postingWithOrder.order);
    setSelectedPosting(postingWithOrder);
    setShipModalVisible(true);
  };

  const handleCancel = (postingWithOrder: ozonApi.PostingWithOrder) => {
    confirm({
      title: '确认取消订单？',
      content: `订单号: ${postingWithOrder.order.order_number || postingWithOrder.order.order_id}，货件号: ${postingWithOrder.posting_number}`,
      onOk: () => {
        cancelOrderMutation.mutate({
          postingNumber: postingWithOrder.posting_number,
          reason: '卖家取消',
        });
      },
    });
  };

  const handleSync = (fullSync: boolean) => {
    if (!selectedShop) {
      message.warning('请先选择店铺');
      return;
    }

    confirm({
      title: fullSync ? '确认执行全量同步？' : '确认执行增量同步？',
      content: fullSync ? '全量同步将拉取所有历史订单数据，耗时较长' : '增量同步将只拉取最近7天的订单',
      onOk: () => {
        syncOrdersMutation.mutate(fullSync);
      },
    });
  };

  const handleBatchPrint = () => {
    if (selectedOrders.length === 0) {
      message.warning('请先选择订单');
      return;
    }
    message.info('批量打印功能开发中');
  };

  const handleBatchShip = () => {
    if (selectedOrders.length === 0) {
      message.warning('请先选择订单');
      return;
    }
    message.info('批量发货功能开发中');
  };

  // 统计数据 - 使用API返回的全局统计数据
  const stats = ordersData?.stats || {
    total: 0,
    awaiting_packaging: 0,
    awaiting_deliver: 0,
    delivering: 0,
    delivered: 0,
    cancelled: 0,
  };

  return (
    <div>
      {/* 同步进度显示 */}
      {syncStatus && syncStatus.status === 'running' && (
        <Alert
          message="订单同步中"
          description={
            <div>
              <p>{syncStatus.message}</p>
              <Progress percent={Math.round(syncStatus.progress)} status="active" />
            </div>
          }
          type="info"
          showIcon
          closable
          onClose={() => {
            setSyncStatus(null);
            setSyncTaskId(null);
          }}
          className={styles.filterCard}
        />
      )}

      {/* 搜索过滤 */}
      <Card className={styles.filterCard}>
        <Row className={styles.filterRow}>
          <Col flex="auto">
            <Space size="large">
              <span className={styles.shopLabel}>选择店铺:</span>
              <ShopSelector
                value={selectedShop}
                onChange={(shopId) => {
                  const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
                  setSelectedShop(normalized);
                  // 切换店铺时重置页码
                  setCurrentPage(1);
                  // 保存到localStorage
                  localStorage.setItem('ozon_selected_shop', normalized?.toString() || '');
                }}
                showAllOption={false}
                className={styles.shopSelector}
              />
            </Space>
          </Col>
        </Row>
        <Form
          form={filterForm}
          layout="inline"
          onFinish={(values) => {
            setSearchParams(values);
            setCurrentPage(1); // 搜索时重置到第一页
          }}
        >
          <Form.Item name="dateRange">
            <RangePicker />
          </Form.Item>
          <Form.Item name="posting_number">
            <Input placeholder="货件编号" prefix={<SearchOutlined />} />
          </Form.Item>
          <Form.Item name="order_type">
            <Select placeholder="订单类型" className={styles.typeSelect} allowClear>
              <Option value="FBS">FBS</Option>
              <Option value="FBO">FBO</Option>
              <Option value="CrossDock">CrossDock</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button
                onClick={() => {
                  filterForm.resetFields();
                  setSearchParams({});
                  setCurrentPage(1);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 订单列表 */}
      <Card className={styles.listCard}>
        {/* 状态标签页 */}
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            setCurrentPage(1); // 切换Tab时重置到第一页
          }}
          items={[
            {
              label: `等待备货 ${stats.awaiting_packaging || 0}`,
              key: 'awaiting_packaging',
            },
            {
              label: `等待发运 ${stats.awaiting_deliver || 0}`,
              key: 'awaiting_deliver',
            },
            {
              label: `运输中 ${stats.delivering || 0}`,
              key: 'delivering',
            },
            {
              label: `已签收 ${stats.delivered || 0}`,
              key: 'delivered',
            },
            {
              label: `已取消 ${stats.cancelled || 0}`,
              key: 'cancelled',
            },
            {
              label: '所有',
              key: 'all',
            },
          ]}
        />

        {/* 操作按钮 */}
        <Space className={styles.actionSpace}>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={() => handleSync(false)}
            loading={syncOrdersMutation.isPending}
            disabled={!selectedShop}
          >
            增量同步
          </Button>
          <Button
            icon={<SyncOutlined />}
            onClick={() => handleSync(true)}
            loading={syncOrdersMutation.isPending}
            disabled={!selectedShop}
          >
            全量同步
          </Button>
          <Button
            icon={<TruckOutlined />}
            onClick={handleBatchShip}
            disabled={selectedOrders.length === 0}
          >
            批量发货
          </Button>
          <Button
            icon={<PrinterOutlined />}
            onClick={handleBatchPrint}
            disabled={selectedOrders.length === 0}
          >
            批量打印
          </Button>
          <Button icon={<DownloadOutlined />}>导出订单</Button>
        </Space>

        {/* 货件列表（以货件为单位显示）*/}
        <Table
          loading={isLoading}
          columns={columns}
          dataSource={postingsData}
          rowKey="posting_number"
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: postingsData.length,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条货件`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size || 50);
            },
            className: styles.pagination,
          }}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>

      {/* 订单详情弹窗 */}
      <Modal
        title={`订单详情 - ${selectedOrder?.order_id}`}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={900}
      >
        {selectedOrder && (
          <Tabs
            defaultActiveKey="1"
            items={[
              {
                label: '基本信息',
                key: '1',
                children: (
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="订单号">{selectedOrder.order_id}</Descriptions.Item>
                    <Descriptions.Item label="Ozon订单号">
                      {selectedOrder.ozon_order_id || selectedOrder.order_id}
                    </Descriptions.Item>
                    <Descriptions.Item label="状态">
                      <Tag color={statusConfig[selectedOrder.status]?.color}>
                        {statusConfig[selectedOrder.status]?.text}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="订单类型">
                      {selectedOrder.order_type || 'FBS'}
                    </Descriptions.Item>
                    <Descriptions.Item label="总金额">
                      {formatRuble(selectedOrder.total_price || selectedOrder.total_amount)}
                    </Descriptions.Item>
                    <Descriptions.Item label="商品金额">
                      {formatRuble(selectedOrder.products_price || selectedOrder.products_amount)}
                    </Descriptions.Item>
                    <Descriptions.Item label="运费">
                      {selectedOrder.delivery_price || selectedOrder.delivery_amount ? formatRuble(selectedOrder.delivery_price || selectedOrder.delivery_amount) : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="佣金">
                      {formatRuble(selectedOrder.commission_amount)}
                    </Descriptions.Item>
                    <Descriptions.Item label="下单时间">
                      {selectedOrder.ordered_at ? moment(selectedOrder.ordered_at).format('YYYY-MM-DD HH:mm:ss') :
                       (selectedOrder.created_at ? moment(selectedOrder.created_at).format('YYYY-MM-DD HH:mm:ss') : '-')}
                    </Descriptions.Item>
                    <Descriptions.Item label="配送方式">
                      {selectedOrder.delivery_method}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                label: '商品明细',
                key: '2',
                children: (
                  <Table
                    dataSource={selectedOrder.items}
                    rowKey="sku"
                    pagination={false}
                    columns={[
                      {
                        title: '图片',
                        dataIndex: 'sku',
                        key: 'image',
                        width: 80,
                        render: (sku, record) => {
                          const imageUrl = record.image || (record.offer_id && offerIdImageMap[record.offer_id] ? offerIdImageMap[record.offer_id] : undefined);
                          return imageUrl ? (
                            <Avatar
                              src={imageUrl}
                              size={60}
                              shape="square"
                              className={styles.productImage}
                            />
                          ) : (
                            <Avatar
                              icon={<ShoppingCartOutlined />}
                              size={60}
                              shape="square"
                              className={styles.productImagePlaceholder}
                            />
                          );
                        },
                      },
                      { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 120 },
                      {
                        title: '商品名称',
                        dataIndex: 'name',
                        key: 'name',
                        render: (name, record) => {
                          if (record.sku) {
                            return (
                              <a
                                href={`https://www.ozon.ru/product/${record.sku}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.link}
                              >
                                {name || record.sku}
                              </a>
                            );
                          }
                          return name || record.sku;
                        }
                      },
                      { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80 },
                      {
                        title: '单价',
                        dataIndex: 'price',
                        key: 'price',
                        width: 100,
                        render: (price) => formatRuble(price),
                      },
                      {
                        title: '小计',
                        dataIndex: 'total_amount',
                        key: 'total_amount',
                        width: 100,
                        render: (amount) => formatRuble(amount),
                      },
                    ]}
                  />
                ),
              },
              {
                label: '客户信息',
                key: '3',
                children: (
                  <Descriptions bordered>
                    <Descriptions.Item label="客户ID">
                      {selectedOrder.customer_id || <Text type="secondary">隐私保护</Text>}
                    </Descriptions.Item>
                    <Descriptions.Item label="电话">
                      {selectedOrder.customer_phone || <Text type="secondary">隐私保护</Text>}
                    </Descriptions.Item>
                    <Descriptions.Item label="邮箱">
                      {selectedOrder.customer_email || <Text type="secondary">隐私保护</Text>}
                    </Descriptions.Item>
                    <Descriptions.Item label="收货地址" span={3}>
                      {selectedOrder.delivery_address ? (
                        <div>
                          {selectedOrder.delivery_address.region && (
                            <>
                              <Text strong>{selectedOrder.delivery_address.region}</Text>
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.city && (
                            <>
                              {selectedOrder.delivery_address.city}
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.delivery_type && (
                            <>
                              配送方式: {selectedOrder.delivery_address.delivery_type}
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.street && (
                            <>
                              {selectedOrder.delivery_address.street}
                              {selectedOrder.delivery_address.building &&
                                `, ${selectedOrder.delivery_address.building}`}
                              {selectedOrder.delivery_address.apartment &&
                                `, кв. ${selectedOrder.delivery_address.apartment}`}
                              <br />
                            </>
                          )}
                          {selectedOrder.delivery_address.postal_code && (
                            <>邮编: {selectedOrder.delivery_address.postal_code}</>
                          )}
                        </div>
                      ) : (
                        <Text type="secondary">地址信息保护</Text>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                label: '额外信息',
                key: '4',
                children: <ExtraInfoForm selectedOrder={selectedOrder} setIsUpdatingExtraInfo={setIsUpdatingExtraInfo} />
              },
              {
                label: '物流信息',
                key: '5',
                children: selectedOrder.postings?.map((posting) => (
                  <Card key={posting.id} className={styles.postingCard}>
                    <Descriptions bordered size="small">
                      <Descriptions.Item label="Posting号">
                        {posting.posting_number}
                      </Descriptions.Item>
                      <Descriptions.Item label="状态">{posting.status}</Descriptions.Item>
                      <Descriptions.Item label="仓库">{posting.warehouse_name}</Descriptions.Item>
                      <Descriptions.Item label="配送方式">
                        {posting.delivery_method_name}
                      </Descriptions.Item>
                      <Descriptions.Item label="发货时间">
                        {posting.shipped_at
                          ? moment(posting.shipped_at).format('YYYY-MM-DD HH:mm')
                          : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="送达时间">
                        {posting.delivered_at
                          ? moment(posting.delivered_at).format('YYYY-MM-DD HH:mm')
                          : '-'}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )),
              },
            ]}
          />
        )}
      </Modal>

      {/* 发货弹窗 */}
      <Modal
        title={`发货 - ${selectedOrder?.order_id}`}
        open={shipModalVisible}
        onCancel={() => setShipModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={shipForm}
          layout="vertical"
          onFinish={(values) => {
            if (!selectedPosting) return;
            shipOrderMutation.mutate({
              posting_number: selectedPosting.posting_number,
              tracking_number: values.tracking_number,
              carrier_code: values.carrier_code,
            });
          }}
        >
          <Alert
            message="发货信息"
            description={`Posting号: ${selectedPosting?.posting_number}`}
            type="info"
            className={styles.alertMargin}
          />

          <Form.Item
            name="tracking_number"
            label="物流单号"
            rules={[{ required: true, message: '请输入物流单号' }]}
          >
            <Input placeholder="请输入物流单号" />
          </Form.Item>

          <Form.Item
            name="carrier_code"
            label="物流公司"
            rules={[{ required: true, message: '请选择物流公司' }]}
          >
            <Select placeholder="请选择物流公司">
              <Option value="CDEK">CDEK</Option>
              <Option value="BOXBERRY">Boxberry</Option>
              <Option value="POCHTA">俄罗斯邮政</Option>
              <Option value="DPD">DPD</Option>
              <Option value="OZON">Ozon物流</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={shipOrderMutation.isPending}>
                确认发货
              </Button>
              <Button onClick={() => {
                setShipModalVisible(false);
                shipForm.resetFields();
              }}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default OrderList;
