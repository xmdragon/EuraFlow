/**
 * 图片水印应用Modal（图片编辑场景）
 * 基于图片URL的通用水印应用组件，可用于任意图片编辑场景
 */
import React, { useState } from 'react';
import { Modal, Space, Button, Alert, notification, Select, Tag, Divider } from 'antd';
import type { WatermarkConfig } from '@/services/watermarkApi';
import { previewWatermark, applyWatermarkToUrl } from '@/services/watermarkApi';
import {
  getPreviewWatermarkStyle,
  POSITION_LABELS,
  type WatermarkPosition,
} from '@/utils/ozon/watermarkUtils';
import { useWatermarkConfig } from '@/hooks/ozon/useWatermarkConfig';
import { useWatermarkSettings } from '@/hooks/ozon/useWatermarkSettings';
import { WatermarkPositionGrid } from './WatermarkPositionGrid';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import { logger } from '@/utils/logger';
import styles from './ImageWatermarkModal.module.scss';

const { Option } = Select;

interface ImageItem {
  /** 图片唯一标识（由调用方提供，可以是索引、ID等） */
  id: string;
  /** 图片URL */
  url: string;
  /** 图片标签（可选，用于显示） */
  label?: string;
}

interface ImageWatermarkModalProps {
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onCancel: () => void;
  /** 应用水印完成回调，返回每张图片的新URL */
  onApply: (results: Array<{ id: string; url: string }>) => void;
  /** 图片列表 */
  images: ImageItem[];
  /** 店铺ID（用于上传图片到图床） */
  shopId: number;
  /** 水印配置列表（可选，如果不提供则自动加载） */
  watermarkConfigs?: WatermarkConfig[];
}

/**
 * 图片水印应用Modal组件
 */
