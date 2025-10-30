/**
 * 图片预览弹窗组件
 */
import React, { useRef } from 'react';
import { Modal, Button, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

import styles from '../../../pages/ozon/PackingShipment.module.scss';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUrl: string;
  loading: boolean;
  onClose: () => void;
  onLoadComplete: () => void;
  onLoadError: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  visible,
  imageUrl,
  loading,
  onClose,
  onLoadComplete,
  onLoadError,
}) => {
  const imageRef = useRef<HTMLImageElement>(null);

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      mask={false}
      width="auto"
      centered
      bodyStyle={{ padding: 0 }}
    >
      <div className={styles.imagePreviewContainer} style={{ position: 'relative' }}>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          className={styles.imagePreviewCloseButton}
        />
        {/* 加载占位符 - 覆盖在图片上方 */}
        {loading && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '600px',
              minHeight: '600px',
              backgroundColor: '#f0f0f0',
              zIndex: 10,
            }}
          >
            <Spin size="large" tip="加载图片中..." />
          </div>
        )}
        {/* 图片 - 始终渲染（如果有URL），loading时用visibility隐藏 */}
        {imageUrl && (
          <img
            ref={imageRef}
            src={imageUrl}
            alt="商品大图"
            className={styles.imagePreviewImage}
            style={{ visibility: loading ? 'hidden' : 'visible' }}
            onLoad={onLoadComplete}
            onError={onLoadError}
          />
        )}
      </div>
    </Modal>
  );
};

export default ImagePreviewModal;
