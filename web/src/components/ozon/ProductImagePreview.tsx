/**
 * 商品图片大图预览组件
 * 显示位置：屏幕顶部
 * 高度：屏幕高度的 2/3
 */
import { CloseOutlined } from '@ant-design/icons';
import { Modal, Button } from 'antd';
import React from 'react';

import styles from './ProductImagePreview.module.scss';

interface ProductImagePreviewProps {
  visible: boolean;
  imageUrl: string;
  alt?: string;
  onClose: () => void;
}

const ProductImagePreview: React.FC<ProductImagePreviewProps> = ({
  visible,
  imageUrl,
  alt = '商品图片',
  onClose,
}) => {
  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      closable={false}
      width="auto"
      style={{
        top: 0,
        maxWidth: '100vw',
        paddingBottom: 0,
      }}
      bodyStyle={{
        padding: 0,
        height: '66.67vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
      }}
      maskClosable
    >
      <div className={styles.previewContainer}>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          className={styles.closeButton}
        />
        <img src={imageUrl} alt={alt} className={styles.previewImage} />
      </div>
    </Modal>
  );
};

export default ProductImagePreview;
