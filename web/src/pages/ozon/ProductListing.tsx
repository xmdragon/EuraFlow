/**
 * OZON商品上架管理页面
 */
import {
  CloudUploadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Steps,
  Alert,
  Tooltip,
  Row,
  Col,
  Statistic,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';

import styles from './ProductListing.module.scss';

import ProductImage from '@/components/ozon/ProductImage';
import ShopSelectorWithLabel from '@/components/ozon/ShopSelectorWithLabel';
import PageTitle from '@/components/PageTitle';
import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError } from '@/utils/notification';

// 状态映射
const STATUS_STEPS = [
  { key: 'draft', title: '草稿' },
  { key: 'media_ready', title: '图片就绪' },
  { key: 'import_submitted', title: '已提交' },
  { key: 'created', title: '已创建' },
  { key: 'priced', title: '已定价' },
  { key: 'live', title: '在售' },
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  media_ready: 'processing',
  import_submitted: 'processing',
  created: 'success',
  priced: 'success',
  ready_for_sale: 'warning',
  live: 'success',
  error: 'error',
};

const ProductListing: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ozonApi.Product | null>(null);
  const [listingModalVisible, setListingModalVisible] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<ozonApi.ListingStatus | null>(null);
  const [_form] = Form.useForm();

  // 获取已下架商品列表（可重新上架）
  const {
    data: productsData,
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ['products', selectedShop, 'inactive'],
    queryFn: async () => {
      if (!selectedShop) return { data: [], total: 0 };
      return await ozonApi.getProducts(1, 100, {
        shop_id: selectedShop,
        status: 'inactive', // 只显示已下架商品
      });
    },
    enabled: !!selectedShop,
  });

  // 重新上架操作
  const unarchiveProductMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShop || !selectedProduct) throw new Error('请先选择店铺和商品');
      // TODO: 调用unarchiveProduct API
      return await ozonApi.unarchiveProduct(selectedShop, selectedProduct.ozon_product_id);
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('重新上架成功', '商品已重新上架');
        setListingModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ['products'] });
      } else {
        notifyError('重新上架失败', `重新上架失败: ${data.error || '未知错误'}`);
      }
    },
    onError: (error: Error) => {
      notifyError('重新上架失败', `重新上架失败: ${error.message}`);
    },
  });

  // 查询上架状态（预留功能）
  const _checkStatusMutation = useMutation({
    mutationFn: async (offerId: string) => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return await ozonApi.getListingStatus(selectedShop, offerId);
    },
    onSuccess: (data) => {
      if (data.success) {
        setCurrentStatus(data);
        setStatusModalVisible(true);
      } else {
        notifyError('查询状态失败', `查询状态失败: ${data.error}`);
      }
    },
  });

  // 归档操作
  const archiveProductMutation = useMutation({
    mutationFn: async (product: ozonApi.Product) => {
      return await ozonApi.archiveProduct(product.id);
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('归档成功', '商品已归档');
        queryClient.invalidateQueries({ queryKey: ['products'] });
        refetchProducts();
      } else {
        notifyError('归档失败', `归档失败: ${data.error || '未知错误'}`);
      }
    },
    onError: (error: Error) => {
      notifyError('归档失败', `归档失败: ${error.message}`);
    },
  });

  // 表格列定义
  const columns: ColumnsType<ozonApi.Product> = [
    // 第一列：图片（80x80，悬浮显示160x160）
    {
      title: '图片',
      key: 'image',
      width: 100,
      render: (_, record) => {
        return (
          <ProductImage
            imageUrl={record.images?.primary}
            size="small"
            hoverBehavior="medium"
            name={record.title}
            sku={record.sku}
            offerId={record.offer_id}
          />
        );
      },
    },
    // 第二列：SKU
    {
      title: 'SKU',
      key: 'sku',
      width: 150,
      fixed: 'left',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <span style={{ fontSize: 12 }}>
            货号: {record.offer_id}
          </span>
          <span style={{ fontSize: 12, color: '#999' }}>
            SKU: {record.ozon_sku || '-'}
          </span>
        </Space>
      ),
    },
    {
      title: '商品名称',
      dataIndex: 'title',
      key: 'title',
      width: 250,
      ellipsis: true,
    },
    {
      title: '价格',
      key: 'price',
      width: 100,
      render: (_, record: ozonApi.Product) => {
        const price = record.price ? parseFloat(record.price) : 0;
        return (
          <span>
            {price > 0
              ? `${price.toFixed(2)} ${record.currency_code || 'RUB'}`
              : '-'}
          </span>
        );
      },
    },
    {
      title: '库存',
      key: 'stock',
      width: 120,
      render: (_, record) => {
        // 如果有仓库库存详情，按仓库显示
        if (record.warehouse_stocks && record.warehouse_stocks.length > 0) {
          return (
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {record.warehouse_stocks.map((ws, index) => {
                // 提取仓库名称缩写（取前4个字符），如果没有名称则显示仓库ID或序号
                const warehouseAbbr = ws.warehouse_name?.substring(0, 4)
                  || (ws.warehouse_id ? `仓${ws.warehouse_id}` : `仓${index + 1}`);
                const totalStock = ws.present + ws.reserved;

                return (
                  <span key={index} style={{ fontSize: 12 }}>
                    {warehouseAbbr}:
                    <span style={{ fontWeight: 600, marginLeft: '4px' }}>{totalStock}</span>
                  </span>
                );
              })}
            </Space>
          );
        }

        // 降级：如果没有仓库库存详情，显示总库存
        return (
          <span style={{ fontSize: 12 }}>
            总计: <span style={{ fontWeight: 600, marginLeft: '4px' }}>{record.stock || 0}</span>
          </span>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => {
        const statusMap: Record<string, { text: string; color: string }> = {
          draft: { text: '草稿', color: 'default' },
          on_sale: { text: '在售', color: 'success' },
          ready_to_sell: { text: '可售', color: 'processing' },
          error: { text: '错误', color: 'error' },
          inactive: { text: '未激活', color: 'warning' },
          archived: { text: '已归档', color: 'default' },
        };
        const statusInfo = statusMap[status] || {
          text: status,
          color: 'default',
        };
        return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, record: ozonApi.Product) => (
        <Space size="small">
          <Tooltip title="上架到OZON">
            <Button
              type="primary"
              size="small"
              icon={<RocketOutlined />}
              onClick={() => {
                setSelectedProduct(record);
                setListingModalVisible(true);
              }}
            >
              上架
            </Button>
          </Tooltip>
          <Tooltip title="归档商品">
            <Button
              size="small"
              icon={<InboxOutlined />}
              onClick={() => archiveProductMutation.mutate(record)}
              loading={archiveProductMutation.isPending}
            >
              归档
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  // 统计信息
  const stats = productsData?.data
    ? {
        total: productsData.data.length,
        archived: productsData.data.filter((p: ozonApi.Product) => p.ozon_archived).length,
        inactive: productsData.data.filter((p: ozonApi.Product) => p.status === 'inactive').length,
        hasStock: productsData.data.filter((p: ozonApi.Product) => p.stock > 0).length,
        noStock: productsData.data.filter((p: ozonApi.Product) => p.stock <= 0).length,
      }
    : { total: 0, archived: 0, inactive: 0, hasStock: 0, noStock: 0 };

  return (
    <div>
      {/* 页面标题和店铺选择器 */}
      <PageTitle icon={<CloudUploadOutlined />} title="已下架商品 - 重新上架" />
      <div className={styles.shopSelectorContainer}>
        <ShopSelectorWithLabel
          label="选择店铺"
          value={selectedShop}
          onChange={(shopId) => setSelectedShop(shopId as number)}
          className={styles.shopSelector}
          showAllOption={false}
        />
      </div>

      {/* 统计卡片 */}
      {selectedShop && (
        <Row gutter={16} className={styles.statsRow}>
          <Col span={6}>
            <Card>
              <Statistic title="已下架总数" value={stats.total} prefix={<CloudUploadOutlined />} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="已归档"
                value={stats.archived}
                valueStyle={{ color: '#999' }}
                prefix={<ExclamationCircleOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="有库存"
                value={stats.hasStock}
                valueStyle={{ color: '#3f8600' }}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="无库存"
                value={stats.noStock}
                valueStyle={{ color: '#cf1322' }}
                prefix={<ExclamationCircleOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 商品列表 */}
      <Card
        title="商品列表"
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetchProducts()}
            loading={productsLoading}
          >
            刷新
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={productsData?.data || []}
          loading={productsLoading}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个商品`,
          }}
        />
      </Card>

      {/* 重新上架Modal */}
      <Modal
        title="重新上架商品"
        open={listingModalVisible}
        onCancel={() => {
          setListingModalVisible(false);
          setSelectedProduct(null);
        }}
        onOk={() => unarchiveProductMutation.mutate()}
        confirmLoading={unarchiveProductMutation.isPending}
        width={600}
        okText="确认重新上架"
        cancelText="取消"
      >
        <Alert
          message="重新上架说明"
          description={
            <div>
              <p>
                <strong>此操作将从档案中还原商品</strong>，使其重新在OZON平台可见。
              </p>
              <p>
                <strong>注意</strong>：自动归档的商品每天最多恢复10个（莫斯科时间03:00重置），手动归档的无限制。
              </p>
            </div>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {selectedProduct && (
          <Alert
            message="商品信息"
            description={
              <div>
                <p>
                  <strong>商品货号</strong>: {selectedProduct.offer_id}
                </p>
                <p>
                  <strong>名称</strong>: {selectedProduct.title}
                </p>
                <p>
                  <strong>OZON商品ID</strong>: {selectedProduct.ozon_product_id}
                </p>
                <p>
                  <strong>价格</strong>: {selectedProduct.price || '未设置'}
                </p>
                <p>
                  <strong>库存</strong>: {selectedProduct.stock || 0}
                </p>
                <p>
                  <strong>当前状态</strong>: {selectedProduct.status === 'inactive' ? '已下架' : selectedProduct.ozon_archived ? '已归档' : '其他'}
                </p>
              </div>
            }
            type="warning"
            showIcon
          />
        )}
      </Modal>

      {/* 状态查看Modal */}
      <Modal
        title="上架状态"
        open={statusModalVisible}
        onCancel={() => setStatusModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setStatusModalVisible(false)}>
            关闭
          </Button>,
        ]}
        width={700}
      >
        {currentStatus && (
          <div>
            <Steps
              current={STATUS_STEPS.findIndex((s) => s.key === currentStatus.status)}
              status={currentStatus.error ? 'error' : 'process'}
              style={{ marginBottom: 24 }}
            >
              {STATUS_STEPS.map((step) => (
                <Steps.Step key={step.key} title={step.title} />
              ))}
            </Steps>

            <Card size="small" style={{ marginBottom: 16 }}>
              <p>
                <strong>当前状态:</strong>{' '}
                <Tag color={STATUS_COLORS[currentStatus.status] || 'default'}>
                  {currentStatus.status}
                </Tag>
              </p>
              <p>
                <strong>上架模式:</strong> {currentStatus.mode || '-'}
              </p>
              <p>
                <strong>OZON商品ID:</strong> {currentStatus.product_id || '-'}
              </p>
              <p>
                <strong>OZON SKU:</strong> {currentStatus.sku || '-'}
              </p>
            </Card>

            {currentStatus.error && (
              <Alert
                message="错误信息"
                description={
                  <div>
                    <p>
                      <strong>错误代码:</strong> {currentStatus.error.code}
                    </p>
                    <p>
                      <strong>错误描述:</strong> {currentStatus.error.message}
                    </p>
                  </div>
                }
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Card title="时间戳记录" size="small">
              {Object.entries(currentStatus.timestamps).map(
                ([key, value]) =>
                  value && (
                    <p key={key}>
                      <strong>{key}:</strong> {new Date(value).toLocaleString('zh-CN')}
                    </p>
                  )
              )}
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProductListing;
