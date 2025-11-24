import React, { useState, useEffect } from 'react';
import { Button, Spin, Empty } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import {
  listCloudinaryResources,
  CloudinaryResource,
} from '@/services/watermarkApi';
import { notifyError } from '@/utils/notification';
import ImagePreview from '@/components/ImagePreview';
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
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  const loadResources = async (cursor?: string) => {
    try {
      setLoading(true);
      const response = await listCloudinaryResources({
        folder,
        max_results: 20,
        next_cursor: cursor,
        group_by_folder: false, // 不分组，直接返回资源列表
      });

      const resourceList = response.resources || [];

      if (cursor) {
        // 追加加载
        setResources((prev) => [...prev, ...resourceList]);
      } else {
        // 首次加载
        setResources(resourceList);
      }

      setNextCursor(response.next_cursor);
      setHasMore(!!response.next_cursor);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      notifyError('加载图片失败', errorMsg);
      // 出错时设置为空数组
      setResources([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResources();
     
  }, [folder]);

  const handleImageClick = (url: string) => {
    onSelect([url]);
  };

  const handlePreview = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setPreviewIndex(index);
    setPreviewVisible(true);
  };

  const closePreview = () => {
    setPreviewVisible(false);
  };

  const handleLoadMore = () => {
    if (nextCursor) {
      loadResources(nextCursor);
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>, publicId: string) => {
    const img = e.currentTarget;
    setImageDimensions((prev) => {
      const newMap = new Map(prev);
      newMap.set(publicId, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      return newMap;
    });
  };

  return (
    <>
      <div className={styles.container}>
        {loading && resources.length === 0 ? (
          <div className={styles.loading}>
            <Spin tip="加载中..." />
          </div>
        ) : resources.length === 0 ? (
          <Empty description="暂无图片" className={styles.empty} />
        ) : (
          <>
            <div className={styles.grid}>
              {resources.map((resource, index) => {
                // 优先使用动态检测的尺寸，其次使用API返回的尺寸
                const dimensions = imageDimensions.get(resource.public_id) ||
                                  (resource.width && resource.height ? { width: resource.width, height: resource.height } : null);

                return (
                  <div
                    key={resource.public_id}
                    className={styles.gridItem}
                    onClick={() => handleImageClick(resource.url)}
                  >
                    <div className={styles.imagePreview}>
                      <img
                        src={resource.url}
                        alt={resource.public_id}
                        className={styles.image}
                        onLoad={(e) => handleImageLoad(e, resource.public_id)}
                      />
                      {dimensions && (
                        <div className={styles.imageDimensions}>
                          {dimensions.width} × {dimensions.height}
                        </div>
                      )}
                    </div>

                    <div className={styles.imageActions}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={(e) => handlePreview(e, index)}
                        title="预览"
                      />
                    </div>
                  </div>
                );
              })}
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

      {/* 图片预览 */}
      <ImagePreview
        images={resources.map((r) => r.url)}
        visible={previewVisible}
        initialIndex={previewIndex}
        onClose={closePreview}
      />
    </>
  );
};
