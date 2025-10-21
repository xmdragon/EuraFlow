/**
 * OZON商品上架管理页面
 */
import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Steps,
  Alert,
  Tooltip,
  Badge,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  CloudUploadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import ShopSelector from '@/components/ozon/ShopSelector';
import { notifySuccess, notifyError } from '@/utils/notification';
import * as ozonApi from '@/services/ozonApi';

const { Option } = Select;

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
  const [form] = Form.useForm();

  // 获取商品列表（优先显示draft和可上架的商品）
  const { data: productsData, isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ['products', selectedShop, 'listable'],
    queryFn: async () => {
      if (!selectedShop) return { data: [], total: 0 };
      return await ozonApi.getProducts(1, 100, {
        shop_id: selectedShop,
        // 不限制状态，显示所有商品
      });
    },
    enabled: !!selectedShop,
  });

  // 上架操作
  const listProductMutation = useMutation({
    mutationFn: async (values: {
      offer_id: string;
      mode: 'NEW_CARD' | 'FOLLOW_PDP';
      auto_advance: boolean;
    }) => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return await ozonApi.importProduct(
        selectedShop,
        values.offer_id,
        values.mode,
        values.auto_advance
      );
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('上架请求已提交', '商品上架请求已提交');
        setListingModalVisible(false);
        form.resetFields();
        queryClient.invalidateQueries({ queryKey: ['products'] });
      } else {
        notifyError('上架失败', `上架失败: ${data.error || '未知错误'}`);
      }
    },
    onError: (error: any) => {
      notifyError('上架失败', `上架失败: ${error.message}`);
    },
  });

  // 查询上架状态
  const checkStatusMutation = useMutation({
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

  // 表格列定义
  const columns: ColumnsType<ozonApi.Product> = [
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 150,
      fixed: 'left',
    },
    {
      title: '商品名称',
      dataIndex: 'title',
      key: 'title',
      width: 250,
      ellipsis: true,
    },
    {
      title: 'Offer ID',
      dataIndex: 'offer_id',
      key: 'offer_id',
      width: 150,
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 100,
      render: (price: string, record: ozonApi.Product) => (
        <span>{price ? `${price} ${record.currency_code || 'RUB'}` : '-'}</span>
      ),
    },
    {
      title: '库存',
      dataIndex: 'stock',
      key: 'stock',
      width: 80,
      render: (stock: number) => (
        <Badge count={stock} showZero overflowCount={999} style={{ backgroundColor: stock > 0 ? '#52c41a' : '#d9d9d9' }} />
      ),
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
        const statusInfo = statusMap[status] || { text: status, color: 'default' };
        return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
      },
    },
    {
      title: 'OZON商品ID',
      dataIndex: 'ozon_product_id',
      key: 'ozon_product_id',
      width: 120,
      render: (id: number) => (id ? id : <span style={{ color: '#999' }}>未上架</span>),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      fixed: 'right',
      render: (_: any, record: ozonApi.Product) => (
        <Space size="small">
          <Tooltip title="查看上架状态">
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => checkStatusMutation.mutate(record.offer_id)}
              loading={checkStatusMutation.isPending}
            >
              状态
            </Button>
          </Tooltip>
          <Tooltip title="上架到OZON">
            <Button
              type="primary"
              size="small"
              icon={<RocketOutlined />}
              onClick={() => {
                setSelectedProduct(record);
                form.setFieldsValue({
                  offer_id: record.offer_id,
                  mode: record.barcode ? 'FOLLOW_PDP' : 'NEW_CARD',
                  auto_advance: true,
                });
                setListingModalVisible(true);
              }}
            >
              上架
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  // 统计信息
  const stats = productsData?.data ? {
    total: productsData.data.length,
    draft: productsData.data.filter((p: ozonApi.Product) => p.status === 'draft').length,
    listed: productsData.data.filter((p: ozonApi.Product) => p.ozon_product_id).length,
    ready: productsData.data.filter((p: ozonApi.Product) => p.price && p.stock > 0 && !p.ozon_product_id).length,
  } : { total: 0, draft: 0, listed: 0, ready: 0 };

  return (
    <div style={{ padding: '24px' }}>
      {/* 页面标题和店铺选择器 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <h2 style={{ margin: 0 }}>
            <CloudUploadOutlined /> 商品上架管理
          </h2>
        </Col>
        <Col span={12} style={{ textAlign: 'right' }}>
          <ShopSelector
            value={selectedShop}
            onChange={setSelectedShop}
            style={{ width: 200 }}
          />
        </Col>
      </Row>

      {/* 统计卡片 */}
      {selectedShop && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic title="商品总数" value={stats.total} prefix={<CloudUploadOutlined />} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="可上架商品"
                value={stats.ready}
                valueStyle={{ color: '#3f8600' }}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="草稿状态"
                value={stats.draft}
                valueStyle={{ color: '#cf1322' }}
                prefix={<ExclamationCircleOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="已上架"
                value={stats.listed}
                valueStyle={{ color: '#1890ff' }}
                prefix={<RocketOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 提示信息 */}
      {!selectedShop && (
        <Alert
          message="请先选择店铺"
          description="在右上角选择一个店铺以查看和管理商品上架状态"
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
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

      {/* 上架Modal */}
      <Modal
        title="商品上架"
        open={listingModalVisible}
        onCancel={() => {
          setListingModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={listProductMutation.isPending}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => listProductMutation.mutate(values)}
        >
          <Alert
            message="上架说明"
            description={
              <div>
                <p><strong>NEW_CARD</strong>: 创建全新商品卡片（需要填写类目和属性）</p>
                <p><strong>FOLLOW_PDP</strong>: 跟随已有商品（需要条形码，共享商品详情页）</p>
                <p><strong>自动推进</strong>: 自动完成图片上传、商品创建、价格设置、库存设置等步骤</p>
              </div>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form.Item
            label="Offer ID"
            name="offer_id"
            rules={[{ required: true, message: '请输入Offer ID' }]}
          >
            <Input disabled placeholder="自动填充" />
          </Form.Item>

          <Form.Item
            label="上架模式"
            name="mode"
            rules={[{ required: true, message: '请选择上架模式' }]}
          >
            <Select>
              <Option value="NEW_CARD">NEW_CARD - 创建新商品卡片</Option>
              <Option value="FOLLOW_PDP" disabled={!selectedProduct?.barcode}>
                FOLLOW_PDP - 跟随已有商品{!selectedProduct?.barcode && ' (需要条形码)'}
              </Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="自动推进"
            name="auto_advance"
            valuePropName="checked"
            tooltip="自动完成后续所有步骤（图片、创建、价格、库存）"
          >
            <Select>
              <Option value={true}>是 - 自动完成所有步骤</Option>
              <Option value={false}>否 - 仅提交，手动推进</Option>
            </Select>
          </Form.Item>

          {selectedProduct && (
            <Alert
              message="商品信息"
              description={
                <div>
                  <p><strong>名称</strong>: {selectedProduct.title}</p>
                  <p><strong>价格</strong>: {selectedProduct.price || '未设置'}</p>
                  <p><strong>库存</strong>: {selectedProduct.stock || 0}</p>
                  <p><strong>条形码</strong>: {selectedProduct.barcode || '无'}</p>
                </div>
              }
              type="warning"
              showIcon
            />
          )}
        </Form>
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
              <p><strong>上架模式:</strong> {currentStatus.mode || '-'}</p>
              <p><strong>OZON商品ID:</strong> {currentStatus.product_id || '-'}</p>
              <p><strong>OZON SKU:</strong> {currentStatus.sku || '-'}</p>
            </Card>

            {currentStatus.error && (
              <Alert
                message="错误信息"
                description={
                  <div>
                    <p><strong>错误代码:</strong> {currentStatus.error.code}</p>
                    <p><strong>错误描述:</strong> {currentStatus.error.message}</p>
                  </div>
                }
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            <Card title="时间戳记录" size="small">
              {Object.entries(currentStatus.timestamps).map(([key, value]) => (
                value && (
                  <p key={key}>
                    <strong>{key}:</strong> {new Date(value).toLocaleString('zh-CN')}
                  </p>
                )
              ))}
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProductListing;
