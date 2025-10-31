import {
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  DownloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  PictureOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Modal, Button, Space, Spin } from 'antd';
import React, { useState, useEffect, useCallback, useRef } from 'react';

import styles from './ImagePreview.module.scss';

import { notifySuccess, notifyError } from '@/utils/notification';

interface ImagePreviewProps {
  images: string[];
  visible: boolean;
  initialIndex?: number;
  onClose: () => void;
  productInfo?: {
    id: number;
    sku: string;
    title: string;
  };
  onWatermark?: () => void;
  onRestore?: () => void;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({
  images,
  visible,
  initialIndex = 0,
  onClose,
  productInfo,
  onWatermark,
  onRestore,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [loading, setLoading] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // 当没有图片但visible为true时，也显示Modal（用于loading状态）
  const hasImages = images && images.length > 0;

  // 打开预览时设置初始索引
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setLoading(true);
    }
  }, [visible, initialIndex]);

  // 关闭预览时重置所有状态
  useEffect(() => {
    if (!visible) {
      setCurrentIndex(0);
      setScale(1);
      setRotate(0);
      setLoading(false);
    }
  }, [visible]);

  // 当图片切换时，设置加载状态
  useEffect(() => {
    if (visible && hasImages) {
      setLoading(true);
      // 检查图片是否已缓存加载
      if (imageRef.current && imageRef.current.complete) {
        setLoading(false);
      }
    }
  }, [currentIndex, images, visible, hasImages]);

  // 导航函数 - 必须在使用它们的 useEffect 之前定义
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setScale(1); // 重置缩放
      setRotate(0); // 重置旋转
      setLoading(true);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setScale(1); // 重置缩放
      setRotate(0); // 重置旋转
      setLoading(true);
    }
  }, [currentIndex, images.length]);

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case 'Escape':
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, currentIndex, images.length, handlePrevious, handleNext, onClose]);

  // 鼠标滚轮缩放
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!visible) return;
      e.preventDefault();

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((prev) => Math.min(Math.max(prev + delta, 0.5), 3));
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [visible]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  const handleRotateLeft = () => {
    setRotate((prev) => prev - 90);
  };

  const handleRotateRight = () => {
    setRotate((prev) => prev + 90);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = images[currentIndex];
    link.download = `image-${currentIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    notifySuccess('下载开始', '图片开始下载');
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      mask={false}
      wrapClassName={styles.modalWrap}
      getContainer={() => document.body}
    >
      <div className={styles.container}>
        {/* 加载动画 - 当loading或没有图片时显示 */}
        {(loading || !hasImages) && (
          <div className={styles.loadingWrapper}>
            <Spin size="large" tip="加载图片中..." />
          </div>
        )}

        {/* 图片 - 只有当有图片时才渲染 */}
        {hasImages && (
          <div className={styles.imageDisplay}>
            <img
              ref={imageRef}
              src={images[currentIndex]}
              alt={`预览图片 ${currentIndex + 1}`}
              className={styles.previewImage}
              style={{
                transform: `scale(${scale}) rotate(${rotate}deg)`,
              }}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                notifyError('加载失败', '图片加载失败');
              }}
              draggable={false}
            />
          </div>
        )}

        {/* 左箭头 - 只在有图片时显示 */}
        {hasImages && currentIndex > 0 && (
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={handlePrevious}
            className={styles.navButtonLeft}
          />
        )}

        {/* 右箭头 - 只在有图片时显示 */}
        {hasImages && currentIndex < images.length - 1 && (
          <Button
            type="text"
            icon={<RightOutlined />}
            onClick={handleNext}
            className={styles.navButtonRight}
          />
        )}

        {/* 关闭按钮 */}
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          className={styles.closeButton}
        />

        {/* 顶部信息栏 - 只在有多张图片时显示 */}
        {hasImages && images.length > 1 && (
          <div className={styles.imageCounter}>
            {currentIndex + 1} / {images.length}
          </div>
        )}

        {/* 底部工具栏 - 只在有图片时显示 */}
        {hasImages && (
          <div className={styles.toolbar}>
            <Space>
              <Button
                type="text"
                icon={<ZoomOutOutlined />}
                onClick={handleZoomOut}
                className={styles.toolbarButton}
                title="缩小"
              />
              <span className={styles.zoomDisplay}>{Math.round(scale * 100)}%</span>
              <Button
                type="text"
                icon={<ZoomInOutlined />}
                onClick={handleZoomIn}
                className={styles.toolbarButton}
                title="放大"
              />
              <Button
                type="text"
                icon={<RotateLeftOutlined />}
                onClick={handleRotateLeft}
                className={styles.toolbarButton}
                title="向左旋转"
              />
              <Button
                type="text"
                icon={<RotateRightOutlined />}
                onClick={handleRotateRight}
                className={styles.toolbarButton}
                title="向右旋转"
              />
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={handleDownload}
                className={styles.toolbarButton}
                title="下载图片"
              />

              {/* 分隔线和水印操作按钮 */}
              {productInfo && onWatermark && onRestore && (
                <>
                  <div className={styles.divider} />

                  <Button
                    type="text"
                    icon={<PictureOutlined />}
                    onClick={onWatermark}
                    className={styles.toolbarButton}
                    title="应用水印"
                  />
                  <Button
                    type="text"
                    icon={<RollbackOutlined />}
                    onClick={onRestore}
                    className={styles.toolbarButton}
                    title="还原原图"
                  />
                </>
              )}
            </Space>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ImagePreview;
