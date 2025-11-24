import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Dropdown, notification } from 'antd';
import type { MenuProps } from 'antd';
import {
  HomeOutlined,
  DeleteOutlined,
  EyeOutlined,
  EditOutlined,
  HighlightOutlined,
  FormatPainterOutlined,
} from '@ant-design/icons';
import ImagePreview from '@/components/ImagePreview';
import TranslationEngineModal from './TranslationEngineModal';
import type { TranslationResult as EngineTranslationResult } from './TranslationEngineModal';
import ImageRefineModal from './ImageRefineModal';
import type { RefineResult } from './ImageRefineModal';
import ImageWatermarkModal from './watermark/ImageWatermarkModal';
import { translateSingleImage } from '@/services/xiangjifanyiApi';
import styles from './ImageSortableList.module.scss';

export interface ImageItem {
  id: string;
  url: string;
  width?: number;
  height?: number;
  /** 翻译API返回的requestId（用于精修） */
  translationRequestId?: string;
  /** 抠图API返回的requestId（用于精修） */
  mattingRequestId?: string;
}

interface ImageSortableListProps {
  images: ImageItem[];
  onChange: (images: ImageItem[]) => void;
  onEdit?: (image: ImageItem, index: number) => void;
  shopId?: number;
  onResize?: (imageId: string, imageUrl: string) => void;
  onMatting?: (imageId: string, imageUrl: string) => void;
  onMattingRefine?: (imageId: string, imageUrl: string, mattingRequestId?: string) => void;
}

interface SortableImageItemProps {
  image: ImageItem;
  index: number;
  isFirst: boolean;
  onSetAsMain: (id: string) => void;
  onEdit?: (image: ImageItem, index: number) => void;
  onDelete: (id: string) => void;
  onPreview: (index: number) => void;
  onTranslate: (imageId: string, imageUrl: string) => void;
  onRefine: (imageId: string, requestId: string) => void;
  onWatermark: (imageId: string, imageUrl: string) => void;
  onResize?: (imageId: string, imageUrl: string) => void;
  onMatting?: (imageId: string, imageUrl: string) => void;
  onMattingRefine?: (imageId: string, imageUrl: string, mattingRequestId?: string) => void;
}

const SortableImageItem: React.FC<SortableImageItemProps> = ({
  image,
  index,
  isFirst,
  onSetAsMain,
  onEdit: _onEdit,
  onDelete,
  onPreview,
  onTranslate,
  onRefine,
  onWatermark,
  onResize,
  onMatting,
  onMattingRefine,
}) => {
  const [imageDimensions, setImageDimensions] = React.useState<{
    width: number;
    height: number;
  } | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: image.id });

  const editMenuItems: MenuProps['items'] = [
    {
      key: 'translate',
      label: '图片翻译',
      onClick: () => {
        onTranslate(image.id, image.url);
      },
    },
    {
      key: 'refine',
      label: '图片精修',
      onClick: () => {
        if (image.translationRequestId) {
          onRefine(image.id, image.translationRequestId);
        }
      },
      disabled: !image.translationRequestId,
    },
    {
      key: 'resize',
      label: '改分辨率',
      onClick: () => {
        if (onResize) {
          onResize(image.id, image.url);
        }
      },
      disabled: !onResize,
    },
    {
      key: 'whitebg',
      label: '图片白底',
      onClick: () => {
        if (onMatting) {
          onMatting(image.id, image.url);
        }
      },
      disabled: !onMatting,
    },
    {
      key: 'watermark',
      label: '图片水印',
      onClick: () => {
        onWatermark(image.id, image.url);
      },
    },
    {
      key: 'download',
      label: '图片下载',
      onClick: () => {
        const link = document.createElement('a');
        link.href = image.url;
        link.download = `image-${index + 1}.jpg`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      },
    },
  ];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // 检测图片尺寸
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  };

  // 使用预先存储的尺寸或检测到的尺寸
  const displayDimensions = imageDimensions || (image.width && image.height ? { width: image.width, height: image.height } : null);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.imageItem}
      {...attributes}
    >
      <div className={styles.imagePreview} {...listeners}>
        <img
          src={image.url}
          alt=""
          className={styles.image}
          onLoad={handleImageLoad}
        />
        {isFirst && (
          <div className={styles.mainBadge}>
            <HomeOutlined />
          </div>
        )}

        {displayDimensions && (
          <div className={styles.imageDimensions}>
            {displayDimensions.width} × {displayDimensions.height}
          </div>
        )}
      </div>

      <div className={styles.imageActions}>
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onPreview(index);
          }}
          title="预览"
        />

        <Dropdown menu={{ items: editMenuItems }} trigger={['hover']} placement="bottomRight">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => e.stopPropagation()}
            title="编辑"
          />
        </Dropdown>

        {/* 精修按钮（仅已翻译的图片显示） */}
        {image.translationRequestId && (
          <Button
            type="text"
            size="small"
            icon={<HighlightOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onRefine(image.id, image.translationRequestId!);
            }}
            title="精修"
            style={{ color: '#1890ff' }}
          />
        )}

        {/* 抠图精修按钮（所有图片都显示） */}
        {onMattingRefine && (
          <Button
            type="text"
            size="small"
            icon={<FormatPainterOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onMattingRefine(image.id, image.url, image.mattingRequestId);
            }}
            title="抠图精修"
            style={{ color: '#9254de' }}
          />
        )}

        {!isFirst && (
          <Button
            type="text"
            size="small"
            icon={<HomeOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onSetAsMain(image.id);
            }}
            title="设为主图"
          />
        )}

        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(image.id);
          }}
          title="删除"
        />
      </div>
    </div>
  );
};

