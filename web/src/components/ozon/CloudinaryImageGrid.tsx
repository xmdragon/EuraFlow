import React, { useState, useEffect } from 'react';
import { Checkbox, Button, Spin, Empty, Image } from 'antd';
import { CheckboxChangeEvent } from 'antd/es/checkbox';
import {
  listCloudinaryResources,
  CloudinaryResource,
} from '@/services/watermarkApi';
import { notifyError } from '@/utils/notification';
import styles from './CloudinaryImageGrid.module.scss';

interface CloudinaryImageGridProps {
  onSelect: (urls: string[]) => void;
  folder?: string;
}

export const CloudinaryImageGrid: React.FC<CloudinaryImageGridProps> = ({
  onSelect,
  folder,
}) => {
  const [loading, setLoading] = useState(false);
  const [resources, setResources] = useState<CloudinaryResource[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  const loadResources = async (cursor?: string) => {
    try {
      setLoading(true);
      const response = await listCloudinaryResources({
        folder,
        max_results: 20,
        next_cursor: cursor,
      });

      if (cursor) {
        // 追加加载
        setResources((prev) => [...prev, ...response.resources]);
      } else {
        // 首次加载
        setResources(response.resources);
      }

      setNextCursor(response.next_cursor);
      setHasMore(!!response.next_cursor);
    } catch (error) {
      notifyError('加载图片失败', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResources();
  }, [folder]);

  const handleCheckboxChange = (e: CheckboxChangeEvent, publicId: string) => {
    const newSelected = new Set(selectedIds);
    if (e.target.checked) {
      newSelected.add(publicId);
    } else {
      newSelected.delete(publicId);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = resources.map((r) => r.public_id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleConfirm = () => {
    const selectedUrls = resources
      .filter((r) => selectedIds.has(r.public_id))
      .map((r) => r.url);
    onSelect(selectedUrls);
    setSelectedIds(new Set()); // 清空选择
  };

  const handleLoadMore = () => {
    if (nextCursor) {
      loadResources(nextCursor);
    }
  };

  const allSelected = resources.length > 0 && selectedIds.size === resources.length;
  const indeterminate = selectedIds.size > 0 && selectedIds.size < resources.length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Checkbox
          checked={allSelected}
          indeterminate={indeterminate}
          onChange={(e) => handleSelectAll(e.target.checked)}
        >
          全选 ({selectedIds.size} / {resources.length})
        </Checkbox>

        <Button
          type="primary"
          disabled={selectedIds.size === 0}
          onClick={handleConfirm}
        >
          确定 ({selectedIds.size})
        </Button>
      </div>

      {loading && resources.length === 0 ? (
        <div className={styles.loading}>
          <Spin tip="加载中..." />
        </div>
      ) : resources.length === 0 ? (
        <Empty description="暂无图片" className={styles.empty} />
      ) : (
        <>
          <div className={styles.grid}>
            {resources.map((resource) => (
              <div
                key={resource.public_id}
                className={`${styles.gridItem} ${selectedIds.has(resource.public_id) ? styles.selected : ''}`}
              >
                <Checkbox
                  className={styles.checkbox}
                  checked={selectedIds.has(resource.public_id)}
                  onChange={(e) => handleCheckboxChange(e, resource.public_id)}
                />
                <Image
                  src={resource.url}
                  alt={resource.public_id}
                  className={styles.image}
                  preview={{
                    mask: <div>预览</div>,
                  }}
                />
                <div className={styles.imageInfo}>
                  <div className={styles.imageDimensions}>
                    {resource.width} × {resource.height}
                  </div>
                  <div className={styles.imageSize}>
                    {(resource.bytes / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className={styles.loadMore}>
              <Button loading={loading} onClick={handleLoadMore}>
                加载更多
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
