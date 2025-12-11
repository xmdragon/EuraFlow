/**
 * 标签反查组件
 *
 * 根据商品 SKU 查询 OZON 商品标签信息
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Input, Card, Tag, Alert, Spin, Empty, Typography } from 'antd';
import { LinkOutlined, ShopOutlined, TagsOutlined } from '@ant-design/icons';

import { tagLookup, TagLookupProduct, ProductTag } from '@/services/productSelectionApi';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

import styles from './TagLookupTab.module.scss';

const { Text } = Typography;

// 真实售价计算系数（与浏览器扩展一致）
const FORMULA_MULTIPLIER = 2.2;

/**
 * 解析价格字符串为数值
 */
function parsePriceValue(priceStr: string | null): number | null {
  if (!priceStr) return null;
  // 移除货币符号和空格，将逗号替换为点
  const clean = priceStr.replace(/[₽¥]/g, '').replace(/\s/g, '').replace(',', '.');
  const value = parseFloat(clean);
  return isNaN(value) ? null : value;
}

/**
 * 计算真实售价（与浏览器扩展公式一致）
 *
 * 公式：realPrice = (blackPrice - greenPrice) * 2.2 + blackPrice
 * 然后按价格区间减：1-100减1，101-200减2，以此类推
 */
function calculateRealPrice(cardPrice: string | null, price: string | null): string | null {
  const greenPrice = parsePriceValue(cardPrice);
  const blackPrice = parsePriceValue(price);

  if (blackPrice === null) return null;

  // 检测货币符号
  let currency = '¥';
  if (price?.includes('₽') || cardPrice?.includes('₽')) {
    currency = '₽';
  }

  let realPrice: number;

  // 有绿标价且绿标价小于黑标价时，使用公式计算
  if (greenPrice !== null && greenPrice > 0 && blackPrice > greenPrice) {
    const basePrice = (blackPrice - greenPrice) * FORMULA_MULTIPLIER + blackPrice;
    const roundedPrice = Math.round(basePrice);

    // 按价格区间修正
    let adjustment = 0;
    if (roundedPrice > 0) {
      adjustment = Math.floor(roundedPrice / 100);
      if (roundedPrice % 100 === 0 && adjustment > 0) {
        adjustment -= 1;
      }
    }

    realPrice = roundedPrice - adjustment;
  } else {
    // 没有绿标价或绿标价≥黑标价，直接使用黑标价
    realPrice = Math.round(blackPrice);
  }

  // 格式化输出
  if (currency === '¥') {
    return `${realPrice.toFixed(2).replace('.', ',')} ¥`;
  } else {
    return `${realPrice} ₽`;
  }
}

/**
 * 标签反查 Tab 组件
 */
export const TagLookupTab: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [product, setProduct] = useState<TagLookupProduct | null>(null);
  const [tags, setTags] = useState<ProductTag[]>([]);
  const [searchValue, setSearchValue] = useState('');

  // 计算真实售价
  const realPrice = useMemo(() => {
    if (!product) return null;
    return calculateRealPrice(product.card_price, product.price);
  }, [product]);

  // 执行查询
  const handleSearch = useCallback(async (value: string) => {
    const sku = value.trim();
    if (!sku) {
      setError('请输入商品 SKU');
      return;
    }

    setLoading(true);
    setError(null);
    setWarning(null);
    setProduct(null);
    setTags([]);

    try {
      const response = await tagLookup(sku);

      if (response.ok && response.data) {
        setProduct(response.data.product);
        setTags(response.data.tags);
        setWarning(response.data.warning || null);
        setSearchValue(''); // 查询成功后清空输入框
      } else {
        setError(response.error || '查询失败');
      }
    } catch (err) {
      setError('请求失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, []);

  // 点击标签
  const handleTagClick = useCallback((link: string) => {
    window.open(link, '_blank');
  }, []);

  return (
    <div className={styles.container}>
      {/* 搜索框 */}
      <div className={styles.searchSection}>
        <Input.Search
          placeholder="商品SKU"
          enterButton="查询"
          size="large"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onSearch={handleSearch}
          loading={loading}
          allowClear
          className={styles.searchInput}
        />
        <div className={styles.searchHint}>
          <Text type="secondary">
            输入 OZON 商品 SKU，查询商品标签信息。需要先在浏览器扩展中同步 Cookie。
          </Text>
        </div>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className={styles.loadingContainer}>
          <Spin size="large" tip="正在查询..." />
        </div>
      )}

      {/* 错误提示 */}
      {error && !loading && (
        <Alert
          type="error"
          message={error}
          showIcon
          className={styles.alertMessage}
        />
      )}

      {/* 商品信息卡片 */}
      {product && !loading && (
        <Card className={styles.productCard}>
          <div className={styles.productInfo}>
            {/* 商品图片 */}
            <div className={styles.productImage}>
              {product.image_url ? (
                <img src={optimizeOzonImageUrl(product.image_url, 160)} alt={product.name} />
              ) : (
                <div className={styles.noImage}>
                  <ShopOutlined />
                </div>
              )}
            </div>

            {/* 商品详情 */}
            <div className={styles.productDetails}>
              {/* 商品名称 */}
              <div className={styles.productName}>{product.name}</div>

              {/* SKU */}
              <div className={styles.productSku}>
                <Text type="secondary">SKU: </Text>
                <Text copyable={{ text: product.sku }}>{product.sku}</Text>
              </div>

              {/* 卖家 */}
              {product.seller_name && (
                <div className={styles.productSeller}>
                  <Text type="secondary">卖家: </Text>
                  {product.seller_link ? (
                    <a
                      href={product.seller_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.sellerLink}
                    >
                      {product.seller_name}
                    </a>
                  ) : (
                    <Text>{product.seller_name}</Text>
                  )}
                </div>
              )}

              {/* 价格信息 */}
              <div className={styles.productPrices}>
                {realPrice && (
                  <span className={styles.realPrice}>{realPrice}</span>
                )}
                {product.card_price && (
                  <span className={styles.cardPrice}>{product.card_price}</span>
                )}
                {product.price && (
                  <span className={styles.normalPrice}>{product.price}</span>
                )}
                {product.original_price && (
                  <span className={styles.originalPrice}>{product.original_price}</span>
                )}
              </div>

              {/* 商品链接 */}
              <a
                href={product.link}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.productLink}
              >
                <LinkOutlined /> 查看商品
              </a>
            </div>
          </div>
        </Card>
      )}

      {/* 警告提示（无标签） */}
      {warning && !loading && (
        <Alert
          type="warning"
          message={warning}
          showIcon
          className={styles.alertMessage}
        />
      )}

      {/* 标签列表 */}
      {tags.length > 0 && !loading && (
        <div className={styles.tagsSection}>
          <div className={styles.tagsHeader}>
            <TagsOutlined />
            <span className={styles.tagsTitle}>商品标签</span>
            <span className={styles.tagsCount}>({tags.length})</span>
          </div>
          <div className={styles.tagsContainer}>
            {tags.map((tag, index) => (
              <Tag
                key={`${tag.text}-${index}`}
                className={styles.hashTag}
                onClick={() => handleTagClick(tag.link)}
              >
                {tag.text}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && !product && (
        <Empty
          description="输入商品 SKU 开始查询"
          className={styles.emptyState}
        />
      )}
    </div>
  );
};

export default TagLookupTab;
