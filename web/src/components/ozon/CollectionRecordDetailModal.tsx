/**
 * 采集/上架记录详情弹窗
 * UI风格参考浏览器扩展的"跟卖"弹窗
 * 支持变体切换和图片预览
 */
import { LinkOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Modal, Descriptions, Image, Tag } from 'antd';
import React, { useState, useMemo } from 'react';

import styles from './CollectionRecordDetailModal.module.scss';

import { useQuery } from '@tanstack/react-query';

import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozon';
import * as watermarkApi from '@/services/watermarkApi';

interface Variant {
  variant_id: string;
  offer_id?: string;
  specifications: string;       // 规格描述（如 "白色,M"）
  name?: string;                // 变体名称
  primary_image?: string;       // 主图URL（跟卖上架使用）
  image_url?: string;           // 主图URL（采集功能使用）
  images?: { url: string }[] | string[];   // 变体图片数组（可选，支持对象数组或字符串数组）
  price: number;                // 价格（元）
  old_price?: number;           // 原价（元）
  original_price?: number;      // 原价（兼容旧字段名）
  stock?: number;               // 库存
  link?: string;                // 变体链接（可选）
}

interface ProductDimensions {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
}

interface ListingRequestPayload {
  warehouse_id?: number;
  watermark_config_id?: number;
  variants?: Array<{
    variant_id: string;
    stock?: number;
  }>;
  [key: string]: unknown;
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
  listing_request_payload?: ListingRequestPayload;
  listing_status?: string;
  created_at: string;
  updated_at: string;
}

interface CollectionRecordDetailModalProps {
  visible: boolean;
  record: CollectionRecordData | null;
  onClose: () => void;
  /** 是否为上架记录（显示上架相关信息） */
  isListingRecord?: boolean;
}