export const ImageSortableList: React.FC<ImageSortableListProps> = ({
  images,
  onChange,
  onEdit,
  shopId = 1,
  onResize,
  onMatting,
  onMattingRefine,
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // 翻译相关状态
  const [translationModalVisible, setTranslationModalVisible] = useState(false);
  const [currentTranslatingImage, setCurrentTranslatingImage] = useState<{ id: string; url: string } | null>(null);

  // 精修相关状态
  const [refineModalVisible, setRefineModalVisible] = useState(false);
  const [currentRefiningImage, setCurrentRefiningImage] = useState<{ id: string; requestId: string } | null>(null);

  // 水印相关状态
  const [watermarkModalVisible, setWatermarkModalVisible] = useState(false);
  const [currentWatermarkImage, setCurrentWatermarkImage] = useState<{ id: string; url: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = images.findIndex((item) => item.id === active.id);
      const newIndex = images.findIndex((item) => item.id === over.id);

      const newImages = arrayMove(images, oldIndex, newIndex);
      onChange(newImages);
    }
  };

  const handleSetAsMain = (id: string) => {
    const index = images.findIndex((item) => item.id === id);
    if (index > 0) {
      // 与第一张图互换位置
      const newImages = [...images];
      [newImages[0], newImages[index]] = [newImages[index], newImages[0]];
      onChange(newImages);
    }
  };

  const handleDelete = (id: string) => {
    const newImages = images.filter((item) => item.id !== id);
    onChange(newImages);
  };

  const handlePreview = (index: number) => {
    setPreviewIndex(index);
    setPreviewVisible(true);
  };

  const closePreview = () => {
    setPreviewVisible(false);
  };

  /**
   * 处理翻译请求
   */
  const handleTranslate = (imageId: string, imageUrl: string) => {
    setCurrentTranslatingImage({ id: imageId, url: imageUrl });
    setTranslationModalVisible(true);
  };

  /**
   * 执行翻译
   */
  const handleTranslationExecute = async (engineType: number): Promise<EngineTranslationResult> => {
    if (!currentTranslatingImage) {
      return { success: false, error: '未选择图片' };
    }

    try {
      const result = await translateSingleImage(currentTranslatingImage.url, engineType);

      if (result && result.success) {
        // 更新图片列表，替换URL并保存requestId
        const newImages = images.map((img) => {
          if (img.id === currentTranslatingImage.id) {
            return {
              ...img,
              url: result.translated_url || img.url,
              translationRequestId: result.request_id,
            };
          }
          return img;
        });
        onChange(newImages);

        notification.success({
          message: '翻译成功',
          description: '图片已翻译并替换，您可以点击"精修"按钮进行进一步调整',
          placement: 'bottomRight',
        });

        return { success: true, requestId: result.request_id };
      } else {
        notification.error({
          message: '翻译失败',
          description: result?.error || '未知错误',
          placement: 'bottomRight',
        });
        return { success: false, error: result?.error || '未知错误' };
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      notification.error({
        message: '翻译失败',
        description: err.message || '网络错误',
        placement: 'bottomRight',
      });
      return { success: false, error: err.message };
    }
  };

  /**
   * 处理精修请求
   */
  const handleRefine = (imageId: string, requestId: string) => {
    setCurrentRefiningImage({ id: imageId, requestId });
    setRefineModalVisible(true);
  };

  /**
   * 精修完成回调
   */
  const handleRefineComplete = (result: RefineResult) => {
    if (!currentRefiningImage) return;

    // 更新图片URL
    const newImages = images.map((img) => {
      if (img.id === currentRefiningImage.id) {
        return {
          ...img,
          url: result.url,
        };
      }
      return img;
    });
    onChange(newImages);

    notification.success({
      message: '精修完成',
      description: '图片已更新',
      placement: 'bottomRight',
    });
  };

  /**
   * 处理水印请求
   */
  const handleWatermark = (imageId: string, imageUrl: string) => {
    setCurrentWatermarkImage({ id: imageId, url: imageUrl });
    setWatermarkModalVisible(true);
  };

  /**
   * 水印应用完成回调
   */
  const handleWatermarkApply = (results: Array<{ id: string; url: string }>) => {
    if (!currentWatermarkImage || results.length === 0) return;

    // 获取水印后的URL
    const result = results.find((r) => r.id === currentWatermarkImage.id);
    if (!result) return;

    // 更新图片URL
    const newImages = images.map((img) => {
      if (img.id === currentWatermarkImage.id) {
        return {
          ...img,
          url: result.url,
        };
      }
      return img;
    });
    onChange(newImages);

    notification.success({
      message: '水印应用成功',
      description: '图片已更新',
      placement: 'bottomRight',
    });

    setWatermarkModalVisible(false);
    setCurrentWatermarkImage(null);
  };

  if (images.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>暂无图片</p>
        <p className={styles.emptyTip}>从右侧选择图片或上传本地图片</p>
      </div>
    );
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={images.map((img) => img.id)} strategy={rectSortingStrategy}>
          <div className={styles.imageList}>
            {images.map((image, index) => (
              <SortableImageItem
                key={image.id}
                image={image}
                index={index}
                isFirst={index === 0}
                onSetAsMain={handleSetAsMain}
                onEdit={onEdit}
                onDelete={handleDelete}
                onPreview={handlePreview}
                onTranslate={handleTranslate}
                onRefine={handleRefine}
                onWatermark={handleWatermark}
                onResize={onResize}
                onMatting={onMatting}
                onMattingRefine={onMattingRefine}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* 图片预览 */}
      <ImagePreview
        images={images.map((img) => img.url)}
        visible={previewVisible}
        initialIndex={previewIndex}
        onClose={closePreview}
      />

      {/* 翻译引擎选择对话框 */}
      <TranslationEngineModal
        visible={translationModalVisible}
        onCancel={() => {
          setTranslationModalVisible(false);
          setCurrentTranslatingImage(null);
        }}
        onTranslate={handleTranslationExecute}
        title="选择翻译引擎"
        isBatch={false}
      />

      {/* 图片精修对话框 */}
      {currentRefiningImage && (
        <ImageRefineModal
          visible={refineModalVisible}
          onCancel={() => {
            setRefineModalVisible(false);
            setCurrentRefiningImage(null);
          }}
          requestIds={[currentRefiningImage.requestId]}
          onRefineComplete={handleRefineComplete}
          lang="CHS"
        />
      )}

      {/* 水印应用对话框 */}
      {currentWatermarkImage && (
        <ImageWatermarkModal
          visible={watermarkModalVisible}
          onCancel={() => {
            setWatermarkModalVisible(false);
            setCurrentWatermarkImage(null);
          }}
          onApply={handleWatermarkApply}
          images={[
            {
              id: currentWatermarkImage.id,
              url: currentWatermarkImage.url,
              label: '当前图片',
            },
          ]}
          shopId={shopId}
        />
      )}
    </>
  );
};
