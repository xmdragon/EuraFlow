import React, { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Space,
  Spin,
  message,
} from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  DownloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
} from '@ant-design/icons';

interface ImagePreviewProps {
  images: string[];
  visible: boolean;
  initialIndex?: number;
  onClose: () => void;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({
  images,
  visible,
  initialIndex = 0,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [loading, setLoading] = useState(false);

  // 重置状态当打开预览时
  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setScale(1);
      setRotate(0);
      setLoading(true);
    }
  }, [visible, initialIndex]);

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;

      switch(e.key) {
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
  }, [visible, currentIndex, images.length]);

  // 鼠标滚轮缩放
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!visible) return;
      e.preventDefault();

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale(prev => Math.min(Math.max(prev + delta, 0.5), 3));
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [visible]);

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setLoading(true);
    }
  };

  const handleNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setLoading(true);
    }
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.2, 3));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.2, 0.5));
  };

  const handleRotateLeft = () => {
    setRotate(prev => prev - 90);
  };

  const handleRotateRight = () => {
    setRotate(prev => prev + 90);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = images[currentIndex];
    link.download = `image-${currentIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('图片开始下载');
  };

  if (!images || images.length === 0) {
    return null;
  }

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      mask={false}
      width="auto"
      centered
      style={{
        maxWidth: '90vw',
        top: '5vh',
      }}
      styles={{
        body: {
          padding: 0,
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }
      }}
      modalRender={(modal) => (
        <div style={{ pointerEvents: 'auto' }}>
          {modal}
        </div>
      )}
    >
      <div style={{
        position: 'relative',
        display: 'inline-block',
        backgroundColor: '#f0f0f0',
        minWidth: '400px',
        minHeight: '300px',
      }}>
        {/* 加载动画 */}
        {loading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
          }}>
            <Spin size="large" />
          </div>
        )}

        {/* 图片 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          minHeight: '300px',
        }}>
          <img
            src={images[currentIndex]}
            alt={`预览图片 ${currentIndex + 1}`}
            style={{
              maxWidth: '70vw',
              maxHeight: '70vh',
              display: 'block',
              transform: `scale(${scale}) rotate(${rotate}deg)`,
              transition: 'transform 0.3s ease',
              userSelect: 'none',
            }}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              message.error('图片加载失败');
            }}
            draggable={false}
          />
        </div>

        {/* 左箭头 */}
        {currentIndex > 0 && (
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={handlePrevious}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: 'white',
              border: 'none',
              fontSize: '18px',
              height: '40px',
              width: '40px',
            }}
          />
        )}

        {/* 右箭头 */}
        {currentIndex < images.length - 1 && (
          <Button
            type="text"
            icon={<RightOutlined />}
            onClick={handleNext}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: 'white',
              border: 'none',
              fontSize: '18px',
              height: '40px',
              width: '40px',
            }}
          />
        )}

        {/* 关闭按钮 */}
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
            border: 'none',
            fontSize: '18px',
            height: '36px',
            width: '36px',
          }}
        />

        {/* 顶部信息栏 */}
        {images.length > 1 && (
          <div style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            color: 'white',
            padding: '4px 12px',
            borderRadius: '4px',
            fontSize: '14px',
          }}>
            {currentIndex + 1} / {images.length}
          </div>
        )}

        {/* 底部工具栏 */}
        <div style={{
          position: 'absolute',
          bottom: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          padding: '8px',
          borderRadius: '4px',
        }}>
          <Space>
            <Button
              type="text"
              icon={<ZoomOutOutlined />}
              onClick={handleZoomOut}
              style={{ color: 'white', border: 'none' }}
              title="缩小"
            />
            <span style={{ color: 'white', minWidth: '50px', textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <Button
              type="text"
              icon={<ZoomInOutlined />}
              onClick={handleZoomIn}
              style={{ color: 'white', border: 'none' }}
              title="放大"
            />
            <Button
              type="text"
              icon={<RotateLeftOutlined />}
              onClick={handleRotateLeft}
              style={{ color: 'white', border: 'none' }}
              title="向左旋转"
            />
            <Button
              type="text"
              icon={<RotateRightOutlined />}
              onClick={handleRotateRight}
              style={{ color: 'white', border: 'none' }}
              title="向右旋转"
            />
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              style={{ color: 'white', border: 'none' }}
              title="下载图片"
            />
          </Space>
        </div>
      </div>
    </Modal>
  );
};

export default ImagePreview;