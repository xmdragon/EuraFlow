/**
 * 水印应用Modal组件
 */
import { Alert, Divider, Modal, Select, Space, Tag } from 'antd';
import React, { useState } from 'react';

import {
  getPreviewWatermarkStyle,
  POSITION_LABELS,
  type WatermarkPosition,
} from '@/utils/ozon/watermarkUtils';
import { useWatermarkConfig } from '@/hooks/ozon/useWatermarkConfig';
import { WatermarkPositionGrid } from './WatermarkPositionGrid';
import * as ozonApi from '@/services/ozonApi';
import * as watermarkApi from '@/services/watermarkApi';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import { loggers } from '@/utils/logger';

const { Option } = Select;

export interface WatermarkApplyModalProps {
  visible: boolean;
  onCancel: () => void;
  onOk: (data: {
    productIds: number[];
    configId: number;
    analyzeMode: 'individual' | 'fast';
    positionOverrides?: Record<string, Record<string, any>>;
  }) => void;
  selectedRows: ozonApi.Product[];
  watermarkConfigs: watermarkApi.WatermarkConfig[];
  watermarkStep: 'select' | 'preview';
  setWatermarkStep: (step: 'select' | 'preview') => void;
  watermarkPreviews: any[];
  setWatermarkPreviews: (previews: any[]) => void;
  confirmLoading: boolean;
  previewLoading: boolean;
  watermarkAnalyzeMode: 'individual' | 'fast';
  onPreview: (
    productIds: number[],
    configId: number,
    analyzeMode: 'individual' | 'fast'
  ) => Promise<any>;
}

/**
 * 水印应用Modal组件
 */
