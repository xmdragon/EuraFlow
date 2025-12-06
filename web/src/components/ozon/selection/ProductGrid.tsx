/**
 * OZON 选品助手 - 商品网格布局组件
 *
 * 负责商品卡片的网格布局和加载状态展示
 */

import React, { useRef, useCallback } from 'react';
import { Spin, Empty, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

import type { ProductSelectionItem } from '@/services/productSelectionApi';
import type { FieldConfig } from '@/components/ozon/selection/FieldConfigModal';
import { ProductCard } from './ProductCard';

import styles from '@/pages/ozon/ProductSelection.module.scss';

const { Text } = Typography;

/**
 * 商品网格组件 Props
 */
export interface ProductGridProps {
  /** 商品列表 */
  products: ProductSelectionItem[];
  /** 所有商品总数（未过滤） */
  allProductsCount: number;
  /** 是否正在加载（首次加载） */
  loading: boolean;
  /** 是否正在加载更多 */
  isLoadingMore: boolean;
  /** 是否还有更多数据 */
  hasMoreData: boolean;
  /** 总商品数量 */
  totalCount: number;
  /** 字段配置 */
  fieldConfig: FieldConfig;
  /** 是否启用成本估算 */
  enableCostEstimation: boolean;
  /** 目标利润率（百分比） */
  targetProfitRate: number;
  /** 打包费（RMB） */
  packingFee: number;
  /** 汇率（CNY/RUB） */
  exchangeRate: number | null;
  /** 用户货币符号 */
  userSymbol: string;
  /** 已选中的商品ID集合 */
  selectedIds: Set<number>;
  /** 切换选中状态 */
  onToggleSelect: (id: number) => void;
  /** 批量切换选中状态（用于 Ctrl+点击整行选中） */
  onBatchToggleSelect?: (ids: number[]) => void;
  /** 显示竞争对手列表 */
  onShowCompetitors: (product: ProductSelectionItem) => void;
  /** 显示商品图片 */
  onShowImages: (product: ProductSelectionItem) => void;
}

/**
 * 商品网格组件
 * 使用 React.memo 避免不必要的重渲染
 */
export const ProductGrid: React.FC<ProductGridProps> = React.memo(({
  products,
  allProductsCount,
  loading,
  isLoadingMore,
  hasMoreData,
  totalCount: _totalCount,
  fieldConfig,
  enableCostEstimation,
  targetProfitRate,
  packingFee,
  exchangeRate,
  userSymbol,
  selectedIds,
  onToggleSelect,
  onBatchToggleSelect,
  onShowCompetitors,
  onShowImages,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);

  // 处理 Ctrl+点击整行选中
  const handleRowSelect = useCallback((productIndex: number) => {
    if (!onBatchToggleSelect || !gridRef.current) return;

    // 实时计算每行列数（避免闭包问题）
    const gridElement = gridRef.current;
    const firstChild = gridElement.firstElementChild as HTMLElement;
    if (!firstChild) return;

    const gridWidth = gridElement.clientWidth;
    const itemWidth = firstChild.offsetWidth;
    const gap = 2;

    const cols = itemWidth > 0 ? Math.floor((gridWidth + gap) / (itemWidth + gap)) : 0;
    if (cols <= 0) return;

    // 计算当前商品所在行的起始和结束索引
    const rowIndex = Math.floor(productIndex / cols);
    const startIndex = rowIndex * cols;
    const endIndex = Math.min(startIndex + cols, products.length);

    // 获取这一行所有商品的 ID
    const rowProductIds = products.slice(startIndex, endIndex).map(p => p.id);
    onBatchToggleSelect(rowProductIds);
  }, [products, onBatchToggleSelect]);

  // 首次加载状态
  if (loading && products.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 空状态
  if (products.length === 0) {
    return <Empty description="暂无商品数据" />;
  }

  return (
    <>
      {/* 商品网格 */}
      <div className={styles.productGrid} ref={gridRef}>
        {products.map((product, index) => (
          <div key={product.id}>
            <ProductCard
              product={product}
              fieldConfig={fieldConfig}
              enableCostEstimation={enableCostEstimation}
              targetProfitRate={targetProfitRate}
              packingFee={packingFee}
              exchangeRate={exchangeRate}
              userSymbol={userSymbol}
              selected={selectedIds.has(product.id)}
              onToggleSelect={onToggleSelect}
              onRowSelect={() => handleRowSelect(index)}
              onShowCompetitors={onShowCompetitors}
              onShowImages={onShowImages}
            />
          </div>
        ))}
      </div>

      {/* 加载更多提示 */}
      {isLoadingMore && (
        <div className={styles.loadingMore}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
          <Text type="secondary" style={{ marginLeft: 12 }}>
            加载中...
          </Text>
        </div>
      )}

      {/* 已加载完所有数据 */}
      {!hasMoreData && products.length > 0 && (
        <div className={styles.loadingMore}>
          <Text type="secondary">
            {enableCostEstimation ? (
              <>
                已加载 {allProductsCount} 件商品，显示 {products.length} 件 （已过滤{' '}
                {allProductsCount - products.length} 件利润率不达标商品）
              </>
            ) : (
              <>已显示全部 {allProductsCount} 件商品</>
            )}
          </Text>
        </div>
      )}
    </>
  );
});

// 设置 displayName 便于 React DevTools 调试
ProductGrid.displayName = 'ProductGrid';
