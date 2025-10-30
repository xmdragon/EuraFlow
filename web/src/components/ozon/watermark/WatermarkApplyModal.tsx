/**
 * 水印应用Modal组件
 */
import { Alert, Divider, Modal, Progress, Select, Space, Tag } from 'antd';
import React, { useState } from 'react';

import { getPreviewWatermarkStyle } from '@/utils/ozon/watermarkUtils';
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
  watermarkBatchId: string | null;
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
  watermarkBatchId,
  watermarkAnalyzeMode,
  onPreview,
}) => {
  const [selectedWatermarkConfig, setSelectedWatermarkConfig] = useState<number | null>(null);
  const [manualPositions, setManualPositions] = useState<Map<string, string>>(new Map());
  const [imageWatermarkSettings, setImageWatermarkSettings] = useState<
    Map<string, { watermarkId: number; position?: string }>
  >(new Map());

  // 处理手动选择位置变更
  const handlePositionChange = async (
    productId: number,
    imageIndex: number,
    position: string
  ) => {
    // 找到对应的预览数据并更新
    const updatedPreviews = watermarkPreviews.map((preview) => {
      if (preview.product_id === productId) {
        return {
          ...preview,
          images: preview.images?.map((img: any, idx: number) => {
            if ((img.image_index || idx) === imageIndex) {
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

  // 处理Modal取消
  const handleCancel = () => {
    setWatermarkStep('select');
    setWatermarkPreviews([]);
    setManualPositions(new Map());
    setSelectedWatermarkConfig(null);
    setImageWatermarkSettings(new Map());
    onCancel();
  };

  // 处理Modal确认
  const handleOk = async () => {
    if (!selectedWatermarkConfig) {
      return;
    }

    if (watermarkStep === 'select') {
      // 预览步骤
      const productIds = selectedRows.slice(0, 10).map((p) => p.id);
      const result = await onPreview(
        productIds,
        selectedWatermarkConfig,
        watermarkAnalyzeMode
      );
      setWatermarkPreviews(result.previews);
      setWatermarkStep('preview');
      setManualPositions(new Map());
      setImageWatermarkSettings(new Map());
    } else {
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
    }
  };

  return (
    <Modal
      title={watermarkStep === 'select' ? '选择水印配置' : '预览水印效果'}
      open={visible}
      onCancel={handleCancel}
      onOk={handleOk}
      okText={watermarkStep === 'select' ? '预览效果' : '确认应用'}
      confirmLoading={confirmLoading || previewLoading}
      width={watermarkStep === 'preview' ? 1200 : 600}
    >
      <div>
        <Alert
          message={`已选择 ${selectedRows.length} 个商品`}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {/* 位置选择提示 */}
        <div style={{ marginBottom: 16 }}>
          <Alert
            message="位置选择说明"
            description={
              <div>
                <p>• 预览时请点击图片上的9宫格选择水印位置</p>
                <p>• 未手动选择的图片将在应用时自动分析最佳位置</p>
                <p>• 蓝色高亮表示当前选择的位置</p>
              </div>
            }
            type="info"
            showIcon
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ marginRight: 8 }}>选择水印:</label>
          <Select
            style={{ width: '100%' }}
            placeholder="请选择水印配置"
            value={selectedWatermarkConfig}
            onChange={(value) => setSelectedWatermarkConfig(value)}
          >
            {(watermarkConfigs || []).map((config) => (
              <Option key={config.id} value={config.id}>
                <Space>
                  <img
                    src={optimizeOzonImageUrl(config.image_url, 20)}
                    alt={config.name}
                    style={{ width: 20, height: 20, objectFit: 'contain' }}
                  />
                  <span>{config.name}</span>
                  <Tag>{config.color_type}</Tag>
                  <span style={{ color: '#999', fontSize: 12 }}>
                    {(config.scale_ratio * 100).toFixed(0)}% / {(config.opacity * 100).toFixed(0)}
                    %
                  </span>
                </Space>
              </Option>
            ))}
          </Select>
        </div>

        {watermarkBatchId && (
          <Progress
            percent={50}
            status="active"
            showInfo={true}
            strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
          />
        )}

        {/* 预览结果 */}
        {watermarkStep === 'preview' && watermarkPreviews.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Divider>预览结果</Divider>
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
                        {preview.images.map((img: any, imgArrayIndex: number) => (
                          <div
                            key={imgArrayIndex}
                            style={{
                              border: '1px solid #e8e8e8',
                              borderRadius: 8,
                              padding: 8,
                              backgroundColor: 'white',
                            }}
                          >
                            {/* 图片类型标签 */}
                            <div
                              style={{
                                marginBottom: 8,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <Tag color={img.image_type === 'primary' ? 'green' : 'default'}>
                                {img.image_type === 'primary'
                                  ? '主图'
                                  : `附加图 ${img.image_index + 1}`}
                              </Tag>
                              {img.suggested_position && (
                                <Tag color="blue">位置: {img.suggested_position}</Tag>
                              )}
                            </div>

                            {/* 水印选择器 */}
                            <div style={{ marginBottom: 8 }}>
                              <Select
                                style={{ width: '100%' }}
                                size="small"
                                placeholder="选择水印"
                                value={
                                  imageWatermarkSettings.get(
                                    `${preview.product_id}_${imgArrayIndex}`
                                  )?.watermarkId || selectedWatermarkConfig
                                }
                                onChange={(watermarkId) => {
                                  const key = `${preview.product_id}_${imgArrayIndex}`;
                                  const currentSettings = imageWatermarkSettings.get(key) || {};
                                  const newSettings = new Map(imageWatermarkSettings);
                                  newSettings.set(key, {
                                    ...currentSettings,
                                    watermarkId,
                                    position: manualPositions.get(key),
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
                            </div>

                            {img.error ? (
                              <Alert message={`处理失败: ${img.error}`} type="error" showIcon />
                            ) : (
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
                                    src={optimizeOzonImageUrl(img.original_url, 300)}
                                    alt="原图预览"
                                    style={{
                                      display: 'block',
                                      maxWidth: '100%',
                                      maxHeight: '300px',
                                      objectFit: 'contain',
                                    }}
                                    onError={(e) => {
                                      loggers.product.error('原图加载失败:', img.original_url);
                                      e.currentTarget.src =
                                        'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwiPuWKoOi9veWksei0pTwvdGV4dD48L3N2Zz4=';
                                    }}
                                  />

                                  {/* 水印预览层 */}
                                  {(() => {
                                    const key = `${preview.product_id}_${imgArrayIndex}`;
                                    const settings = imageWatermarkSettings.get(key);
                                    const watermarkId =
                                      settings?.watermarkId || selectedWatermarkConfig;
                                    const position = settings?.position || manualPositions.get(key);

                                    if (watermarkId && position) {
                                      const watermarkConfig = (watermarkConfigs || []).find(
                                        (c) => c.id === watermarkId
                                      );
                                      if (watermarkConfig) {
                                        return (
                                          <img
                                            src={optimizeOzonImageUrl(
                                              watermarkConfig.image_url,
                                              100
                                            )}
                                            alt="水印预览"
                                            style={{
                                              position: 'absolute',
                                              ...getPreviewWatermarkStyle(position, watermarkConfig),
                                              pointerEvents: 'none',
                                            }}
                                          />
                                        );
                                      }
                                    }
                                    return null;
                                  })()}

                                  {/* 9宫格位置选择器 */}
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: 0,
                                      left: 0,
                                      right: 0,
                                      bottom: 0,
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(3, 1fr)',
                                      gridTemplateRows: 'repeat(3, 1fr)',
                                      gap: 0,
                                    }}
                                  >
                                    {[
                                      'top_left',
                                      'top_center',
                                      'top_right',
                                      'center_left',
                                      null,
                                      'center_right',
                                      'bottom_left',
                                      'bottom_center',
                                      'bottom_right',
                                    ].map((position, index) => {
                                      if (position === null) return <div key={index} />;

                                      const positionKey = `${preview.product_id}_${imgArrayIndex}`;
                                      const currentSettings = imageWatermarkSettings.get(positionKey);
                                      const isSelected =
                                        (currentSettings?.position ||
                                          manualPositions.get(positionKey)) === position;

                                      return (
                                        <div
                                          key={index}
                                          onClick={() => {
                                            const newPositions = new Map(manualPositions);
                                            newPositions.set(positionKey, position);
                                            setManualPositions(newPositions);

                                            const newSettings = new Map(imageWatermarkSettings);
                                            const watermarkId =
                                              currentSettings?.watermarkId ||
                                              selectedWatermarkConfig;
                                            if (watermarkId) {
                                              newSettings.set(positionKey, {
                                                watermarkId,
                                                position,
                                              });
                                              setImageWatermarkSettings(newSettings);
                                            }

                                            handlePositionChange(
                                              preview.product_id,
                                              imgArrayIndex,
                                              position
                                            );
                                          }}
                                          style={{
                                            cursor: 'pointer',
                                            backgroundColor: isSelected
                                              ? 'rgba(24, 144, 255, 0.15)'
                                              : 'transparent',
                                            border: '1px solid transparent',
                                            transition: 'all 0.2s',
                                            position: 'relative',
                                            overflow: 'hidden',
                                          }}
                                          onMouseEnter={(e) => {
                                            if (!isSelected) {
                                              e.currentTarget.style.backgroundColor =
                                                'rgba(24, 144, 255, 0.08)';
                                            }
                                          }}
                                          onMouseLeave={(e) => {
                                            if (!isSelected) {
                                              e.currentTarget.style.backgroundColor = 'transparent';
                                            }
                                          }}
                                          title={`点击选择位置: ${position.replace('_', ' ')}`}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
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
