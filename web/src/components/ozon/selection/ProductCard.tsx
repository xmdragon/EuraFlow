/**
 * OZON 选品助手 - 商品卡片组件
 *
 * 单个商品的完整展示卡片，支持字段配置和成本估算
 */

import React from 'react';
import { Card, Row, Col, Space, Tag, Typography, Checkbox, Tooltip } from 'antd';
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
  formatPercent,
  formatNum,
  formatDate,
} from '@/utils/ozon/productFormatters';

import styles from '@/pages/ozon/ProductSelection.module.scss';

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
 */
export const ProductCard: React.FC<ProductCardProps> = ({
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
  const discount = product.original_price
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
          {/* OZON链接 - 右上角 */}
          <Tooltip title="打开OZON链接">
            <div
              className={styles.linkIconOverlay}
              onClick={(e) => {
                e.stopPropagation();
                window.open(product.ozon_link, '_blank');
              }}
            >
              <LinkOutlined />
            </div>
          </Tooltip>
          {/* 1688找货源 - 右下角 */}
          <Tooltip title="在1688找货源">
            <div
              className={styles.sourcingIconOverlay}
              onClick={(e) => {
                e.stopPropagation();
                window.open(alibaba1688Url, '_blank');
              }}
            >
              <ShopOutlined />
            </div>
          </Tooltip>
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

    const currentPriceRMB = product.current_price / 100;
    const competitorPriceRMB =
      product.competitor_min_price !== null && product.competitor_min_price !== undefined
        ? product.competitor_min_price / 100
        : null;

    const priceRMB =
      competitorPriceRMB !== null
        ? Math.min(currentPriceRMB, competitorPriceRMB)
        : currentPriceRMB;

    const weight = product.package_weight || 0;

    const commissionRates = {
      rfbs_low: product.rfbs_commission_low || undefined,
      rfbs_mid: product.rfbs_commission_mid || undefined,
      rfbs_high: product.rfbs_commission_high || undefined,
    };

    const maxCost =
      weight > 0 && priceRMB > 0
        ? calculateMaxCost(
            priceRMB,
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
        <Text type="secondary">成本上限: </Text>
        <Text strong>{formatMaxCost(maxCost)}</Text>
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

        {/* SKU - 可复制 */}
        <div className={styles.skuRow}>
          <Text type="secondary" className={styles.skuLabel}>
            SKU:{' '}
          </Text>
          <Text copyable={{ text: product.product_id }} className={styles.skuValue} ellipsis>
            {product.product_id}
          </Text>
        </div>

        {/* 价格信息 - 始终显示当前价 */}
        <div className={styles.priceContainer}>
          <div className={styles.priceRow}>
            <Text strong className={styles.currentPrice}>
              {userSymbol}
              {formatPrice(product.current_price)}
            </Text>
            {fieldConfig.originalPrice && product.original_price && (
              <Text delete className={styles.originalPrice}>
                {userSymbol}
                {formatPrice(product.original_price)}
              </Text>
            )}
          </div>
        </div>

        {/* 品牌 */}
        {fieldConfig.brand && (
          <div className={styles.brandInfo}>
            <Text type="secondary">品牌: </Text>
            <Text>
              {product.brand === '非热销,无数据'
                ? '-'
                : product.brand === 'без бренда'
                  ? '无品牌'
                  : product.brand || '无品牌'}
            </Text>
          </div>
        )}

        {/* 类目 */}
        {fieldConfig.category && product.category_path && (
          <div className={styles.brandInfo}>
            <Text type="secondary">类目: </Text>
            <Text>{product.category_path === '非热销,无数据' ? '-' : product.category_path}</Text>
          </div>
        )}

        {/* rFBS佣金 - 横向三标签 */}
        {fieldConfig.rfbsCommission && (
          <div className={styles.commissionRow}>
            <Text type="secondary">rFBS: </Text>
            <Space size={4}>
              <Tag color="success">{product.rfbs_commission_low ?? '-'}</Tag>
              <Tag color="warning">{product.rfbs_commission_mid ?? '-'}</Tag>
              <Tag color="error">{product.rfbs_commission_high ?? '-'}</Tag>
            </Space>
          </div>
        )}

        {/* FBP佣金 - 横向三标签 */}
        {fieldConfig.fbpCommission && (
          <div className={styles.commissionRow}>
            <Text type="secondary">FBP: </Text>
            <Space size={4}>
              <Tag color="success">{product.fbp_commission_low ?? '-'}</Tag>
              <Tag color="warning">{product.fbp_commission_mid ?? '-'}</Tag>
              <Tag color="error">{product.fbp_commission_high ?? '-'}</Tag>
            </Space>
          </div>
        )}

        {/* 月销量+月销售额 */}
        {(fieldConfig.monthlySales || fieldConfig.monthlySalesRevenue) && (
          <div className={styles.statsItem}>
            <Text type="secondary">月销: </Text>
            <Text strong>
              {product.monthly_sales_volume ? `${formatNum(product.monthly_sales_volume)} 件` : ''}{' '}
              {formatCurrency(product.monthly_sales_revenue, exchangeRate)}
            </Text>
          </div>
        )}

        {/* 日销量+日销售额 */}
        {fieldConfig.dailySales && (
          <div className={styles.statsItem}>
            <Text type="secondary">日销: </Text>
            <Text strong>
              {product.daily_sales_volume ? `${formatNum(product.daily_sales_volume)} 件` : ''}{' '}
              {formatCurrency(product.daily_sales_revenue, exchangeRate)}
            </Text>
          </div>
        )}

        {/* 销售动态+点击率 - 两列布局 */}
        {fieldConfig.salesDynamic && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12}>
              <Text type="secondary">动态: </Text>
              <Text strong>{formatPercent(product.sales_dynamic_percent)}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary">点击: </Text>
              <Text strong>{formatPercent(product.click_through_rate)}</Text>
            </Col>
          </Row>
        )}

        {/* 卡片浏览量+加购率 - 两列布局 */}
        {fieldConfig.cardMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12}>
              <Text type="secondary">卡片: </Text>
              <Text strong>{formatNum(product.card_views)}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary">加购: </Text>
              <Text strong>{formatPercent(product.card_add_to_cart_rate)}</Text>
            </Col>
          </Row>
        )}

        {/* 搜索浏览量+加购率 - 两列布局 */}
        {fieldConfig.searchMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12}>
              <Text type="secondary">搜索: </Text>
              <Text strong>{formatNum(product.search_views)}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary">加购: </Text>
              <Text strong>{formatPercent(product.search_add_to_cart_rate)}</Text>
            </Col>
          </Row>
        )}

        {/* 促销天数+折扣+转化率 - 单行布局 */}
        {fieldConfig.promoMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={24}>
              <Text type="secondary">促销: </Text>
              <Text strong>
                {product.promo_days ? `${product.promo_days}天` : '-'}{' '}
                {formatPercent(product.promo_discount_percent)}{' '}
                {formatPercent(product.promo_conversion_rate)}
              </Text>
            </Col>
          </Row>
        )}

        {/* 付费推广+份额 - 两列布局 */}
        {fieldConfig.paidPromo && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12}>
              <Text type="secondary">付费: </Text>
              <Text strong>{product.paid_promo_days ? `${product.paid_promo_days}天` : '-'}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary">份额: </Text>
              <Text strong>{formatPercent(product.ad_cost_share)}</Text>
            </Col>
          </Row>
        )}

        {/* 成交率+退货率 - 两列布局 */}
        {fieldConfig.conversionMetrics && (
          <Row gutter={1} className={styles.statsItem}>
            <Col span={12}>
              <Text type="secondary">成交: </Text>
              <Text strong>{formatPercent(product.conversion_rate)}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary">退取: </Text>
              <Text strong>{formatPercent(product.return_cancel_rate)}</Text>
            </Col>
          </Row>
        )}

        {/* 平均价格+重量 - 两列布局 */}
        {(fieldConfig.avgPrice || fieldConfig.weight) && (
          <Row gutter={1} className={styles.statsItem}>
            {fieldConfig.avgPrice && (
              <Col span={12}>
                <Text type="secondary">均价: </Text>
                <Text strong>{formatCurrency(product.avg_price, exchangeRate)}</Text>
              </Col>
            )}
            {fieldConfig.weight && (
              <Col span={12}>
                <Text type="secondary">重量: </Text>
                <Text strong>{formatWeight(product.package_weight)}</Text>
              </Col>
            )}
          </Row>
        )}

        {/* 包装尺寸 */}
        {fieldConfig.dimensions && (
          <div className={styles.statsItem}>
            <Text type="secondary">尺寸: </Text>
            <Text strong>
              {product.package_length && product.package_width && product.package_height
                ? `${product.package_length}×${product.package_width}×${product.package_height}`
                : '-'}
            </Text>
          </div>
        )}

        {/* 发货模式 */}
        {fieldConfig.sellerMode && (
          <div className={styles.statsItem}>
            <Text type="secondary">模式: </Text>
            <Text strong>{product.seller_mode || '-'}</Text>
          </div>
        )}

        {/* 竞争对手数据 */}
        {fieldConfig.competitors && (
          <div className={styles.statsItem}>
            <Text type="secondary">跟卖: </Text>
            {product.competitor_count !== null && product.competitor_count !== undefined ? (
              product.competitor_count > 0 ? (
                <Text
                  strong
                  className={styles.competitorCount}
                  onClick={() => onShowCompetitors(product)}
                >
                  {product.competitor_count}
                  {product.competitor_min_price !== null &&
                    product.competitor_min_price !== undefined && (
                      <>
                        （{userSymbol}
                        {formatPrice(product.competitor_min_price)}）
                      </>
                    )}
                </Text>
              ) : (
                <Text className={styles.placeholderText}>无跟卖</Text>
              )
            ) : (
              <Text className={styles.placeholderText}>无数据</Text>
            )}
          </div>
        )}

        {/* 评分和上架时间 - 合并为一行 */}
        {(fieldConfig.rating || fieldConfig.listingDate) && (
          <div className={styles.ratingAndDateRow}>
            {fieldConfig.rating && (
              <div className={styles.ratingSection}>
                {product.rating ? (
                  <>
                    <StarOutlined />
                    <Text strong className={styles.ratingValue}>
                      {product.rating}
                    </Text>
                    <Text type="secondary" className={styles.reviewCount}>
                      ({product.review_count})
                    </Text>
                  </>
                ) : (
                  <Text type="secondary" style={{ fontSize: '11px' }}>
                    -
                  </Text>
                )}
              </div>
            )}
            {fieldConfig.listingDate && (
              <div className={styles.listingDate}>
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  {product.listing_date ? formatDate(product.listing_date) : '-'}
                </Text>
              </div>
            )}
          </div>
        )}

        {/* 成本上限计算 - 仅在启用成本估算时显示 */}
        {renderCostLimit()}
      </div>
    </Card>
  );
};