const CollectionRecordDetailModal: React.FC<CollectionRecordDetailModalProps> = ({
  visible,
  record,
  onClose,
  isListingRecord = false,
}) => {
  const { formatPrice } = useCurrency();
  const { formatDateTime } = useDateTime();
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  // 获取店铺数据
  const { data: shopsData } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: () => ozonApi.getShops(),
    staleTime: 5 * 60 * 1000,
    enabled: isListingRecord && visible,
  });
  const shops = shopsData?.data || [];

  // 获取仓库数据
  const { data: warehousesData } = useQuery({
    queryKey: ['ozon', 'warehouses', record?.shop_id],
    queryFn: () => ozonApi.getWarehouses(record?.shop_id as number),
    staleTime: 5 * 60 * 1000,
    enabled: isListingRecord && visible && !!record?.shop_id,
  });
  const warehouses = warehousesData?.data || [];

  // 获取水印配置
  const { data: watermarkConfigs } = useQuery({
    queryKey: ['watermarkConfigs'],
    queryFn: () => watermarkApi.getWatermarkConfigs(),
    staleTime: 5 * 60 * 1000,
    enabled: isListingRecord && visible,
  });

  // 当弹窗关闭时重置选中的变体
  const handleClose = () => {
    setSelectedVariantIndex(0);
    onClose();
  };

  // 提前计算派生数据（避免在条件返回后调用 hooks）
  const product_data = record?.product_data;
  const variants = product_data?.variants || [];
  const hasVariants = variants.length > 0;
  const currentVariant = hasVariants ? variants[selectedVariantIndex] : null;

  // 提取当前变体的图片（useMemo 必须在条件返回之前调用）
  // 支持两种格式：对象数组 [{url: string}] 或字符串数组 [string]
  const currentImages = useMemo(() => {
    if (currentVariant?.images && currentVariant.images.length > 0) {
      return currentVariant.images.map(img =>
        typeof img === 'string' ? img : (img as { url?: string })?.url || ''
      ).filter(Boolean);
    }
    if (product_data?.images && product_data.images.length > 0) {
      return product_data.images.map((img: unknown) => (typeof img === 'string' ? img : (img as { url?: string })?.url || '')).filter(Boolean);
    }
    return [];
  }, [currentVariant, product_data?.images]);

  // 条件返回必须在所有 hooks 调用之后
  if (!record) return null;

  // 获取变体主图：优先 primary_image 字段，其次 images 数组中 is_primary:true 的图
  const getVariantPrimaryImage = (variant: Variant | null): string => {
    if (!variant) return '';
    if (variant.primary_image) return variant.primary_image;
    if (!variant.images?.length) return '';
    const primary = variant.images.find(img => typeof img === 'object' && (img as { is_primary?: boolean }).is_primary);
    return (primary as { url?: string })?.url || (variant.images[0] as { url?: string })?.url || '';
  };
  const mainImage = getVariantPrimaryImage(currentVariant) || currentImages[0] || '';

  // 获取上架相关信息
  const listingPayload = record.listing_request_payload;
  // 店铺字段: id, shop_name
  const shopInfo = shops?.find((s: { id: number }) => s.id === record.shop_id);
  const shopName = shopInfo?.shop_name || '-';
  // 仓库字段: warehouse_id, name
  const warehouseInfo = warehouses?.find((w: { warehouse_id: number }) => w.warehouse_id === listingPayload?.warehouse_id);
  const warehouseName = warehouseInfo?.name || '-';
  // 水印配置字段: id, name
  const watermarkConfig = watermarkConfigs?.find((w: { id: number }) => w.id === listingPayload?.watermark_config_id);
  const watermarkName = watermarkConfig?.name || '未选择';

  // 获取当前变体库存（直接从变体数据中取）
  const currentStock = currentVariant?.stock;

  // 获取当前价格（插件采集返回三个价格）
  // 注意：变体的价格可能为0，此时不应 fallback 到商品级别价格
  const realPrice = (currentVariant as unknown as Record<string, unknown>)?.realPrice as number ?? (product_data as unknown as Record<string, unknown>)?.realPrice as number ?? 0;
  const greenPrice = (currentVariant as unknown as Record<string, unknown>)?.cardPrice as number ?? (product_data as unknown as Record<string, unknown>)?.cardPrice as number ?? 0;
  const blackPrice = currentVariant?.price ?? product_data?.price ?? 0;

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
          <Tag color={isListingRecord ? 'green' : 'blue'}>
            {isListingRecord ? '上架记录' : '采集记录'}
          </Tag>
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
            <span>{isListingRecord ? '上架时间' : '采集时间'}：{formatDateTime(record.created_at, 'YYYY-MM-DD HH:mm:ss')}</span>
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
                  src={getVariantPrimaryImage(variant)}
                  alt={variant.specifications}
                  className={styles.variantImage}
                />
                <div className={styles.variantSpec}>{variant.specifications}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 上架信息区域（仅上架记录显示） */}
      {isListingRecord && (
        <div className={styles.detailSection}>
          <Descriptions bordered size="small" column={2} labelStyle={{ width: 80 }} title="上架配置">
            <Descriptions.Item label="上架店铺">
              {shopName}
            </Descriptions.Item>
            <Descriptions.Item label="仓库">
              {warehouseName}
            </Descriptions.Item>
            <Descriptions.Item label="水印">
              {listingPayload?.watermark_config_id ? (
                <Tag color="blue">{watermarkName}</Tag>
              ) : (
                <Tag>未选择</Tag>
              )}
            </Descriptions.Item>
            {currentStock !== undefined && (
              <Descriptions.Item label="库存">
                {currentStock}
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>
      )}

      {/* 商品信息表格 */}
      <div className={styles.detailSection}>
        <Descriptions bordered size="small" column={2} labelStyle={{ width: 60 }}>
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
            <Descriptions.Item label="重量" contentStyle={{ width: 120 }}>
              {product_data.dimensions.weight} g
            </Descriptions.Item>
          )}

          {/* 价格信息：有变体时只显示价格，无变体时显示三个价格 */}
          <Descriptions.Item label="价格" span={2}>
            {hasVariants ? (
              // 有变体：只显示黑色价格
              <span style={{ fontWeight: 'bold' }}>{blackPrice > 0 ? formatPrice(blackPrice) : '-'}</span>
            ) : (
              // 无变体：显示三个价格
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {realPrice > 0 && (
                  <span>
                    <span style={{ color: '#666' }}>真实售价：</span>
                    <span style={{ color: '#f50', fontWeight: 'bold' }}>{formatPrice(realPrice)}</span>
                  </span>
                )}
                {greenPrice > 0 && (
                  <span>
                    <span style={{ color: '#666' }}>绿色价格：</span>
                    <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{formatPrice(greenPrice)}</span>
                  </span>
                )}
                {blackPrice > 0 && (
                  <span>
                    <span style={{ color: '#666' }}>黑色价格：</span>
                    <span style={{ fontWeight: 'bold' }}>{formatPrice(blackPrice)}</span>
                  </span>
                )}
                {realPrice === 0 && greenPrice === 0 && blackPrice === 0 && (
                  <span style={{ color: '#999' }}>-</span>
                )}
              </div>
            )}
          </Descriptions.Item>

          {product_data?.description && (
            <Descriptions.Item label="描述" span={2}>
              <div className={styles.description}>
                {product_data.description}
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
        {isListingRecord && record.listing_request_payload && (
          <>
            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>上架请求数据 (listing_request_payload):</div>
            <pre>{JSON.stringify(record.listing_request_payload, null, 2)}</pre>
            <div style={{ fontWeight: 'bold', marginTop: 16, marginBottom: 4 }}>展示数据 (product_data):</div>
          </>
        )}
        <pre>{JSON.stringify(product_data, null, 2)}</pre>
      </details>
    </Modal>
  );
};

export default CollectionRecordDetailModal;
