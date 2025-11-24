/**
 * 商品创建页 - 商品媒体区块
 */
import { PlusOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import React from 'react';

import styles from '../ProductCreate.module.scss';

export interface MediaSectionProps {
  showSection: boolean; // 仅在没有变体时显示
  mainProductImages: string[];
  videoCount: number;
  hasCoverVideo: boolean;
  handleOpenMainImageModal: () => void;
  handleOpenMainVideoModal: () => void;
}

export const MediaSection: React.FC<MediaSectionProps> = ({
  showSection,
  mainProductImages,
  videoCount,
  hasCoverVideo,
  handleOpenMainImageModal,
  handleOpenMainVideoModal,
}) => {
  if (!showSection) {
    return null;
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>商品媒体</h3>

      <div className={styles.mediaContainer}>
        {/* 商品图片 */}
        <div className={styles.mediaItem}>
          <div className={styles.mainImagePreviewWrapper} onClick={handleOpenMainImageModal}>
            {mainProductImages && mainProductImages.length > 0 ? (
              <div className={styles.mainImagePreview}>
                <img src={mainProductImages[0]} alt="product" className={styles.mainImage} />
                <span className={styles.mainImageCount}>{mainProductImages.length}</span>
              </div>
            ) : (
              <div className={styles.mainImagePlaceholder}>
                <PlusOutlined style={{ fontSize: 24 }} />
                <div style={{ marginTop: 8 }}>点击添加图片</div>
                <span className={styles.mainImageCountZero}>0</span>
              </div>
            )}
          </div>
        </div>

        {/* 商品视频 */}
        <div className={styles.mediaItem}>
          <div className={styles.mainImagePreviewWrapper} onClick={handleOpenMainVideoModal}>
            {videoCount > 0 ? (
              <div className={styles.mainImagePreview}>
                <div className={styles.videoPreviewIcon}>
                  <PlusOutlined style={{ fontSize: 32 }} />
                  <div style={{ marginTop: 8 }}>视频</div>
                </div>
                <span className={styles.mainImageCount}>{videoCount}</span>
                {hasCoverVideo && (
                  <Tag color="gold" style={{ position: 'absolute', top: 8, left: 8 }}>
                    封面
                  </Tag>
                )}
              </div>
            ) : (
              <div className={styles.mainImagePlaceholder}>
                <PlusOutlined style={{ fontSize: 24 }} />
                <div style={{ marginTop: 8 }}>点击添加视频</div>
                <span className={styles.mainImageCountZero}>0</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
