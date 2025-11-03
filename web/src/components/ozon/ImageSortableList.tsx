import React from 'react';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Dropdown, MenuProps } from 'antd';
import {
  HomeOutlined,
  EditOutlined,
  DeleteOutlined,
  DragOutlined,
} from '@ant-design/icons';
import styles from './ImageSortableList.module.scss';

export interface ImageItem {
  id: string;
  url: string;
}

interface ImageSortableListProps {
  images: ImageItem[];
  onChange: (images: ImageItem[]) => void;
  onEdit?: (image: ImageItem, index: number) => void;
}

interface SortableImageItemProps {
  image: ImageItem;
  index: number;
  isFirst: boolean;
  onSetAsMain: (id: string) => void;
  onEdit?: (image: ImageItem, index: number) => void;
  onDelete: (id: string) => void;
}

const SortableImageItem: React.FC<SortableImageItemProps> = ({
  image,
  index,
  isFirst,
  onSetAsMain,
  onEdit,
  onDelete,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleEditClick = () => {
    if (onEdit) {
      onEdit(image, index);
    }
  };

  const editMenuItems: MenuProps['items'] = [
    {
      key: 'watermark',
      label: '图片水印',
    },
    {
      key: 'download',
      label: '图片下载',
    },
    {
      type: 'divider',
    },
    {
      key: 'transform',
      label: '图片变化',
      disabled: true,
    },
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

  return (
    <div ref={setNodeRef} style={style} className={styles.imageItem}>
      <div className={styles.imagePreview}>
        <img src={image.url} alt="" className={styles.image} />
        {isFirst && (
          <div className={styles.mainBadge}>
            <HomeOutlined />
          </div>
        )}
      </div>

      <div className={styles.imageActions}>
        <Button
          type="text"
          size="small"
          icon={<DragOutlined />}
          className={styles.dragHandle}
          {...listeners}
          {...attributes}
        />

        {!isFirst && (
          <Button
            type="text"
            size="small"
            icon={<HomeOutlined />}
            onClick={() => onSetAsMain(image.id)}
            title="设为主图"
          />
        )}

        <Dropdown
          menu={{
            items: editMenuItems,
            onClick: ({ key }) => {
              // TODO: 实现编辑菜单功能
              console.log('Edit action:', key, image);
            },
          }}
          trigger={['click']}
        >
          <Button type="text" size="small" icon={<EditOutlined />} title="编辑" />
        </Dropdown>

        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDelete(image.id)}
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
}) => {
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
      const newImages = arrayMove(images, index, 0);
      onChange(newImages);
    }
  };

  const handleDelete = (id: string) => {
    const newImages = images.filter((item) => item.id !== id);
    onChange(newImages);
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={images.map((img) => img.id)} strategy={verticalListSortingStrategy}>
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
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};
