/**
 * 商品图片通用组件
 * 支持多种尺寸、悬浮效果、角标配置
 */
import { ShoppingCartOutlined, LinkOutlined, CheckOutlined } from '@ant-design/icons';
import { Avatar, Tooltip, Popover, Checkbox } from 'antd';
import React, { useState } from 'react';

import styles from './ProductImage.module.scss';

import ImagePreview from '@/components/ImagePreview';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';

export interface ProductImageProps {
  // 必需属性
  imageUrl?: string;

  // 尺寸配置
  size?: 'small' | 'medium'; // 默认：small (80x80)

  // 悬浮行为
  hoverBehavior?: 'medium' | 'name' | 'none'; // 默认：medium
  name?: string; // 商品名称（用于tooltip和alt）

  // 点击行为
  onClick?: () => void; // 自定义点击事件（默认打开大图预览）
  disablePreview?: boolean; // 禁用点击预览功能

  // 角标配置（互斥）
  topLeftCorner?: 'none' | 'checkbox' | 'link'; // 默认：none
  topRightCorner?: 'none' | 'checkbox' | 'link'; // 默认：none

  // 复选框相关
  checked?: boolean; // 复选框选中状态
  onCheckChange?: (checked: boolean) => void; // 复选框变更回调
  checkboxDisabled?: boolean; // 复选框禁用状态

  // OZON链接相关
  sku?: string; // SKU（用于生成OZON链接）
  offerId?: string; // Offer ID（备用标识）
}

const ProductImage: React.FC<ProductImageProps> = ({
  imageUrl,
  size = 'small',
  hoverBehavior = 'medium',
  name,
  onClick,
  disablePreview = false,
  topLeftCorner = 'none',
  topRightCorner = 'none',
  checked = false,
  onCheckChange,
  checkboxDisabled = false,
  sku,
  offerId,
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);

  // 图片尺寸映射
  const sizeMap = {
    small: 80,
    medium: 160,
  };

  const imageSize = sizeMap[size];

  // 优化图片URL
  const optimizedImageUrl = optimizeOzonImageUrl(imageUrl, imageSize);
  const mediumImageUrl = optimizeOzonImageUrl(imageUrl, 160);

  // 生成OZON商品链接
  const ozonProductUrl = sku ? `https://www.ozon.ru/product/${sku}/` : undefined;

  // 点击事件处理
  const handleImageClick = (e: React.MouseEvent) => {
    // 如果点击的是角标，不触发图片点击
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.cornerIcon}`)) {
      return;
    }

    if (onClick) {
      onClick();
    } else if (!disablePreview && optimizedImageUrl) {
      setPreviewVisible(true);
    }
  };

  // 复选框变更处理
  const handleCheckboxChange = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCheckChange && !checkboxDisabled) {
      onCheckChange(!checked);
    }
  };

  // 链接点击处理
  const handleLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ozonProductUrl) {
      window.open(ozonProductUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // 渲染角标
  const renderCorner = (position: 'topLeft' | 'topRight') => {
    const cornerType = position === 'topLeft' ? topLeftCorner : topRightCorner;

    if (cornerType === 'none') return null;

    if (cornerType === 'checkbox') {
      return (
        <div
          className={`${styles.cornerIcon} ${styles[position]}`}
          onClick={handleCheckboxChange}
        >
          <Checkbox checked={checked} disabled={checkboxDisabled} />
        </div>
      );
    }

    if (cornerType === 'link' && ozonProductUrl) {
      return (
        <Tooltip title="在OZON上查看">
          <div
            className={`${styles.cornerIcon} ${styles[position]} ${styles.linkIcon}`}
            onClick={handleLinkClick}
          >
            <LinkOutlined />
          </div>
        </Tooltip>
      );
    }

    return null;
  };

  // 渲染图片或占位符
  const renderImage = () => {
    if (optimizedImageUrl) {
      return (
        <img
          src={optimizedImageUrl}
          alt={name || offerId || '商品图片'}
          className={styles.image}
        />
      );
    }

    return (
      <Avatar
        size={imageSize}
        icon={<ShoppingCartOutlined />}
        shape="square"
        className={styles.placeholder}
      />
    );
  };

  // 基础容器
  const imageContainer = (
    <div
      className={`${styles.container} ${!disablePreview && optimizedImageUrl ? styles.clickable : ''}`}
      style={{
        width: imageSize,
        height: imageSize,
      }}
      onClick={handleImageClick}
    >
      {renderImage()}
      {renderCorner('topLeft')}
      {renderCorner('topRight')}
    </div>
  );

  // 准备图片数组（用于高级预览组件）
  const previewImages = optimizedImageUrl ? [imageUrl || ''] : [];

  // 根据悬浮行为包装容器
  if (hoverBehavior === 'medium' && mediumImageUrl) {
    return (
      <>
        <Popover
          content={<img src={mediumImageUrl} width={160} alt={name || '商品图片'} />}
          trigger="hover"
          overlayClassName={styles.popoverOverlay}
        >
          {imageContainer}
        </Popover>
        <ImagePreview
          images={previewImages}
          visible={previewVisible}
          initialIndex={0}
          onClose={() => setPreviewVisible(false)}
        />
      </>
    );
  }

  if (hoverBehavior === 'name' && name) {
    return (
      <>
        <Tooltip title={name}>{imageContainer}</Tooltip>
        <ImagePreview
          images={previewImages}
          visible={previewVisible}
          initialIndex={0}
          onClose={() => setPreviewVisible(false)}
        />
      </>
    );
  }

  // hoverBehavior === 'none'
  return (
    <>
      {imageContainer}
      <ImagePreview
        images={previewImages}
        visible={previewVisible}
        initialIndex={0}
        onClose={() => setPreviewVisible(false)}
      />
    </>
  );
};

export default ProductImage;
