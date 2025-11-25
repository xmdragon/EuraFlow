/**
 * 采集记录详情弹窗
 * UI风格参考浏览器扩展的"跟卖"弹窗
 * 支持变体切换和图片预览
 */
import { LinkOutlined } from '@ant-design/icons';
import { Modal, Descriptions, Image, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useState, useMemo } from 'react';

import styles from './CollectionRecordDetailModal.module.scss';

import { useCurrency } from '@/hooks/useCurrency';

interface Variant {
  variant_id: string;
  specifications: string;
  spec_details?: Record<string, string>;
  image_url: string;
  images?: { url: string; is_primary?: boolean }[];
  price: number;
  original_price?: number;
  available: boolean;
  link?: string;
}

interface ProductDimensions {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
}

interface CollectionRecordData {
  id: number;
  user_id: number;
  shop_id: number | null;
  collection_type: string;
  source_url: string;
  product_data: {
    product_id?: string;
    title?: string;
    title_cn?: string;
    images?: { url: string; is_primary?: boolean }[];
    price?: number;
    old_price?: number;
    currency?: string;
    description?: string;
    specifications?: Record<string, unknown>;
    variants?: Variant[];
    has_variants?: boolean;
    dimensions?: ProductDimensions;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

interface CollectionRecordDetailModalProps {
  visible: boolean;
  record: CollectionRecordData | null;
  onClose: () => void;
}

const CollectionRecordDetailModal: React.FC<CollectionRecordDetailModalProps> = ({
  visible,
  record,
  onClose,
}) => {
  const { formatPrice } = useCurrency();
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  // 当弹窗关闭时重置选中的变体
  const handleClose = () => {
    setSelectedVariantIndex(0);
    onClose();
  };

  if (!record) return null;

  const { product_data } = record;
  const variants = product_data?.variants || [];
  const hasVariants = variants.length > 0;

  // 获取当前选中的变体或使用商品基础数据
  const currentVariant = hasVariants ? variants[selectedVariantIndex] : null;

  // 提取当前变体的图片
  const currentImages = useMemo(() => {
    if (currentVariant?.images && currentVariant.images.length > 0) {
      return currentVariant.images.map(img => img.url).filter(Boolean);
    }
    if (product_data?.images && product_data.images.length > 0) {
      return product_data.images.map((img: unknown) => (typeof img === 'string' ? img : (img as { url?: string })?.url || '')).filter(Boolean);
    }
    return [];
  }, [currentVariant, product_data?.images]);

  const mainImage = currentVariant?.image_url || currentImages[0] || '';

  // 获取当前价格
  const currentPrice = currentVariant?.price || product_data?.price || 0;
  const currentOriginalPrice = currentVariant?.original_price || product_data?.old_price;

  // 获取当前规格
  const currentSpecifications = currentVariant?.specifications || '';

  return (
    <Modal
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={920}
      className={styles.detailModal}
      title={
        <div className={styles.modalTitle}>
          <span>商品详情</span>
          <Tag color="blue">采集记录</Tag>
        </div>
      }
    >
      {/* 商品预览区 */}
      <div className={styles.productPreview}>
        <div className={styles.imageSection}>
          {mainImage ? (
            <div className={styles.imageWrapper}>
              <Image.PreviewGroup>
                <Image
                  src={mainImage}
                  alt={product_data?.title}
                  width={200}
                  height={200}
                  style={{ objectFit: 'cover', borderRadius: '8px', cursor: 'pointer' }}
                />
                {currentImages.slice(1).map((img, idx) => (
                  <Image
                    key={idx}
                    src={img}
                    alt={`图片 ${idx + 2}`}
                    style={{ display: 'none' }}
                  />
                ))}
              </Image.PreviewGroup>
              {/* 右上角来源链接 */}
              <a
                href={currentVariant?.link || record.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.sourceLink}
                title="在OZON上查看"
              >
                <LinkOutlined />
              </a>
            </div>
          ) : (
            <div className={styles.noImage}>暂无图片</div>
          )}
        </div>
        <div className={styles.infoSection}>
          <div className={styles.title}>
            {product_data?.title || '未知商品'}
          </div>
          {product_data?.title_cn && (
            <div className={styles.titleCn}>
              {product_data.title_cn}
            </div>
          )}
          {/* 显示当前变体规格 */}
          {currentSpecifications && (
            <div className={styles.currentSpec}>
              <Tag color="blue">{currentSpecifications}</Tag>
            </div>
          )}
          <div className={styles.metadata}>
            <span>采集时间：{dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>
            {currentImages.length > 1 && (
              <span>{currentImages.length} 张图片</span>
            )}
            {hasVariants && (
              <span>{variants.length} 个变体</span>
            )}
          </div>
        </div>
      </div>

      {/* 变体缩略图列表 */}
      {hasVariants && (
        <div className={styles.variantSelector}>
          <div className={styles.variantTitle}>选择变体：</div>
          <div className={styles.variantGrid}>
            {variants.map((variant, index) => (
              <div
                key={variant.variant_id}
                className={`${styles.variantItem} ${index === selectedVariantIndex ? styles.variantItemActive : ''}`}
                onClick={() => setSelectedVariantIndex(index)}
                title={variant.specifications}
              >
                <img
                  src={variant.image_url}
                  alt={variant.specifications}
                  className={styles.variantImage}
                />
                <div className={styles.variantSpec}>{variant.specifications}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 商品信息表格 */}
      <div className={styles.detailSection}>
        <Descriptions bordered size="small" column={2}>
          {product_data?.product_id && (
            <Descriptions.Item label="商品ID">
              {product_data.product_id}
            </Descriptions.Item>
          )}

          {currentVariant?.variant_id && (
            <Descriptions.Item label="变体ID">
              {currentVariant.variant_id}
            </Descriptions.Item>
          )}

          {currentPrice !== undefined && (
            <Descriptions.Item label="价格">
              <span className={styles.price}>
                {formatPrice(currentPrice)}
              </span>
            </Descriptions.Item>
          )}

          {currentOriginalPrice && (
            <Descriptions.Item label="划线价">
              <span className={styles.oldPrice}>
                {formatPrice(currentOriginalPrice)}
              </span>
            </Descriptions.Item>
          )}

          {product_data?.currency && (
            <Descriptions.Item label="货币">
              {product_data.currency}
            </Descriptions.Item>
          )}

          {/* 尺寸信息 */}
          {product_data?.dimensions && (
            <Descriptions.Item label="尺寸">
              {[
                product_data.dimensions.length,
                product_data.dimensions.width,
                product_data.dimensions.height
              ].filter(Boolean).join(' × ')} mm
            </Descriptions.Item>
          )}

          {/* 重量信息 */}
          {product_data?.dimensions?.weight && (
            <Descriptions.Item label="重量">
              {product_data.dimensions.weight} g
            </Descriptions.Item>
          )}

          {product_data?.description && (
            <Descriptions.Item label="商品描述" span={2}>
              <div className={styles.description}>
                {product_data.description}
              </div>
            </Descriptions.Item>
          )}

          {product_data?.specifications && Object.keys(product_data.specifications).length > 0 && (
            <Descriptions.Item label="规格参数" span={2}>
              <div className={styles.specifications}>
                {Object.entries(product_data.specifications).map(([key, value]) => (
                  <div key={key} className={styles.specItem}>
                    <span className={styles.specKey}>{key}:</span>
                    <span className={styles.specValue}>{String(value)}</span>
                  </div>
                ))}
              </div>
            </Descriptions.Item>
          )}
        </Descriptions>
      </div>

      {/* 图片轮播区 */}
      {currentImages.length > 1 && (
        <div className={styles.imageGallery}>
          <div className={styles.galleryTitle}>
            {hasVariants ? '当前变体图片' : '商品图片'} ({currentImages.length})
          </div>
          <div className={styles.galleryGrid}>
            <Image.PreviewGroup>
              {currentImages.map((img, index) => (
                <div key={index} className={styles.galleryItem}>
                  <Image
                    src={img}
                    alt={`图片 ${index + 1}`}
                    width={100}
                    height={100}
                    style={{ objectFit: 'cover', borderRadius: '4px' }}
                  />
                </div>
              ))}
            </Image.PreviewGroup>
          </div>
        </div>
      )}

      {/* 原始数据（调试用） */}
      <details className={styles.rawData}>
        <summary>查看原始数据</summary>
        <pre>{JSON.stringify(product_data, null, 2)}</pre>
      </details>
    </Modal>
  );
};

export default CollectionRecordDetailModal;
