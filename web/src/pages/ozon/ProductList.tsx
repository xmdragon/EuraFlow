/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ozon 商品列表页面
 */
import { ShoppingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Row,
  Col,
  Input,
  Modal,
  App,
  InputNumber,
  Form,
} from 'antd';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ProductSyncErrorModal from './components/ProductSyncErrorModal';
import styles from './ProductList.module.scss';

import ImagePreview from '@/components/ImagePreview';
import { ColumnConfigModal } from '@/components/ozon/product/ColumnConfigModal';
import PriceEditModal from '@/components/ozon/product/PriceEditModal';
import ProductFilterBar from '@/components/ozon/product/ProductFilterBar';
import ProductToolbar from '@/components/ozon/product/ProductToolbar';
import StockEditModal from '@/components/ozon/product/StockEditModal';
import { WatermarkApplyModal } from '@/components/ozon/watermark/WatermarkApplyModal';
import PageTitle from '@/components/PageTitle';
import { getProductTableColumns } from '@/config/ozon/productTableColumns';
import { useColumnConfig } from '@/hooks/ozon/useColumnConfig';
import { useProductOperations } from '@/hooks/ozon/useProductOperations';
import { useProductSync } from '@/hooks/ozon/useProductSync';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { useWatermark } from '@/hooks/ozon/useWatermark';
import { useCopy } from '@/hooks/useCopy';
import { useCurrency } from '@/hooks/useCurrency';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

import './ProductList.css';

