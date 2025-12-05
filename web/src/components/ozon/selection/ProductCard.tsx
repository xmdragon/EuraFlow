/**
 * OZON 选品助手 - 商品卡片组件
 *
 * 单个商品的完整展示卡片，支持字段配置和成本估算
 */

import React from 'react';
import { Card, Row, Col, Space, Tag, Typography, Checkbox } from 'antd';
import {
  ShoppingOutlined,
  StarOutlined,
  LinkOutlined,
  ShopOutlined,
} from '@ant-design/icons';

import type { ProductSelectionItem } from '@/services/productSelectionApi';
import type { FieldConfig } from '@/components/ozon/selection/FieldConfigModal';
import { calculateMaxCost, formatMaxCost } from '@/pages/ozon/profitCalculator';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import {
  formatPrice,
  formatWeight,
  formatCurrency,
  formatSalesRevenue,
  formatPercent,
  formatNum,
  formatDate,
} from '@/utils/ozon/productFormatters';

import styles from '@/pages/ozon/ProductSelection.module.scss';

// 只保留需要特殊功能的 Typography 组件（省略+tooltip、复制）
const { Text, Paragraph } = Typography;

/**
 * 商品卡片组件 Props
 */
export interface ProductCardProps {
  /** 商品数据 */
  product: ProductSelectionItem;
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
  /** 是否已选中 */
  selected: boolean;
  /** 切换选中状态 */
  onToggleSelect: (id: number) => void;
  /** 显示竞争对手列表 */
  onShowCompetitors: (product: ProductSelectionItem) => void;
  /** 显示商品图片 */
  onShowImages: (product: ProductSelectionItem) => void;
}

/**
 * 商品卡片组件
 * 使用 React.memo 避免不必要的重渲染
 */