const ImageWatermarkModal: React.FC<ImageWatermarkModalProps> = ({
  visible,
  onCancel,
  onApply,
  images,
  shopId,
  watermarkConfigs: propWatermarkConfigs,
}) => {
  const [applyLoading, setApplyLoading] = useState(false);

  // 使用水印配置 Hook
  const { configs: watermarkConfigs, loading: configsLoading, getDefaultConfig } = useWatermarkConfig({
    enabled: visible,
    initialConfigs: propWatermarkConfigs,
    onlyActive: true,
  });

  // 使用水印设置 Hook
  const {
    settings: watermarkSettings,
    setPosition,
    setConfigId,
    getSetting,
    setDefaults,
    reset: resetSettings,
  } = useWatermarkSettings();

  // 自动设置默认水印和位置
  React.useEffect(() => {
    if (visible && watermarkConfigs.length > 0 && images.length > 0) {
      const defaultConfig = getDefaultConfig();
      if (defaultConfig) {
        const imageIds = images.map((img) => img.id);
        setDefaults(imageIds, defaultConfig.id, 'bottom_right');
      }
    }
  }, [visible, watermarkConfigs, images, getDefaultConfig, setDefaults]);

  // 处理位置点击
  const handlePositionClick = (imageId: string, position: WatermarkPosition) => {
    const currentSettings = getSetting(imageId);
    const configId = currentSettings?.configId;

    if (!configId) {
      notification.warning({
        message: '请先选择水印',
        description: '请为该图片选择一个水印配置',
        placement: 'bottomRight',
      });
      return;
    }

    setPosition(imageId, position);
  };

  // 处理单张图片水印配置变更
  const handleConfigChange = (imageId: string, newConfigId: number) => {
    setConfigId(imageId, newConfigId);
  };

  // 应用水印
  const handleApply = async () => {
    // 筛选出已配置水印的图片
    const imagesToProcess = images.filter((img) => {
      const setting = getSetting(img.id);
      return setting && setting.position;
    });

    if (imagesToProcess.length === 0) {
      notification.warning({
        message: '无图片需要处理',
        description: '请先为图片选择水印配置和位置',
        placement: 'bottomRight',
      });
      return;
    }

    setApplyLoading(true);

    try {
      const BATCH_SIZE = 5;
      const finalResults: Array<{ id: string; url: string }> = [];

      // 使用URL方式应用水印（利用Cloudinary/阿里云transformation，不使用base64）
      for (let i = 0; i < imagesToProcess.length; i += BATCH_SIZE) {
        const batch = imagesToProcess.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (img) => {
          const setting = getSetting(img.id);
          if (!setting || !setting.position) return null;

          try {
            const result = await applyWatermarkToUrl(
              img.url,
              setting.configId,
              setting.position,
              shopId
            );

            if (result.success && result.url) {
              return {
                id: img.id,
                url: result.url,
              };
            }
          } catch (error) {
            logger.error(`处理图片 ${img.id} 失败`, error);
          }
          return null;
        });

        const batchResults = await Promise.all(promises);
        finalResults.push(...batchResults.filter((r): r is { id: string; url: string } => r !== null));
      }

      if (finalResults.length === 0) {
        notification.warning({
          message: '水印应用失败',
          description: '所有图片处理失败，请重试',
          placement: 'bottomRight',
        });
        return;
      }

      // 对于未处理的图片，保持原URL
      const allResults = images.map((img) => {
        const processed = finalResults.find((r) => r.id === img.id);
        return processed || { id: img.id, url: img.url };
      });

      notification.success({
        message: '水印应用完成',
        description: `成功处理 ${finalResults.length} 张图片`,
        placement: 'bottomRight',
      });

      onApply(allResults);
      handleReset();
    } catch (error: any) {
      logger.error('应用水印失败', error);
      notification.error({
        message: '应用失败',
        description: error.message,
        placement: 'bottomRight',
      });
    } finally {
      setApplyLoading(false);
    }
  };

  // 重置状态
  const handleReset = () => {
    resetSettings();
  };

  // 处理取消
  const handleCancel = () => {
    handleReset();
    onCancel();
  };

  return (
    <Modal
      title="应用水印"
      open={visible}
      onCancel={handleCancel}
      footer={
        <Space>
          <Button onClick={handleCancel} disabled={applyLoading}>取消</Button>
          <Button type="primary" onClick={handleApply} loading={applyLoading}>
            应用水印
          </Button>
        </Space>
      }
      width={1200}
      destroyOnClose
    >
      <div className={styles.container}>
        {/* 图片网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            marginTop: 16,
            maxHeight: 600,
            overflowY: 'auto',
          }}
        >
          {images.map((img, index) => {
            const setting = getSetting(img.id);
            const watermarkConfig = setting
              ? watermarkConfigs.find((c) => c.id === setting.configId)
              : null;

            return (
              <div
                key={img.id}
                style={{
                  border: '1px solid #e8e8e8',
                  borderRadius: 8,
                  padding: 12,
                  backgroundColor: 'white',
                }}
              >
                {/* 图片标题和控制栏 */}
                <div
                  style={{
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Tag color={index === 0 ? 'green' : 'default'}>
                    {img.label || `图片 ${index + 1}`}
                  </Tag>

                  {/* 水印选择器 */}
                  <Select
                    style={{ flex: 1, minWidth: 0 }}
                    size="small"
                    placeholder="选择水印"
                    value={setting?.configId || undefined}
                    onChange={(configId) => handleConfigChange(img.id, configId)}
                    allowClear
                  >
                    {(watermarkConfigs || []).map((config) => (
                      <Option key={config.id} value={config.id}>
                        <Space size="small">
                          <img
                            src={optimizeOzonImageUrl(config.image_url, 16)}
                            alt={config.name}
                            style={{
                              width: 16,
                              height: 16,
                              objectFit: 'contain',
                            }}
                          />
                          <span style={{ fontSize: 12 }}>{config.name}</span>
                        </Space>
                      </Option>
                    ))}
                  </Select>

                  {setting?.position && (
                    <Tag color="blue">{POSITION_LABELS[setting.position]}</Tag>
                  )}
                </div>

                {/* 图片预览容器 */}
                <div
                  style={{
                    position: 'relative',
                    border: '1px solid #f0f0f0',
                    borderRadius: 4,
                    backgroundColor: '#f9f9f9',
                    height: 300,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* 图片和9宫格容器 */}
                  <div
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                    }}
                  >
                    {/* 原图显示 */}
                    <img
                      src={optimizeOzonImageUrl(img.url, 300)}
                      alt="原图预览"
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: '300px',
                        objectFit: 'contain',
                      }}
                      onError={(e) => {
                        logger.error('原图加载失败:', img.url);
                        e.currentTarget.src =
                          'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwiPuWKoOi9veWksei0pTwvdGV4dD48L3N2Zz4=';
                      }}
                    />

                    {/* 水印预览层 */}
                    {watermarkConfig && setting?.position && (
                      <img
                        src={optimizeOzonImageUrl(watermarkConfig.image_url, 100)}
                        alt="水印预览"
                        style={{
                          position: 'absolute',
                          ...getPreviewWatermarkStyle(setting.position, watermarkConfig),
                          pointerEvents: 'none',
                          zIndex: 15, // 在原图之上，但在9宫格之下
                        }}
                      />
                    )}

                    {/* 9宫格位置选择器 */}
                    <WatermarkPositionGrid
                      selectedPosition={setting?.position}
                      watermarkImageUrl={watermarkConfig?.image_url}
                      onPositionSelect={(position) => handlePositionClick(img.id, position)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default ImageWatermarkModal;