export const WatermarkApplyModal: React.FC<WatermarkApplyModalProps> = ({
  visible,
  onCancel,
  onOk,
  selectedRows,
  watermarkConfigs,
  watermarkStep,
  setWatermarkStep,
  watermarkPreviews,
  setWatermarkPreviews,
  confirmLoading,
  previewLoading,
  watermarkAnalyzeMode,
  onPreview,
}) => {
  // 使用水印配置 Hook (仅用于获取默认配置)
  const { getDefaultConfig } = useWatermarkConfig({
    enabled: false,  // 不自动加载，使用外部传入的配置
    initialConfigs: watermarkConfigs,
  });

  const [selectedWatermarkConfig, setSelectedWatermarkConfig] = useState<number | null>(null);
  const [manualPositions, setManualPositions] = useState<Map<string, string>>(new Map());
  const [imageWatermarkSettings, setImageWatermarkSettings] = useState<
    Map<string, { watermarkId: number; position?: string }>
  >(new Map());

  // 处理手动选择位置变更
  const handlePositionChange = async (
    productId: number,
    imageArrayIndex: number,
    position: string
  ) => {
    // 找到对应的预览数据并更新
    const updatedPreviews = watermarkPreviews.map((preview) => {
      if (preview.product_id === productId) {
        return {
          ...preview,
          images: preview.images?.map((img: any, idx: number) => {
            // 使用数组索引进行匹配，确保准确性
            if (idx === imageArrayIndex) {
              return {
                ...img,
                suggested_position: position,
                manual_position: position,
              };
            }
            return img;
          }),
        };
      }
      return preview;
    });

    setWatermarkPreviews(updatedPreviews);
  };

  // 打开Modal时自动加载预览
  React.useEffect(() => {
    if (visible && watermarkPreviews.length === 0) {
      // 使用第一个水印配置自动预览
      const defaultConfig = getDefaultConfig();
      if (defaultConfig) {
        setSelectedWatermarkConfig(defaultConfig.id);
        const productIds = selectedRows.slice(0, 10).map((p) => p.id);
        onPreview(productIds, defaultConfig.id, watermarkAnalyzeMode).then((result) => {
          setWatermarkPreviews(result.previews);

          // 自动为所有图片设置默认位置（右下角）
          const newManualPositions = new Map<string, WatermarkPosition>();
          result.previews.forEach((preview) => {
            preview.images.forEach((img, index) => {
              const imageKey = `${preview.product_id}_${index}`;
              newManualPositions.set(imageKey, 'bottom_right');
            });
          });
          setManualPositions(newManualPositions);
        });
      }
    }
  }, [visible, watermarkPreviews.length, getDefaultConfig, selectedRows, watermarkAnalyzeMode, onPreview]);

  // 处理Modal取消
  const handleCancel = () => {
    setWatermarkPreviews([]);
    setManualPositions(new Map());
    setSelectedWatermarkConfig(null);
    setImageWatermarkSettings(new Map());
    onCancel();
  };

  // 处理Modal确认（应用水印）
  const handleOk = async () => {
    if (!selectedWatermarkConfig) {
      return;
    }

    // 确认应用水印
    const productIds = selectedRows.map((p) => p.id);

    // 构建每张图片的独立配置映射
    const imageOverrides: Record<string, Record<string, any>> = {};
    imageWatermarkSettings.forEach((settings, key) => {
      const [productId, imageIndex] = key.split('_');
      if (!imageOverrides[productId]) {
        imageOverrides[productId] = {};
      }
      imageOverrides[productId][imageIndex] = {
        watermark_config_id: settings.watermarkId,
        position: settings.position,
      };
    });

    // 如果没有独立设置，使用旧的位置映射逻辑
    if (Object.keys(imageOverrides).length === 0) {
      manualPositions.forEach((position, key) => {
        const [productId, imageIndex] = key.split('_');
        if (!imageOverrides[productId]) {
          imageOverrides[productId] = {};
        }
        imageOverrides[productId][imageIndex] = {
          watermark_config_id: selectedWatermarkConfig,
          position: position,
        };
      });
    }

    onOk({
      productIds,
      configId: selectedWatermarkConfig,
      analyzeMode: watermarkAnalyzeMode,
      positionOverrides: Object.keys(imageOverrides).length > 0 ? imageOverrides : undefined,
    });

    // 重置状态
    handleCancel();
  };

  return (
    <Modal
      title="预览水印效果"
      open={visible}
      onCancel={handleCancel}
      onOk={handleOk}
      okText="确认应用"
      confirmLoading={confirmLoading || previewLoading}
      width={1200}
    >
      <div>
        {/* 预览结果 */}
        {watermarkPreviews.length > 0 && (
          <div>
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {watermarkPreviews.map((preview) => (
                <div
                  key={preview.product_id}
                  style={{
                    marginBottom: 24,
                    padding: 16,
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    backgroundColor: '#fafafa',
                  }}
                >
                  <div
                    style={{
                      marginBottom: 12,
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    <strong>{preview.sku}</strong> - {preview.title}
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {preview.total_images || preview.images?.length || 0} 张图片
                    </Tag>
                  </div>

                  {preview.error ? (
                    <Alert message={preview.error} type="error" />
                  ) : preview.images && preview.images.length > 0 ? (
                    <div>
                      {/* 多图预览网格布局 */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                          gap: 12,
                          marginTop: 8,
                        }}
                      >
                        {preview.images.map((img: any, imgArrayIndex: number) => {
                          // 使用数组索引作为唯一标识，确保每张图片都有独立的状态
                          // 不使用 img.image_index 因为它可能在不同情况下不可靠或重复
                          const imageKey = `${preview.product_id}_${imgArrayIndex}`;

                          return (
                            <div
                              key={imgArrayIndex}
                              style={{
                                border: '1px solid #e8e8e8',
                                borderRadius: 8,
                                padding: 8,
                                backgroundColor: 'white',
                              }}
                            >
                              {/* 图片标签和水印选择器 - 放在同一行 */}
                              <div
                                style={{
                                  marginBottom: 8,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <Tag color={img.image_type === 'primary' ? 'green' : 'default'}>
                                  {img.image_type === 'primary'
                                    ? '主图'
                                    : `图${imgArrayIndex + 1}`}
                                </Tag>
                                <Select
                                  style={{ width: 120 }}
                                  size="small"
                                  placeholder="水印"
                                  value={
                                    imageWatermarkSettings.get(imageKey)?.watermarkId ||
                                    selectedWatermarkConfig
                                  }
                                  onChange={(watermarkId) => {
                                    const currentSettings = imageWatermarkSettings.get(imageKey) || {};
                                    const newSettings = new Map(imageWatermarkSettings);
                                    newSettings.set(imageKey, {
                                      ...currentSettings,
                                      watermarkId,
                                      position: manualPositions.get(imageKey),
                                    });
                                    setImageWatermarkSettings(newSettings);
                                  }}
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
                                {img.suggested_position && (
                                  <Tag color="blue">
                                    {POSITION_LABELS[img.suggested_position] || img.suggested_position}
                                  </Tag>
                                )}
                              </div>

                            {img.error ? (
                              <Alert message={`处理失败: ${img.error}`} type="error" showIcon />
                            ) : (
                              <div
                                style={{
                                  border: '1px solid #f0f0f0',
                                  borderRadius: 4,
                                  backgroundColor: '#f9f9f9',
                                  overflow: 'hidden',
                                }}
                              >
                                {/* 图片和水印容器 - 紧密包裹图片，确保水印定位准确 */}
                                <div
                                  style={{
                                    position: 'relative',
                                    display: 'block',
                                    width: '100%',
                                  }}
                                >
                                  {/* 原图显示 */}
                                  <img
                                    src={optimizeOzonImageUrl(img.original_url, 300)}
                                    alt="原图预览"
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      height: 'auto',
                                    }}
                                    onError={(e) => {
                                      loggers.product.error('原图加载失败:', img.original_url);
                                      e.currentTarget.src =
                                        'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwiPuWKoOi9veWksei0pTwvdGV4dD48L3N2Zz4=';
                                    }}
                                  />

                                  {/* 水印预览层 */}
                                  {(() => {
                                    const settings = imageWatermarkSettings.get(imageKey);
                                    const watermarkId =
                                      settings?.watermarkId || selectedWatermarkConfig;
                                    // 使用默认位置：优先使用手动设置 > 后端建议 > 默认右下角
                                    const position = settings?.position || manualPositions.get(imageKey) || img.suggested_position || 'bottom_right';

                                    if (watermarkId && position) {
                                      const watermarkConfig = (watermarkConfigs || []).find(
                                        (c) => c.id === watermarkId
                                      );
                                      if (watermarkConfig) {
                                        return (
                                          <img
                                            src={watermarkConfig.image_url}
                                            alt="水印预览"
                                            style={{
                                              position: 'absolute',
                                              ...getPreviewWatermarkStyle(position, watermarkConfig),
                                              pointerEvents: 'none',
                                              zIndex: 15, // 在原图之上，但在9宫格之下
                                            }}
                                          />
                                        );
                                      }
                                    }
                                    return null;
                                  })()}

                                  {/* 9宫格位置选择器 */}
                                  <WatermarkPositionGrid
                                    selectedPosition={
                                      (() => {
                                        const currentSettings = imageWatermarkSettings.get(imageKey);
                                        const manualPos = manualPositions.get(imageKey);
                                        return (
                                          (currentSettings?.position as WatermarkPosition) ||
                                          (manualPos as WatermarkPosition) ||
                                          undefined
                                        );
                                      })()
                                    }
                                    watermarkImageUrl={
                                      (() => {
                                        const currentSettings = imageWatermarkSettings.get(imageKey);
                                        const watermarkId =
                                          currentSettings?.watermarkId || selectedWatermarkConfig;
                                        const watermarkConfig = watermarkConfigs?.find(
                                          (c) => c.id === watermarkId
                                        );
                                        return watermarkConfig?.image_url;
                                      })()
                                    }
                                    onPositionSelect={(position) => {
                                      // 更新手动位置设置
                                      const newPositions = new Map(manualPositions);
                                      newPositions.set(imageKey, position);
                                      setManualPositions(newPositions);

                                      // 更新水印设置
                                      const currentSettings = imageWatermarkSettings.get(imageKey);
                                      const newSettings = new Map(imageWatermarkSettings);
                                      const watermarkId =
                                        currentSettings?.watermarkId || selectedWatermarkConfig;
                                      if (watermarkId) {
                                        newSettings.set(imageKey, {
                                          watermarkId,
                                          position,
                                        });
                                        setImageWatermarkSettings(newSettings);
                                      }

                                      // 通知外部位置变更
                                      handlePositionChange(
                                        preview.product_id,
                                        imgArrayIndex,
                                        position
                                      );
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}

              {selectedRows.length > 10 && (
                <Alert
                  message={`仅显示前10个商品的预览，共选中${selectedRows.length}个商品`}
                  type="info"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
