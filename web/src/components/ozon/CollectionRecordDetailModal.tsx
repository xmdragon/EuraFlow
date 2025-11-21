/**
 * 采集记录详情弹窗
 * UI风格参考浏览器扩展的"跟卖"弹窗
 */
import { LinkOutlined } from '@ant-design/icons';
import { Modal, Descriptions, Image, Tag } from 'antd';
import dayjs from 'dayjs';
import React from 'react';

import styles from './CollectionRecordDetailModal.module.scss';

import ProductImage from '@/components/ozon/ProductImage';
import { useCurrency } from '@/hooks/useCurrency';

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
    images?: string[];
    price?: number;
    old_price?: number;
    currency?: string;
    description?: string;
    specifications?: Record<string, any>;
    [key: string]: any;
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

  if (!record) return null;

  const { product_data } = record;
  const images = product_data?.images || [];
  const mainImage = images[0] || '';

  return (
    <Modal
      open={visible}
      onCancel={onClose}
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
              <ProductImage
                imageUrl={mainImage}
                size="medium"
                hoverBehavior="none"
                name={product_data?.title}
              />
              {/* 右上角来源链接 */}
              <a
                href={record.source_url}
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
          <div className={styles.metadata}>
            <span>采集时间：{dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>
            {images.length > 1 && (
              <span>{images.length} 张图片</span>
            )}
          </div>
        </div>
      </div>

      {/* 商品信息表格 */}
      <div className={styles.detailSection}>
        <Descriptions bordered size="small" column={2}>
          {product_data?.product_id && (
            <Descriptions.Item label="商品ID">
              {product_data.product_id}
            </Descriptions.Item>
          )}

          {product_data?.price !== undefined && (
            <Descriptions.Item label="价格">
              <span className={styles.price}>
                {formatPrice(product_data.price)}
              </span>
            </Descriptions.Item>
          )}

          {product_data?.old_price && (
            <Descriptions.Item label="划线价">
              <span className={styles.oldPrice}>
                {formatPrice(product_data.old_price)}
              </span>
            </Descriptions.Item>
          )}

          {product_data?.currency && (
            <Descriptions.Item label="货币">
              {product_data.currency}
            </Descriptions.Item>
          )}

          {/* 尺寸信息 */}
          {(product_data?.dimensions || product_data?.size || product_data?.length || product_data?.width || product_data?.height) && (
            <Descriptions.Item label="尺寸">
              {product_data.dimensions
                ? String(product_data.dimensions)
                : product_data.size
                  ? String(product_data.size)
                  : [product_data.length, product_data.width, product_data.height]
                      .filter(Boolean)
                      .join(' × ') + ' cm'}
            </Descriptions.Item>
          )}

          {/* 重量信息 */}
          {product_data?.weight && (
            <Descriptions.Item label="重量">
              {typeof product_data.weight === 'number'
                ? `${product_data.weight} g`
                : String(product_data.weight)}
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
      {images.length > 1 && (
        <div className={styles.imageGallery}>
          <div className={styles.galleryTitle}>商品图片 ({images.length})</div>
          <div className={styles.galleryGrid}>
            <Image.PreviewGroup>
              {images.map((img, index) => (
                <div key={index} className={styles.galleryItem}>
                  <Image
                    src={img}
                    alt={`商品图片 ${index + 1}`}
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