export const ProductCard: React.FC<ProductCardProps> = React.memo(({
  product,
  fieldConfig,
  enableCostEstimation,
  targetProfitRate,
  packingFee,
  exchangeRate,
  userSymbol,
  selected,
  onToggleSelect,
  onShowCompetitors,
  onShowImages,
}) => {
  // 计算折扣
  const _discount = product.original_price
    ? Math.round((1 - product.current_price / product.original_price) * 100)
    : 0;

  // 渲染封面图片
  const renderCover = () => {
    if (product.image_url) {
      // 获取 wc800 版本的图片URL用于1688搜索
      const wc800Url = optimizeOzonImageUrl(product.image_url, 800);
      const alibaba1688Url = `https://s.1688.com/youyuan/index.htm?ob_search=${encodeURIComponent(wc800Url)}`;

      return (
        <div className={styles.productCover} onClick={() => onShowImages(product)}>
          {/* 复选框 - 左上角 */}
          <Checkbox
            className={styles.productCheckbox}
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect(product.id);
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <img
            alt={product.product_name_cn}
            src={optimizeOzonImageUrl(product.image_url, 160)}
            className={styles.productImage}
          />
          {/* OZON链接 - 右上角（使用原生 title 提升性能） */}
          <div
            className={styles.linkIconOverlay}
            title="打开OZON链接"
            onClick={(e) => {
              e.stopPropagation();
              window.open(product.ozon_link, '_blank');
            }}
          >
            <LinkOutlined />
          </div>
          {/* 1688找货源 - 右下角（使用原生 title 提升性能） */}
          <div
            className={styles.sourcingIconOverlay}
            title="在1688找货源"
            onClick={(e) => {
              e.stopPropagation();
              window.open(alibaba1688Url, '_blank');
            }}
          >
            <ShopOutlined />
          </div>
        </div>
      );
    } else {
      return (
        <div
          className={styles.productImagePlaceholder}
          onClick={() => window.open(product.ozon_link, '_blank')}
        >
          <Checkbox
            className={styles.productCheckbox}
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect(product.id);
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <ShoppingOutlined />
        </div>
      );
    }
  };

  // 渲染成本上限
  const renderCostLimit = () => {
    if (!enableCostEstimation) return null;

    // 价格已经是元为单位，无需除100
    const currentPriceRUB = product.current_price;
    const competitorPriceRUB =
      product.competitor_min_price !== null && product.competitor_min_price !== undefined
        ? product.competitor_min_price
        : null;

    const priceRUB =
      competitorPriceRUB !== null
        ? Math.min(currentPriceRUB, competitorPriceRUB)
        : currentPriceRUB;

    const weight = product.package_weight || 0;

    const commissionRates = {
      rfbs_low: product.rfbs_commission_low || undefined,
      rfbs_mid: product.rfbs_commission_mid || undefined,
      rfbs_high: product.rfbs_commission_high || undefined,
    };

    const maxCost =
      weight > 0 && priceRUB > 0
        ? calculateMaxCost(
            priceRUB,
            weight,
            targetProfitRate / 100,
            packingFee,
            exchangeRate || undefined,
            commissionRates
          )
        : null;

    let costClassName = styles.maxCostRow;
    if (maxCost === null) {
      costClassName = `${styles.maxCostRow} ${styles.maxCostUnavailable}`;
    } else if (maxCost < 0) {
      costClassName = `${styles.maxCostRow} ${styles.maxCostNegative}`;
    } else {
      costClassName = `${styles.maxCostRow} ${styles.maxCostPositive}`;
    }

    return (
      <div className={costClassName}>
        <span className={styles.labelSecondary}>成本上限: </span>
        <span className={styles.valueStrong}>{formatMaxCost(maxCost)}</span>
      </div>
    );
  };

  return (
    <Card key={product.id} hoverable size="small" className={styles.productCard} cover={renderCover()}>
      <div className={styles.productCardBody}>
        {/* 商品名称 - 始终显示 */}
        <Paragraph
          ellipsis={{ rows: 2, tooltip: product.product_name_cn }}
          className={styles.productName}
        >
          {product.product_name_cn || product.product_name_ru}
        </Paragraph>

        {/* SKU - 可复制（不需要省略） */}
        <div className={styles.skuRow}>
          <span className={styles.skuLabel}>SKU: </span>
          <Text copyable={{ text: product.product_id }} className={styles.skuValue}>
            {product.product_id}
          </Text>
        </div>

        {/* 价格信息 - 始终显示当前价（使用系统货币） */}
        <div className={styles.priceContainer}>
          <div className={styles.priceRow}>
            <span className={styles.currentPrice}>
              {userSymbol}{formatPrice(product.current_price)}
            </span>
            {fieldConfig.originalPrice && product.original_price && (
              <span className={styles.originalPrice}>
                {userSymbol}{formatPrice(product.original_price)}
              </span>
            )}
          </div>
        </div>

        {/* 品牌 */}
        {fieldConfig.brand && (
          <div className={styles.brandInfo}>
            <span className={styles.labelSecondary}>品牌: </span>
            <span>
              {product.brand === '非热销,无数据'
                ? '-'
                : product.brand === 'без бренда'
                  ? '无品牌'
                  : product.brand || '无品牌'}
            </span>
          </div>
        )}

        {/* 类目 */}
        {fieldConfig.category && product.category_path && (
          <div className={styles.brandInfo}>
            <span className={styles.labelSecondary}>类目: </span>
            <span>{product.category_path === '非热销,无数据' ? '-' : product.category_path}</span>
          </div>
        )}

        {/* rFBS佣金 - 横向三标签（使用原生 title 替代 Tooltip 提升性能） */}
        {fieldConfig.rfbsCommission && (
          <div className={styles.commissionRow} title="rFBS佣金率">
            <span className={styles.labelSecondary}>rFBS: </span>
            <Space size={4}>
              <Tag color="success" title="售价 ≤1500₽">{product.rfbs_commission_low ?? '-'}</Tag>
              <Tag color="warning" title="售价 1501~5000₽">{product.rfbs_commission_mid ?? '-'}</Tag>
              <Tag color="error" title="售价 >5000₽">{product.rfbs_commission_high ?? '-'}</Tag>
            </Space>
          </div>
        )}

        {/* FBP佣金 - 横向三标签（使用原生 title 替代 Tooltip 提升性能） */}
        {fieldConfig.fbpCommission && (
          <div className={styles.commissionRow} title="FBP佣金率">
            <span className={styles.labelSecondary}>&nbsp;FBP: </span>
            <Space size={4}>
              <Tag color="success" title="售价 ≤1500₽">{product.fbp_commission_low ?? '-'}</Tag>
              <Tag color="warning" title="售价 1501~5000₽">{product.fbp_commission_mid ?? '-'}</Tag>
              <Tag color="error" title="售价 >5000₽">{product.fbp_commission_high ?? '-'}</Tag>
            </Space>
          </div>
        )}

        {/* 月销量+月销售额（使用原生 title 提升性能） */}
        {(fieldConfig.monthlySales || fieldConfig.monthlySalesRevenue) && (
          <div className={styles.statsItem} title="月销量 & 月销售额">
            <span className={styles.labelSecondary}>月销: </span>
            <span className={styles.valueStrong}>
              {product.monthly_sales_volume ? `${formatNum(product.monthly_sales_volume)} 件` : ''}{' '}
              {formatSalesRevenue(product.monthly_sales_revenue, exchangeRate)}
            </span>
          </div>
        )}

        {/* 日销量+日销售额（使用原生 title 提升性能） */}
        {fieldConfig.dailySales && (
          <div className={styles.statsItem} title="日销量 & 日销售额">
            <span className={styles.labelSecondary}>日销: </span>
            <span className={styles.valueStrong}>
              {product.daily_sales_volume ? `${formatNum(product.daily_sales_volume)} 件` : ''}{' '}
              {formatSalesRevenue(product.daily_sales_revenue, exchangeRate)}
            </span>
          </div>
        )}

        {/* 销售动态+点击率 - 两列布局（使用原生 title 提升性能） */}
        {fieldConfig.salesDynamic && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12} title="月销售动态">
              <span className={styles.labelSecondary}>动态: </span>
              <span className={styles.valueStrong}>{formatPercent(product.sales_dynamic_percent)}</span>
            </Col>
            <Col span={12} title="点击率">
              <span className={styles.labelSecondary}>点击: </span>
              <span className={styles.valueStrong}>{formatPercent(product.click_through_rate)}</span>
            </Col>
          </Row>
        )}

        {/* 卡片浏览量+加购率 - 两列布局（使用原生 title 提升性能） */}
        {fieldConfig.cardMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12} title="商品卡片浏览量">
              <span className={styles.labelSecondary}>卡片: </span>
              <span className={styles.valueStrong}>{formatNum(product.card_views)}</span>
            </Col>
            <Col span={12} title="商品卡片加购率">
              <span className={styles.labelSecondary}>加购: </span>
              <span className={styles.valueStrong}>{formatPercent(product.card_add_to_cart_rate)}</span>
            </Col>
          </Row>
        )}

        {/* 搜索浏览量+加购率 - 两列布局（使用原生 title 提升性能） */}
        {fieldConfig.searchMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12} title="搜索浏览量">
              <span className={styles.labelSecondary}>搜索: </span>
              <span className={styles.valueStrong}>{formatNum(product.search_views)}</span>
            </Col>
            <Col span={12} title="搜索加购率">
              <span className={styles.labelSecondary}>加购: </span>
              <span className={styles.valueStrong}>{formatPercent(product.search_add_to_cart_rate)}</span>
            </Col>
          </Row>
        )}

        {/* 促销天数+折扣+转化率 - 单行布局（使用原生 title 提升性能） */}
        {fieldConfig.promoMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={24} title="参与促销天数 & 折扣 & 转化率">
              <span className={styles.labelSecondary}>促销: </span>
              <span className={styles.valueStrong}>
                {product.promo_days ? `${product.promo_days}天` : '-'}{' '}
                {formatPercent(product.promo_discount_percent)}{' '}
                {formatPercent(product.promo_conversion_rate)}
              </span>
            </Col>
          </Row>
        )}

        {/* 付费推广+份额 - 两列布局（使用原生 title 提升性能） */}
        {fieldConfig.paidPromo && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12} title="付费推广天数">
              <span className={styles.labelSecondary}>付费: </span>
              <span className={styles.valueStrong}>{product.paid_promo_days ? `${product.paid_promo_days}天` : '-'}</span>
            </Col>
            <Col span={12} title="广告份额">
              <span className={styles.labelSecondary}>份额: </span>
              <span className={styles.valueStrong}>{formatPercent(product.ad_cost_share)}</span>
            </Col>
          </Row>
        )}

        {/* 成交率+退货率 - 两列布局（使用原生 title 提升性能） */}
        {fieldConfig.conversionMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12} title="成交率">
              <span className={styles.labelSecondary}>成交: </span>
              <span className={styles.valueStrong}>{formatPercent(product.conversion_rate)}</span>
            </Col>
            <Col span={12} title="退货取消率">
              <span className={styles.labelSecondary}>退取: </span>
              <span className={styles.valueStrong}>{formatPercent(product.return_cancel_rate)}</span>
            </Col>
          </Row>
        )}

        {/* 平均价格+重量 - 两列布局（使用原生 title 提升性能） */}
        {(fieldConfig.avgPrice || fieldConfig.weight) && (
          <Row gutter={1} className={styles.statsItem}>
            {fieldConfig.avgPrice && (
              <Col span={12} title="平均价格">
                <span className={styles.labelSecondary}>均价: </span>
                <span className={styles.valueStrong}>{formatCurrency(product.avg_price, exchangeRate)}</span>
              </Col>
            )}
            {fieldConfig.weight && (
              <Col span={12} title="包装重量">
                <span className={styles.labelSecondary}>重量: </span>
                <span className={styles.valueStrong}>{formatWeight(product.package_weight)}</span>
              </Col>
            )}
          </Row>
        )}

        {/* 包装尺寸（使用原生 title 提升性能） */}
        {fieldConfig.dimensions && (
          <div className={styles.statsItem} title="长×宽×高(mm)">
            <span className={styles.labelSecondary}>尺寸: </span>
            <span className={styles.valueStrong}>
              {product.package_length && product.package_width && product.package_height
                ? `${product.package_length}×${product.package_width}×${product.package_height}`
                : '-'}
            </span>
          </div>
        )}

        {/* 发货模式（使用原生 title 提升性能） */}
        {fieldConfig.sellerMode && (
          <div className={styles.statsItem} title="发货模式(FBS:跨境店，FBO:本地店)">
            <span className={styles.labelSecondary}>模式: </span>
            <span className={styles.valueStrong}>{product.seller_mode || '-'}</span>
          </div>
        )}

        {/* 竞争对手数据（使用原生 title 提升性能） */}
        {fieldConfig.competitors && (
          <div className={styles.statsItem} title="跟卖数量 & 最低跟卖价">
            <span className={styles.labelSecondary}>跟卖: </span>
            {product.competitor_count !== null && product.competitor_count !== undefined ? (
              product.competitor_count > 0 ? (
                <span
                  className={`${styles.valueStrong} ${styles.competitorCount}`}
                  onClick={() => onShowCompetitors(product)}
                >
                  {product.competitor_count}
                  {product.competitor_min_price !== null &&
                    product.competitor_min_price !== undefined && (
                      <>
                        （{userSymbol}{formatPrice(product.competitor_min_price)}）
                      </>
                    )}
                </span>
              ) : (
                <span className={styles.placeholderText}>无跟卖</span>
              )
            ) : (
              <span className={styles.placeholderText}>无数据</span>
            )}
          </div>
        )}

        {/* 评分和上架时间 - 合并为一行（使用原生 title 提升性能） */}
        {(fieldConfig.rating || fieldConfig.listingDate) && (
          <div className={styles.ratingAndDateRow}>
            {fieldConfig.rating && (
              <div className={styles.ratingSection} title="商品评分 & 评价数量">
                {product.rating ? (
                  <>
                    <StarOutlined />
                    <span className={`${styles.valueStrong} ${styles.ratingValue}`}>
                      {product.rating}
                    </span>
                    <span className={`${styles.labelSecondary} ${styles.reviewCount}`}>
                      ({product.review_count})
                    </span>
                  </>
                ) : (
                  <span className={styles.labelSecondary} style={{ fontSize: '11px' }}>
                    -
                  </span>
                )}
              </div>
            )}
            {fieldConfig.listingDate && (
              <div className={styles.listingDate} title="上架时间">
                <span className={styles.labelSecondary} style={{ fontSize: '11px' }}>
                  {product.listing_date ? formatDate(product.listing_date) : '-'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 成本上限计算 - 仅在启用成本估算时显示 */}
        {renderCostLimit()}
      </div>
    </Card>
  );
});

// 设置 displayName 便于 React DevTools 调试
ProductCard.displayName = 'ProductCard';
