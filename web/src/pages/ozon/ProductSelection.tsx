/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
/**
 * 选品助手页面
 *
 * 重构说明：
 * - 所有业务逻辑已迁移到 useProductSelection Hook
 * - UI 组件已拆分为独立的子组件
 * - 本文件仅负责组装和布局
 */

import { FilterOutlined, SearchOutlined, HistoryOutlined, BookOutlined } from '@ant-design/icons';
import { Card, Tabs, Modal, Button, Typography } from 'antd';
import React from 'react';

import { useCurrency } from '@/hooks/useCurrency';
import { useProductSelection } from '@/hooks/ozon/useProductSelection';
import ImagePreview from '@/components/ImagePreview';
import FieldConfigModal from '@/components/ozon/selection/FieldConfigModal';
import { ProductSearchForm } from '@/components/ozon/selection/ProductSearchForm';
import { ProductToolbar } from '@/components/ozon/selection/ProductToolbar';
import { ProductGrid } from '@/components/ozon/selection/ProductGrid';
import { ImportHistoryTable } from '@/components/ozon/selection/ImportHistoryTable';
import { ProductSelectionGuide } from '@/components/ozon/selection/ProductSelectionGuide';
import PageTitle from '@/components/PageTitle';
import { formatPrice } from '@/utils/ozon/productFormatters';

import styles from './ProductSelection.module.scss';

const { Text } = Typography;

/**
 * 选品助手页面主组件
 */
const ProductSelection: React.FC = () => {
  const { symbol: userSymbol } = useCurrency();

  // 使用自定义 Hook 获取所有业务逻辑
  const {
    form,
    modal,
    activeTab,
    setActiveTab,
    historyPage,
    setHistoryPage,
    currentBrands,
    allProducts,
    profitableProducts,
    productsLoading,
    totalCount,
    exchangeRate,
    historyData,
    isLoadingMore,
    hasMoreData,
    selectedProductIds,
    toggleProductSelection,
    markingAsRead,
    handleMarkAsRead,
    competitorModalVisible,
    setCompetitorModalVisible,
    selectedProductCompetitors,
    imageModalVisible,
    setImageModalVisible,
    selectedProductImages,
    currentImageIndex,
    fieldConfig,
    fieldConfigVisible,
    setFieldConfigVisible,
    saveFieldConfig,
    resetFieldConfig,
    enableCostEstimation,
    setEnableCostEstimation,
    targetProfitRate,
    setTargetProfitRate,
    packingFee,
    setPackingFee,
    rememberFilters,
    setRememberFilters,
    handleSearch,
    handleReset,
    handleDeleteBatch,
    handleBatchDelete,
    handleViewBatch,
    showCompetitorsList,
    showProductImages,
  } = useProductSelection();

  return (
    <div>
      <PageTitle icon={<FilterOutlined />} title="选品助手" />
      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'search',
              label: (
                <span>
                  <SearchOutlined /> 商品搜索
                </span>
              ),
              children: (
                <>
                  {/* 搜索表单 */}
                  <ProductSearchForm
                    form={form}
                    brands={currentBrands}
                    enableCostEstimation={enableCostEstimation}
                    targetProfitRate={targetProfitRate}
                    packingFee={packingFee}
                    rememberFilters={rememberFilters}
                    onEnableCostChange={setEnableCostEstimation}
                    onProfitRateChange={setTargetProfitRate}
                    onPackingFeeChange={setPackingFee}
                    onRememberChange={setRememberFilters}
                    onSearch={handleSearch}
                    onReset={handleReset}
                  />

                  {/* 工具栏 */}
                  {profitableProducts.length > 0 && (
                    <ProductToolbar
                      loadedCount={profitableProducts.length}
                      totalCount={totalCount}
                      selectedCount={selectedProductIds.size}
                      marking={markingAsRead}
                      onMarkAsRead={handleMarkAsRead}
                      onOpenFieldConfig={() => setFieldConfigVisible(true)}
                    />
                  )}

                  {/* 商品网格 */}
                  <ProductGrid
                    products={profitableProducts}
                    allProductsCount={allProducts.length}
                    loading={productsLoading}
                    isLoadingMore={isLoadingMore}
                    hasMoreData={hasMoreData}
                    totalCount={totalCount}
                    fieldConfig={fieldConfig}
                    enableCostEstimation={enableCostEstimation}
                    targetProfitRate={targetProfitRate}
                    packingFee={packingFee}
                    exchangeRate={exchangeRate}
                    userSymbol={userSymbol}
                    selectedIds={selectedProductIds}
                    onToggleSelect={toggleProductSelection}
                    onShowCompetitors={showCompetitorsList}
                    onShowImages={showProductImages}
                  />
                </>
              ),
            },
            {
              key: 'history',
              label: (
                <span>
                  <HistoryOutlined /> 导入历史
                </span>
              ),
              children: (
                <ImportHistoryTable
                  dataSource={historyData?.data?.items}
                  loading={false}
                  current={historyPage}
                  total={historyData?.data?.total}
                  onPageChange={setHistoryPage}
                  onViewBatch={handleViewBatch}
                  onDeleteBatch={handleDeleteBatch}
                  onBatchDelete={handleBatchDelete}
                />
              ),
            },
            {
              key: 'guide',
              label: (
                <span>
                  <BookOutlined /> 使用指南
                </span>
              ),
              children: <ProductSelectionGuide />,
            },
          ]}
        />

        {/* 跟卖者列表弹窗 */}
        <Modal
          title="跟卖者列表"
          open={competitorModalVisible}
          onCancel={() => setCompetitorModalVisible(false)}
          footer={[
            <Button key="close" onClick={() => setCompetitorModalVisible(false)}>
              关闭
            </Button>,
          ]}
          width={600}
        >
          {selectedProductCompetitors && (
            <div>
              <div className={styles.competitorModalHeader}>
                <Text strong>
                  {selectedProductCompetitors.product_name_cn ||
                    selectedProductCompetitors.product_name_ru}
                </Text>
              </div>
              <div className={styles.competitorModalContent}>
                {selectedProductCompetitors.competitor_min_price ? (
                  <>
                    <Text type="secondary">跟卖者数据已从选品导入中获取</Text>
                    <div className={styles.competitorMinPrice}>
                      <Text>最低跟卖价: </Text>
                      <Text strong className={styles.competitorMinPriceValue}>
                        {userSymbol}
                        {formatPrice(selectedProductCompetitors.competitor_min_price)}
                      </Text>
                    </div>
                  </>
                ) : (
                  <Text type="secondary">暂无跟卖者价格数据</Text>
                )}
              </div>
            </div>
          )}
        </Modal>

        {/* 商品图片浏览 */}
        <ImagePreview
          images={selectedProductImages}
          visible={imageModalVisible}
          initialIndex={currentImageIndex}
          onClose={() => setImageModalVisible(false)}
        />

        {/* 字段配置Modal */}
        <FieldConfigModal
          visible={fieldConfigVisible}
          fieldConfig={fieldConfig}
          onFieldConfigChange={(config) => {
            /* 实时预览，暂不保存 */
          }}
          onSave={saveFieldConfig}
          onReset={resetFieldConfig}
          onCancel={() => setFieldConfigVisible(false)}
        />
      </Card>
    </div>
  );
};

export default ProductSelection;
