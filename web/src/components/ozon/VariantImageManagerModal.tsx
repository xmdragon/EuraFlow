import React, { useState, useRef } from 'react';
import { Modal, Button, Tabs, Dropdown, MenuProps, Upload, message } from 'antd';
import {
  UploadOutlined,
  DownloadOutlined,
  ToolOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { ImageSortableList, ImageItem } from './ImageSortableList';
import { CloudinaryImageGrid } from './CloudinaryImageGrid';
import { uploadMedia } from '@/services/ozonApi';
import { notifySuccess, notifyError } from '@/utils/notification';
import styles from './VariantImageManagerModal.module.scss';

interface VariantImageManagerModalProps {
  visible: boolean;
  variantId: string;
  offerId: string;
  images: string[];
  shopId: number;
  onOk: (images: string[]) => void;
  onCancel: () => void;
}

export const VariantImageManagerModal: React.FC<VariantImageManagerModalProps> = ({
  visible,
  variantId,
  offerId,
  images: initialImages,
  shopId,
  onOk,
  onCancel,
}) => {
  const [imageItems, setImageItems] = useState<ImageItem[]>(() =>
    initialImages.map((url, index) => ({
      id: `img-${index}-${Date.now()}`,
      url,
    }))
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步 props 变化
  React.useEffect(() => {
    if (visible) {
      setImageItems(
        initialImages.map((url, index) => ({
          id: `img-${index}-${Date.now()}`,
          url,
        }))
      );
    }
  }, [visible, initialImages]);

  const handleOk = () => {
    const urls = imageItems.map((item) => item.url);
    onOk(urls);
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleImageChange = (newImages: ImageItem[]) => {
    setImageItems(newImages);
  };

  const handleCloudinarySelect = (urls: string[]) => {
    const newItems: ImageItem[] = urls.map((url) => ({
      id: `img-${Date.now()}-${Math.random()}`,
      url,
    }));
    setImageItems([...imageItems, ...newItems]);
    notifySuccess('图片已添加', `已添加 ${urls.length} 张图片`);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 读取为 Base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result) {
              const base64String = (reader.result as string).split(',')[1];
              resolve(base64String);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // 上传到 Cloudinary
        const result = await uploadMedia({
          shop_id: shopId,
          type: 'base64',
          data: base64,
          folder: 'variants',
        });

        if (result.data?.url) {
          uploadedUrls.push(result.data.url);
        }
      }

      // 添加到图片列表
      const newItems: ImageItem[] = uploadedUrls.map((url) => ({
        id: `img-${Date.now()}-${Math.random()}`,
        url,
      }));
      setImageItems([...imageItems, ...newItems]);
      notifySuccess('上传成功', `已上传 ${uploadedUrls.length} 张图片`);
    } catch (error) {
      notifyError('上传失败', error);
    } finally {
      setUploading(false);
      // 重置 input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownload = () => {
    if (imageItems.length === 0) {
      message.warning('没有可下载的图片');
      return;
    }

    imageItems.forEach((item, index) => {
      const link = document.createElement('a');
      link.href = item.url;
      link.download = `${offerId}_${index + 1}.jpg`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    notifySuccess('下载开始', `正在下载 ${imageItems.length} 张图片`);
  };

  const handleWatermark = () => {
    if (imageItems.length === 0) {
      message.warning('没有可添加水印的图片');
      return;
    }

    // TODO: 实现批量水印功能
    // 需要集成 useWatermark Hook
    message.info('水印功能开发中...');
  };

  const processMenuItems: MenuProps['items'] = [
    {
      key: 'translate',
      label: '图片翻译',
      disabled: true,
    },
    {
      key: 'whitebg',
      label: '图片白底',
      disabled: true,
    },
    {
      key: 'resize',
      label: '改分辨率',
      disabled: true,
    },
    {
      key: 'ai',
      label: 'AI改图片',
      disabled: true,
    },
  ];

  const tabItems = [
    {
      key: 'cloudinary',
      label: '空间图片',
      children: <CloudinaryImageGrid onSelect={handleCloudinarySelect} />,
    },
    {
      key: 'network',
      label: '网络图片',
      children: <div style={{ padding: 20, textAlign: 'center' }}>功能开发中...</div>,
    },
  ];

  return (
    <Modal
      title={`变体图片编辑（货号：${offerId}）`}
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      width={1200}
      centered
      okText="保存"
      cancelText="取消"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className={styles.toolbar}>
        <Button
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          loading={uploading}
        >
          本地图片
        </Button>

        <Button
          icon={<DownloadOutlined />}
          onClick={handleDownload}
          disabled={imageItems.length === 0}
        >
          下载
        </Button>

        <Dropdown menu={{ items: processMenuItems }} trigger={['hover']}>
          <Button icon={<ToolOutlined />}>
            图片处理
          </Button>
        </Dropdown>

        <Button
          icon={<PictureOutlined />}
          onClick={handleWatermark}
          disabled={imageItems.length === 0}
        >
          图片水印
        </Button>
      </div>

      <div className={styles.content}>
        <div className={styles.leftPanel}>
          <div className={styles.panelTitle}>SKU图片</div>
          <ImageSortableList images={imageItems} onChange={handleImageChange} />
        </div>

        <div className={styles.rightPanel}>
          <Tabs items={tabItems} />
        </div>
      </div>
    </Modal>
  );
};
