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

import DescriptionEditModal from './components/DescriptionEditModal';
import ProductSyncErrorModal from './components/ProductSyncErrorModal';
import styles from './ProductList.module.scss';

import ImagePreview from '@/components/ImagePreview';
import { ColumnConfigModal } from '@/components/ozon/product/ColumnConfigModal';
import PriceEditModal from '@/components/ozon/product/PriceEditModal';
import ProductFilterBar from '@/components/ozon/product/ProductFilterBar';
import ProductToolbar from '@/components/ozon/product/ProductToolbar';
import StockEditModal from '@/components/ozon/product/StockEditModal';
import { WatermarkApplyModal, type WatermarkPreview } from '@/components/ozon/watermark/WatermarkApplyModal';
import PageTitle from '@/components/PageTitle';
import { getProductTableColumns } from '@/config/ozon/productTableColumns';
import { useColumnConfig } from '@/hooks/ozon/useColumnConfig';
import { useProductOperations } from '@/hooks/ozon/useProductOperations';
import { useProductSync } from '@/hooks/ozon/useProductSync';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { useWatermark } from '@/hooks/ozon/useWatermark';
import { useCurrency } from '@/hooks/useCurrency';
import { usePermission } from '@/hooks/usePermission';
import authService from '@/services/authService';
import * as ozonApi from '@/services/ozon';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

import './ProductList.css';

const ProductList: React.FC = () => {
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canOperate, canSync, canDelete } = usePermission();
  const { symbol: currencySymbol } = useCurrency();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRows, setSelectedRows] = useState<ozonApi.Product[]>([]);
  const { selectedShop, handleShopChange } = useShopSelection();
  const [filterForm] = Form.useForm();
  const [filterValues, setFilterValues] = useState<ozonApi.ProductFilter>(() => {
    // 默认为"销售中"商品
    return {
      status: 'on_sale',
    };
  });
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [selectedProductForError, setSelectedProductForError] = useState<number | null>(null);

  // 描述编辑弹窗状态
  const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
  const [selectedProductForDescription, setSelectedProductForDescription] = useState<{id: number; title: string} | null>(null);

  // 排序状态管理
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);

  // 水印相关UI状态
  const [watermarkModalVisible, setWatermarkModalVisible] = useState(false);
  const [watermarkStep, setWatermarkStep] = useState<'select' | 'preview'>('select');
  const [watermarkPreviews, setWatermarkPreviews] = useState<WatermarkPreview[]>([]);
  const [watermarkAnalyzeMode] = useState<'individual' | 'fast'>('individual');

  // 图片预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [currentPreviewProduct, setCurrentPreviewProduct] = useState<ozonApi.Product | null>(null);

  // 处理排序 - 直接设置排序方向
  const handleSort = (field: string, order: 'asc' | 'desc') => {
    // 如果点击的是当前激活的排序，则取消排序
    if (sortBy === field && sortOrder === order) {
      setSortBy(null);
      setSortOrder(null);
    } else {
      setSortBy(field);
      setSortOrder(order);
    }
    // 重置到第一页
    setCurrentPage(1);
  };

  // 列标题排序组件 - 升序降序分开显示，可直接点击
  const SortableColumnTitle: React.FC<{ title: string; field: string }> = ({ title, field }) => {
    const isActive = sortBy === field;
    const isAsc = isActive && sortOrder === 'asc';
    const isDesc = isActive && sortOrder === 'desc';

    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            cursor: 'pointer',
            fontSize: '10px',
            color: isAsc ? '#1890ff' : '#bfbfbf',
            padding: '2px 4px',
            borderRadius: '2px',
            transition: 'all 0.2s',
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleSort(field, 'asc');
          }}
          title="升序"
        >
          ▲
        </span>
        <span>{title}</span>
        <span
          style={{
            cursor: 'pointer',
            fontSize: '10px',
            color: isDesc ? '#1890ff' : '#bfbfbf',
            padding: '2px 4px',
            borderRadius: '2px',
            transition: 'all 0.2s',
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleSort(field, 'desc');
          }}
          title="降序"
        >
          ▼
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

      const result = await ozonApi.getProducts(currentPage, pageSize, { ...params, include_stats: true });

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
    handleBatchDelete,
  } = useProductOperations(selectedShop);

  // 商品同步 Hook
  const {
    syncProductsMutation,
    syncProgress,
    handleSync,
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

  // 处理描述编辑
  const handleDescription = (product: ozonApi.Product) => {
    setSelectedProductForDescription({
      id: product.id,
      title: product.title,
    });
    setDescriptionModalVisible(true);
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
    handleDescription,
    handleImageClick,
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
        stats={globalStats?.products}
      />

      {/* 操作按钮 */}
      <Card className={styles.listCard}>
        <ProductToolbar
          canSync={canSync}
          canOperate={canOperate}
          canDelete={canDelete}
          selectedRowsCount={selectedRows.length}
          syncLoading={syncProductsMutation.isPending}
          syncProgress={syncProgress}
          hasSelectedShop={selectedShop !== null}
          isArchivedTab={filterValues.status === 'archived'}
          onIncrementalSync={() => handleSync(false)}
          onFullSync={() => handleSync(true)}
          onBatchPriceUpdate={handleBatchPriceUpdate}
          onBatchStockUpdate={handleBatchStockUpdate}
          onColumnSettings={openColumnConfig}
          onBatchDelete={() => handleBatchDelete(selectedRows)}
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
        onSubmit={(updates) => updatePricesMutation.mutate(updates as ozonApi.PriceUpdate[])}
        selectedProduct={selectedProduct}
        selectedRows={selectedRows}
        loading={updatePricesMutation.isPending}
      />

      {/* 库存更新弹窗 */}
      <StockEditModal
        visible={stockModalVisible}
        onCancel={() => setStockModalVisible(false)}
        onSubmit={(updates) => updateStocksMutation.mutate(updates as ozonApi.StockUpdate[])}
        selectedProduct={selectedProduct}
        selectedRows={selectedRows}
        loading={updateStocksMutation.isPending}
        shopId={selectedShop}
      />

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

      {/* 商品同步错误详情弹窗 */}
      <ProductSyncErrorModal
        visible={errorModalVisible}
        productId={selectedProductForError}
        onClose={() => {
          setErrorModalVisible(false);
          setSelectedProductForError(null);
        }}
      />

      {/* 商品描述编辑弹窗 */}
      <DescriptionEditModal
        visible={descriptionModalVisible}
        productId={selectedProductForDescription?.id || null}
        productTitle={selectedProductForDescription?.title}
        onClose={() => {
          setDescriptionModalVisible(false);
          setSelectedProductForDescription(null);
        }}
      />
    </div>
  );
};

export default ProductList;