const ProductList: React.FC = () => {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canOperate, canSync, canDelete } = usePermission();
  const { copyToClipboard } = useCopy();
  const { symbol: currencySymbol } = useCurrency();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRows, setSelectedRows] = useState<ozonApi.Product[]>([]);
  const { selectedShop, handleShopChange } = useShopSelection();
  const [filterForm] = Form.useForm();
  const [filterValues, setFilterValues] = useState<ozonApi.ProductFilter>(() => {
    // 默认为"新增商品"：销售中且14天内创建的商品，按创建时间倒序
    const fourteenDaysAgo = dayjs().subtract(14, 'days').format('YYYY-MM-DD');
    return {
      status: 'new_products',
      created_from: fourteenDaysAgo,
      sort_by: 'created_at',
      sort_order: 'desc',
    };
  });
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [selectedProductForError, setSelectedProductForError] = useState<number | null>(null);

  // 排序状态管理
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);

  // 水印相关UI状态
  const [watermarkModalVisible, setWatermarkModalVisible] = useState(false);
  const [watermarkStep, setWatermarkStep] = useState<'select' | 'preview'>('select');
  const [watermarkPreviews, setWatermarkPreviews] = useState<any[]>([]);
  const [watermarkAnalyzeMode] = useState<'individual' | 'fast'>('individual');

  // 图片预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [currentPreviewProduct, setCurrentPreviewProduct] = useState<any>(null);

  // 处理排序
  const handleSort = (field: string) => {
    if (sortBy === field) {
      // 同一字段：无排序 → 升序 → 降序 → 无排序
      if (sortOrder === null) {
        setSortOrder('asc');
      } else if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else {
        setSortBy(null);
        setSortOrder(null);
      }
    } else {
      // 切换到新字段，默认升序
      setSortBy(field);
      setSortOrder('asc');
    }
    // 重置到第一页
    setCurrentPage(1);
  };

  // 列标题排序组件
  const SortableColumnTitle: React.FC<{ title: string; field: string }> = ({ title, field }) => {
    const isActive = sortBy === field;
    const isAsc = isActive && sortOrder === 'asc';
    const isDesc = isActive && sortOrder === 'desc';

    return (
      <div
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          userSelect: 'none',
        }}
        onClick={() => handleSort(field)}
      >
        <span>{title}</span>
        <span
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            fontSize: '10px',
          }}
        >
          <span style={{ lineHeight: 1, color: isAsc ? '#1890ff' : '#bfbfbf' }}>▲</span>
          <span style={{ lineHeight: 1, color: isDesc ? '#1890ff' : '#bfbfbf' }}>▼</span>
        </span>
      </div>
    );
  };

  // 查询商品列表
  const {
    data: productsData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [
      'ozonProducts',
      currentPage,
      pageSize,
      selectedShop,
      filterValues,
      sortBy,
      sortOrder,
    ],
    queryFn: async () => {
      const params: ozonApi.ProductFilter = {
        ...filterValues,
        shop_id: selectedShop,
      };

      // 处理"新增商品"状态：转换为实际的查询条件
      if (params.status === 'new_products') {
        params.status = 'on_sale';
        // created_from 已经在 filterValues 中设置了
      }

      // 添加排序参数
      if (sortBy && sortOrder) {
        params.sort_by = sortBy;
        params.sort_order = sortOrder;
      }

      // 调试：打印请求参数
      loggers.product.info('商品列表查询参数：', params);

      const result = await ozonApi.getProducts(currentPage, pageSize, params);

      // 调试：检查SKU 3001670275的数据
      const targetProduct = result.data?.find((p) => p.sku === '3001670275');
      if (targetProduct) {
        loggers.product.debug('🔍 找到SKU 3001670275，API返回的数据:', targetProduct);
        loggers.product.debug(
          '📏 重量字段:',
          targetProduct.weight,
          '类型:',
          typeof targetProduct.weight
        );
        loggers.product.debug('📦 尺寸字段:', {
          width: targetProduct.width,
          height: targetProduct.height,
          depth: targetProduct.depth,
        });
      }

      return result;
    },
    // 只有选中店铺后才发送请求
    enabled: selectedShop !== null && selectedShop !== undefined,
    staleTime: Infinity, // 数据永不过期，不自动刷新
    refetchOnWindowFocus: false, // 窗口聚焦时不自动刷新
    refetchOnMount: false, // 组件挂载时不自动刷新（如有缓存）
    refetchOnReconnect: false, // 网络重连时不自动刷新
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
  });

  // 查询全局统计数据（不受筛选影响）
  const { data: globalStats } = useQuery({
    queryKey: ['ozonStatistics', selectedShop],
    queryFn: () => ozonApi.getStatistics(selectedShop),
    // 只有选中店铺后才发送请求
    enabled: selectedShop !== null && selectedShop !== undefined,
    staleTime: Infinity, // 数据永不过期，不自动刷新
    refetchOnWindowFocus: false, // 窗口聚焦时不自动刷新
    refetchOnMount: false, // 组件挂载时不自动刷新（如有缓存）
    refetchOnReconnect: false, // 网络重连时不自动刷新
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
  });

  // 商品操作 Hook
  const {
    priceModalVisible,
    setPriceModalVisible,
    stockModalVisible,
    setStockModalVisible,
    editModalVisible,
    setEditModalVisible,
    selectedProduct,
    updatePricesMutation,
    updateStocksMutation,
    handleEdit,
    handlePriceUpdate,
    handleStockUpdate,
    handleBatchPriceUpdate,
    handleBatchStockUpdate,
    handleSyncSingle,
    handleArchive,
    handleRestore,
    handleDelete,
  } = useProductOperations(selectedShop);

  // 商品同步 Hook
  const {
    syncProductsMutation,
    syncConfirmVisible,
    setSyncConfirmVisible,
    syncFullMode,
    handleSync,
    handleSyncConfirm,
  } = useProductSync(selectedShop, refetch);

  // 水印 Hook
  const {
    watermarkConfigs,
    previewLoading,
    applyWatermarkMutation,
    restoreOriginalMutation,
    handlePreview,
  } = useWatermark(selectedShop);

  // 列配置 Hook
  const {
    visibleColumns,
    columnConfigVisible,
    handleColumnVisibilityChange,
    openColumnConfig,
    closeColumnConfig,
  } = useColumnConfig();

  // 处理图片点击
  const handleImageClick = (product: ozonApi.Product, images: string[], index: number = 0) => {
    setCurrentPreviewProduct(product);
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewVisible(true);
  };

  const handleFilter = () => {
    const values = filterForm.getFieldsValue();
    // 过滤掉空值
    const cleanedValues: ozonApi.ProductFilter = {};
    if (values.search) cleanedValues.search = values.search;
    if (values.status) cleanedValues.status = values.status;
    if (values.has_stock !== undefined && values.has_stock !== null) {
      cleanedValues.has_stock = values.has_stock === 'true';
    }
    if (values.sync_status) cleanedValues.sync_status = values.sync_status;

    setFilterValues(cleanedValues);
    setCurrentPage(1);
    refetch();
  };

  const handleReset = () => {
    filterForm.resetFields();
    // 重置为默认的"新增商品"筛选
    const fourteenDaysAgo = dayjs().subtract(14, 'days').format('YYYY-MM-DD');
    filterForm.setFieldsValue({ status: 'new_products' });
    setFilterValues({
      status: 'new_products',
      created_from: fourteenDaysAgo,
      sort_by: 'created_at',
      sort_order: 'desc',
    });
    setCurrentPage(1);
    refetch();
  };


  // 处理水印操作
  const handleWatermark = (product: ozonApi.Product) => {
    if (!watermarkConfigs || watermarkConfigs.length === 0) {
      notifyWarning('操作失败', '请先配置水印');
      return;
    }
    setSelectedRows([product]);
    setWatermarkModalVisible(true);
  };

  // 表格列定义
  // 使用列配置工厂函数生成表格列
  const allColumns = getProductTableColumns({
    handleEdit,
    handlePriceUpdate,
    handleStockUpdate,
    handleSyncSingle,
    handleArchive,
    handleRestore: handleRestore,
    handleDelete: handleDelete,
    handleWatermark,
    handleImageClick,
    copyToClipboard,
    canOperate,
    canSync,
    canDelete,
    SortableColumnTitle,
    onErrorClick: (productId) => {
      setSelectedProductForError(productId);
      setErrorModalVisible(true);
    },
  });

  // 根据visibleColumns过滤显示的列
  const columns = allColumns.filter((col) => {
    const key = col.key as string;
    // 操作列始终显示
    if (key === 'action') return true;
    // 其他列根据配置显示
    return visibleColumns[key] !== false;
  });

  // 计算大预览图上的水印样式

  return (
    <div>
      {/* 同步进度已改为右下角通知显示 */}

      {/* 页面标题 */}
      <PageTitle icon={<ShoppingOutlined />} title="商品列表" />

      {/* 搜索过滤 */}
      <ProductFilterBar
        form={filterForm}
        selectedShop={selectedShop}
        onShopChange={(shopId) => {
          handleShopChange(shopId);
          // 切换店铺时重置页码和选中的行
          setCurrentPage(1);
          setSelectedRows([]);
        }}
        filterValues={filterValues}
        onFilter={handleFilter}
        onReset={handleReset}
        onStatusChange={(key) => {
          filterForm.resetFields();
          setCurrentPage(1);
          setSelectedRows([]);

          if (key === 'new_products') {
            // 新增商品：销售中且14天内创建的商品，按创建时间倒序
            const fourteenDaysAgo = dayjs().subtract(14, 'days').format('YYYY-MM-DD');
            filterForm.setFieldsValue({ status: 'new_products' });
            setFilterValues({
              status: 'new_products',
              created_from: fourteenDaysAgo,
              sort_by: 'created_at',
              sort_order: 'desc',
            });
          } else {
            // 其他状态：清除所有过滤条件，只设置状态
            filterForm.setFieldsValue({ status: key });
            setFilterValues({
              status: key,
              // 清除其他所有过滤条件
              created_from: undefined,
              created_to: undefined,
              sort_by: undefined,
              sort_order: undefined,
            });
          }
        }}
        onCreateProduct={() => navigate('/dashboard/ozon/products/create')}
        onListingRecords={() => navigate('/dashboard/ozon/listing-records')}
        onPromotions={() => navigate('/dashboard/ozon/promotions')}
        stats={globalStats?.products}
      />

      {/* 操作按钮 */}
      <Card className={styles.listCard}>
        <ProductToolbar
          canSync={canSync}
          canOperate={canOperate}
          selectedRowsCount={selectedRows.length}
          syncLoading={syncProductsMutation.isPending}
          hasSelectedShop={selectedShop !== null}
          onIncrementalSync={() => handleSync(false)}
          onFullSync={() => handleSync(true)}
          onBatchPriceUpdate={handleBatchPriceUpdate}
          onBatchStockUpdate={handleBatchStockUpdate}
          onColumnSettings={openColumnConfig}
        />

        {/* 商品表格 */}
        <Table
          columns={columns}
          dataSource={productsData?.data || []}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: true }}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: productsData?.total || 0,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size || 20);
            },
          }}
          rowSelection={{
            selectedRowKeys: selectedRows.map((r) => r.id),
            onChange: (_, rows) => setSelectedRows(rows),
          }}
        />
      </Card>

      {/* 价格更新弹窗 */}
      <PriceEditModal
        visible={priceModalVisible}
        onCancel={() => setPriceModalVisible(false)}
        onSubmit={(updates) => updatePricesMutation.mutate(updates as any)}
        selectedProduct={selectedProduct as any}
        selectedRows={selectedRows as any}
        loading={updatePricesMutation.isPending}
      />

      {/* 库存更新弹窗 */}
      <StockEditModal
        visible={stockModalVisible}
        onCancel={() => setStockModalVisible(false)}
        onSubmit={(updates) => updateStocksMutation.mutate(updates as any)}
        selectedProduct={selectedProduct as any}
        selectedRows={selectedRows as any}
        loading={updateStocksMutation.isPending}
        shopId={selectedShop}
      />

      {/* 商品编辑弹窗 */}
      <Modal
        title={`编辑商品 - ${selectedProduct?.offer_id || selectedProduct?.ozon_sku || 'N/A'}`}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={null}
        width={800}
      >
        {selectedProduct && (
          <Form
            layout="vertical"
            initialValues={{
              title: selectedProduct.title,
              title_cn: selectedProduct.title_cn,
              description: selectedProduct.description,
              brand: selectedProduct.brand,
              barcode: selectedProduct.barcode,
              price: selectedProduct.price,
              old_price: selectedProduct.old_price,
              cost: selectedProduct.cost,
              weight: selectedProduct.weight,
              width: selectedProduct.width,
              height: selectedProduct.height,
              depth: selectedProduct.depth,
              purchase_url: selectedProduct.purchase_url,
              suggested_purchase_price: selectedProduct.suggested_purchase_price,
            }}
            onFinish={async (values) => {
              try {
                const response = await fetch(`/api/ef/v1/ozon/products/${selectedProduct.id}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(values),
                });

                const result = await response.json();

                if (result.success) {
                  notifySuccess('更新成功', result.message || '商品信息更新成功');
                  queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
                  setEditModalVisible(false);
                } else {
                  notifyError('更新失败', result.message || '商品信息更新失败');
                }
              } catch (error) {
                notifyError('更新失败', `更新失败: ${error.message}`);
              }
            }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="title"
                  label="商品标题（俄文）"
                  rules={[{ required: true, message: '请输入商品标题' }]}
                >
                  <Input placeholder="请输入商品标题" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="title_cn" label="中文名称">
                  <Input placeholder="请输入中文名称（便于管理）" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="brand" label="品牌">
                  <Input placeholder="请输入品牌" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="barcode" label="主条形码">
                  <Input placeholder="请输入条形码" disabled />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="description" label="商品描述">
              <Input.TextArea rows={3} placeholder="请输入商品描述" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="price" label="售价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={getNumberFormatter(2)}
                    parser={getNumberParser()}
                    prefix={currencySymbol}
                    placeholder="请输入售价"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="old_price" label="原价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={getNumberFormatter(2)}
                    parser={getNumberParser()}
                    prefix={currencySymbol}
                    placeholder="请输入原价"
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* 采购信息 */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="suggested_purchase_price" label="建议采购价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={getNumberFormatter(2)}
                    parser={getNumberParser()}
                    prefix={currencySymbol}
                    placeholder="请输入建议采购价"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="purchase_url" label="采购地址">
                  <Input placeholder="https://..." />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="cost" label="成本价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={getNumberFormatter(2)}
                    parser={getNumberParser()}
                    prefix={currencySymbol}
                    placeholder="成本价"
                  />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="weight" label="重量(g)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="重量" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="width" label="宽(mm)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="宽度" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="height" label="高(mm)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="高度" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="depth" label="深(mm)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="深度" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  保存更改
                </Button>
                <Button onClick={() => setEditModalVisible(false)}>取消</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 水印应用模态框 */}
      <WatermarkApplyModal
        visible={watermarkModalVisible}
        onCancel={() => {
          setWatermarkModalVisible(false);
        }}
        onOk={(data) => {
          applyWatermarkMutation.mutate(data);
        }}
        selectedRows={selectedRows}
        watermarkConfigs={watermarkConfigs}
        watermarkStep={watermarkStep}
        setWatermarkStep={setWatermarkStep}
        watermarkPreviews={watermarkPreviews}
        setWatermarkPreviews={setWatermarkPreviews}
        confirmLoading={applyWatermarkMutation.isPending}
        previewLoading={previewLoading}
        watermarkAnalyzeMode={watermarkAnalyzeMode}
        onPreview={handlePreview}
      />

      {/* 图片预览组件 */}
      <ImagePreview
        images={previewImages}
        visible={previewVisible}
        initialIndex={previewIndex}
        onClose={() => setPreviewVisible(false)}
        productInfo={currentPreviewProduct}
        onWatermark={() => {
          if (!watermarkConfigs || watermarkConfigs.length === 0) {
            notifyWarning('操作失败', '请先配置水印');
            return;
          }
          setSelectedRows([currentPreviewProduct]);
          setWatermarkModalVisible(true);
          setPreviewVisible(false);
        }}
        onRestore={() => {
          modal.confirm({
            title: '确认还原',
            content: `确定要还原商品 "${currentPreviewProduct?.offer_id}" 的原图吗？`,
            onOk: () => {
              restoreOriginalMutation.mutate([currentPreviewProduct.id]);
              setPreviewVisible(false);
            },
          });
        }}
      />

      {/* 列显示配置Modal */}
      {/* 列显示配置Modal */}
      <ColumnConfigModal
        visible={columnConfigVisible}
        onCancel={closeColumnConfig}
        onOk={closeColumnConfig}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={handleColumnVisibilityChange}
      />

      {/* 同步确认对话框 */}
      <Modal
        title={syncFullMode ? '确认执行全量同步？' : '确认执行增量同步？'}
        open={syncConfirmVisible}
        onOk={handleSyncConfirm}
        onCancel={() => setSyncConfirmVisible(false)}
        okText="确认"
        cancelText="取消"
        zIndex={10000}
      >
        <p>
          {syncFullMode ? '全量同步将拉取所有商品数据，耗时较长' : '增量同步将只拉取最近更新的商品'}
        </p>
      </Modal>

      {/* 商品同步错误详情弹窗 */}
      <ProductSyncErrorModal
        visible={errorModalVisible}
        productId={selectedProductForError}
        onClose={() => {
          setErrorModalVisible(false);
          setSelectedProductForError(null);
        }}
      />
    </div>
  );
};

export default ProductList;
