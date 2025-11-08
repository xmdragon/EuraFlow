/**
 * 图片改分辨率Modal
 * 支持智能裁剪和填充，支持单张和批量模式
 */
import React, { useState, useEffect } from 'react';
import { Modal, Space, Button, Select, Radio, Alert, Spin, notification, Tag } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import {
  resizeImage,
  calculateResizeStrategy,
  PRESET_RESOLUTIONS,
  STRATEGY_LABELS,
  type ResizeStrategy,
} from '@/utils/imageResize';
import { uploadBase64Image } from '@/services/watermarkApi';
import { loggers } from '@/utils/logger';
import ImagePreview from '@/components/ImagePreview';

const { Option } = Select;

interface ImageItem {
  /** 图片唯一标识 */
  id: string;
  /** 图片URL */
  url: string;
  /** 图片标签（可选） */
  label?: string;
}

interface ImageResizeModalProps {
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onCancel: () => void;
  /** 保存完成回调（批量模式返回多个URL） */
  onSave: (results: Array<{ id: string; url: string }>) => void;
  /** 图片列表（支持单张或批量） */
  images: ImageItem[];
  /** 店铺ID（用于上传到图床） */
  shopId: number;
}

interface ImageState {
  /** 原图尺寸 */
  size: { width: number; height: number } | null;
  /** 选择的分辨率 */
  resolution: { width: number; height: number } | null;
  /** 处理策略 */
  strategy: ResizeStrategy;
  /** 推荐策略 */
  recommendedStrategy: Exclude<ResizeStrategy, 'auto'> | null;
  /** 预览图Base64 */
  previewUrl: string;
  /** 预览加载状态 */
  previewLoading: boolean;
}

/**
 * 图片改分辨率Modal组件
 */
const ImageResizeModal: React.FC<ImageResizeModalProps> = ({
  visible,
  onCancel,
  onSave,
  images,
  shopId,
}) => {
  const isBatch = images.length > 1;

  // 批量模式：每张图片独立状态
  const [imageStates, setImageStates] = useState<Record<string, ImageState>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [globalResolution, setGlobalResolution] = useState<{ width: number; height: number } | null>(null);
  const [globalStrategy, setGlobalStrategy] = useState<ResizeStrategy>('auto');

  // 预览相关状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  // 初始化图片状态
  useEffect(() => {
    if (visible && images.length > 0) {
      const initialStates: Record<string, ImageState> = {};
      images.forEach((img) => {
        initialStates[img.id] = {
          size: null,
          resolution: null,
          strategy: 'auto',
          recommendedStrategy: null,
          previewUrl: '',
          previewLoading: false,
        };

        // 加载图片尺寸
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          setImageStates((prev) => ({
            ...prev,
            [img.id]: {
              ...prev[img.id],
              size: { width: image.naturalWidth, height: image.naturalHeight },
            },
          }));
        };
        image.onerror = () => {
          notification.error({
            message: '图片加载失败',
            description: `无法加载图片：${img.label || img.id}`,
            placement: 'bottomRight',
          });
        };
        image.src = img.url;
      });
      setImageStates(initialStates);
    }
  }, [visible, images]);

  // 应用全局分辨率到所有图片（单张和批量都适用）
  useEffect(() => {
    if (globalResolution) {
      images.forEach((img) => {
        updateImageResolution(img.id, globalResolution, globalStrategy);
      });
    }
  }, [globalResolution, globalStrategy]);

  // 更新单张图片的分辨率
  const updateImageResolution = async (
    imageId: string,
    resolution: { width: number; height: number },
    strategy: ResizeStrategy
  ) => {
    const state = imageStates[imageId];
    if (!state || !state.size) return;

    // 计算推荐策略
    const recommended = calculateResizeStrategy(
      state.size.width,
      state.size.height,
      resolution.width,
      resolution.height
    );

    // 更新状态
    setImageStates((prev) => ({
      ...prev,
      [imageId]: {
        ...prev[imageId],
        resolution,
        strategy,
        recommendedStrategy: recommended,
        previewLoading: true,
      },
    }));

    // 生成预览
    try {
      const img = images.find((i) => i.id === imageId);
      if (!img) return;

      const result = await resizeImage(img.url, {
        width: resolution.width,
        height: resolution.height,
        strategy,
      });

      setImageStates((prev) => ({
        ...prev,
        [imageId]: {
          ...prev[imageId],
          previewUrl: result.base64,
          previewLoading: false,
        },
      }));
    } catch (error) {
      loggers.product.error('预览生成失败', { imageId, error });
      setImageStates((prev) => ({
        ...prev,
        [imageId]: {
          ...prev[imageId],
          previewLoading: false,
        },
      }));
      notification.error({
        message: '预览生成失败',
        description: error instanceof Error ? error.message : '未知错误',
        placement: 'bottomRight',
      });
    }
  };

  // 处理保存
  const handleSave = async () => {
    // 检查有哪些图片已生成预览
    const readyImages = images.filter((img) => {
      const state = imageStates[img.id];
      return state && state.previewUrl;
    });

    if (readyImages.length === 0) {
      notification.warning({
        message: '请先选择分辨率',
        description: '请为图片选择分辨率并生成预览',
        placement: 'bottomRight',
      });
      return;
    }

    // 如果不是所有图片都准备好，提示用户
    if (readyImages.length < images.length) {
      const notReadyCount = images.length - readyImages.length;
      loggers.product.warn(`有${notReadyCount}张图片未生成预览，将只保存已生成预览的${readyImages.length}张图片`);
    }

    setSaveLoading(true);
    const results: Array<{ id: string; url: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    try {
      // 批量上传
      for (const img of readyImages) {
        const state = imageStates[img.id];

        loggers.product.info('开始上传图片', {
          imageId: img.id,
          hasPreview: !!state.previewUrl,
          previewLength: state.previewUrl?.length
        });

        try {
          const result = await uploadBase64Image(shopId, state.previewUrl);

          loggers.product.info('上传结果', {
            imageId: img.id,
            success: result?.success,
            hasUrl: !!result?.url,
            error: result?.error
          });

          if (result && result.success && result.url) {
            results.push({ id: img.id, url: result.url });
            loggers.product.info('改分辨率保存成功', { imageId: img.id, newUrl: result.url });
          } else {
            errors.push({ id: img.id, error: result?.error || '未知错误' });
            loggers.product.error('改分辨率保存失败', { imageId: img.id, error: result?.error });
          }
        } catch (error) {
          // 捕获任何意外的异常，确保循环继续处理其他图片
          const errorMessage = error instanceof Error ? error.message : '网络错误';
          errors.push({ id: img.id, error: errorMessage });
          loggers.product.error('上传图片异常', { imageId: img.id, error: errorMessage });
        }
      }

      // 显示结果
      if (results.length > 0) {
        notification.success({
          message: '保存成功',
          description: `成功生成 ${results.length} 张新分辨率图片${errors.length > 0 ? `，${errors.length} 张失败` : ''}`,
          placement: 'bottomRight',
          duration: errors.length > 0 ? 6 : 3,
        });

        onSave(results);
        handleClose();
      } else {
        throw new Error('所有图片上传失败');
      }

      // 如果有失败的，显示详细信息
      if (errors.length > 0) {
        loggers.product.error('部分图片上传失败', { errors });
        notification.warning({
          message: `${errors.length} 张图片保存失败`,
          description: errors.map(e => `图片${e?.id || '未知'}: ${e?.error || '未知错误'}`).join('\n'),
          placement: 'bottomRight',
          duration: 8,
        });
      }
    } catch (error) {
      loggers.product.error('改分辨率保存失败', { error });
      notification.error({
        message: '保存失败',
        description: error instanceof Error ? error.message : '未知错误',
        placement: 'bottomRight',
      });
    } finally {
      setSaveLoading(false);
    }
  };

  // 关闭并重置
  const handleClose = () => {
    setImageStates({});
    setGlobalResolution(null);
    setGlobalStrategy('auto');
    onCancel();
  };

  // 打开预览
  const handlePreview = (imageUrl: string, index: number = 0) => {
    setPreviewImages([imageUrl]);
    setPreviewIndex(0);
    setPreviewVisible(true);
  };

  // 检查是否可以保存
  const canSave = () => {
    if (Object.keys(imageStates).length === 0) return false;
    return images.some((img) => {
      const state = imageStates[img.id];
      return state && state.previewUrl && !state.previewLoading;
    });
  };

  // 渲染单张模式
  const renderSingleMode = () => {
    if (images.length === 0) return null;
    const img = images[0];
    const state = imageStates[img.id];
    if (!state) return null;

    return (
      <div style={{ display: 'flex', gap: '24px', minHeight: '60vh' }}>
        {/* 左侧：图片预览 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h4 style={{ margin: 0 }}>原图预览</h4>
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handlePreview(img.url)}
            >
              查看大图
            </Button>
          </div>
          <div
            style={{
              flex: 1,
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#fafafa',
              position: 'relative',
              minHeight: '250px',
              cursor: 'pointer',
            }}
            onClick={() => handlePreview(img.url)}
          >
            <img
              src={img.url}
              alt="原图"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
              }}
            />
          </div>
          {state.size && (
            <div style={{ fontSize: '13px', color: '#666', fontWeight: 500 }}>
              原图尺寸：<span style={{ color: '#1890ff', fontSize: '14px' }}>{state.size.width} × {state.size.height}</span> px
            </div>
          )}

          {state.previewUrl && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <h4 style={{ margin: 0 }}>调整后预览</h4>
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handlePreview(state.previewUrl)}
                >
                  查看大图
                </Button>
              </div>
              <div
                style={{
                  flex: 1,
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#fafafa',
                  position: 'relative',
                  minHeight: '250px',
                  cursor: state.previewLoading ? 'default' : 'pointer',
                }}
                onClick={() => !state.previewLoading && handlePreview(state.previewUrl)}
              >
                {state.previewLoading ? (
                  <Spin tip="生成预览中..." />
                ) : (
                  <img
                    src={state.previewUrl}
                    alt="预览"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                    }}
                  />
                )}
              </div>
              {state.resolution && (
                <div style={{ fontSize: '13px', color: '#666', fontWeight: 500 }}>
                  目标尺寸：<span style={{ color: '#52c41a', fontSize: '14px' }}>{state.resolution.width} × {state.resolution.height}</span> px
                </div>
              )}
            </>
          )}
        </div>

        {/* 右侧：选项 */}
        <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={{ marginBottom: '12px' }}>目标分辨率</h4>
            <Select
              placeholder="请选择分辨率"
              style={{ width: '100%' }}
              value={
                state.resolution ? `${state.resolution.width}x${state.resolution.height}` : undefined
              }
              onChange={(value) => {
                const preset = PRESET_RESOLUTIONS.find((r) => `${r.width}x${r.height}` === value);
                if (preset) {
                  updateImageResolution(img.id, { width: preset.width, height: preset.height }, state.strategy);
                }
              }}
            >
              {PRESET_RESOLUTIONS.map((preset) => (
                <Option key={`${preset.width}x${preset.height}`} value={`${preset.width}x${preset.height}`}>
                  {preset.label}
                </Option>
              ))}
            </Select>
          </div>

          {state.resolution && state.size && state.recommendedStrategy && (
            <>
              <div>
                <h4 style={{ marginBottom: '12px' }}>处理方式</h4>
                <Radio.Group
                  value={state.strategy}
                  onChange={(e) => {
                    const newStrategy = e.target.value as ResizeStrategy;
                    updateImageResolution(img.id, state.resolution!, newStrategy);
                  }}
                >
                  <Space direction="vertical">
                    <Radio value="auto">
                      智能选择（推荐：{STRATEGY_LABELS[state.recommendedStrategy]}）
                    </Radio>
                    <Radio value="crop_horizontal">{STRATEGY_LABELS.crop_horizontal}</Radio>
                    <Radio value="crop_vertical">{STRATEGY_LABELS.crop_vertical}</Radio>
                    <Radio value="pad_horizontal">{STRATEGY_LABELS.pad_horizontal}</Radio>
                    <Radio value="pad_vertical">{STRATEGY_LABELS.pad_vertical}</Radio>
                  </Space>
                </Radio.Group>
              </div>

              <Alert
                message="提示"
                description={
                  state.strategy === 'auto'
                    ? `系统将根据宽高比差异自动选择${STRATEGY_LABELS[state.recommendedStrategy]}。差异小于15%时裁剪，大于15%时填充。`
                    : `已选择：${STRATEGY_LABELS[state.strategy as Exclude<ResizeStrategy, 'auto'>]}`
                }
                type="info"
                showIcon
              />
            </>
          )}
        </div>
      </div>
    );
  };

  // 渲染批量模式
  const renderBatchMode = () => {
    return (
      <div>
        {/* 全局设置 */}
        <div style={{ marginBottom: 16, padding: 16, backgroundColor: '#f5f5f5', borderRadius: 4 }}>
          <h4 style={{ margin: '0 0 12px 0' }}>
            {images.length > 1 ? '批量设置（应用到所有图片）' : '目标设置'}
          </h4>
            <Space size="large">
              <div>
                <span style={{ marginRight: 8 }}>目标分辨率：</span>
                <Select
                  placeholder="请选择分辨率"
                  style={{ width: 200 }}
                  value={
                    globalResolution
                      ? `${globalResolution.width}x${globalResolution.height}`
                      : undefined
                  }
                  onChange={(value) => {
                    const preset = PRESET_RESOLUTIONS.find((r) => `${r.width}x${r.height}` === value);
                    if (preset) {
                      setGlobalResolution({ width: preset.width, height: preset.height });
                    }
                  }}
                >
                  {PRESET_RESOLUTIONS.map((preset) => (
                    <Option
                      key={`${preset.width}x${preset.height}`}
                      value={`${preset.width}x${preset.height}`}
                    >
                      {preset.label}
                    </Option>
                  ))}
                </Select>
              </div>
              <div>
                <span style={{ marginRight: 8 }}>处理方式：</span>
                <Select
                  placeholder="智能选择"
                  style={{ width: 180 }}
                  value={globalStrategy}
                  onChange={(value) => setGlobalStrategy(value as ResizeStrategy)}
                >
                  <Option value="auto">智能选择</Option>
                  <Option value="crop_horizontal">{STRATEGY_LABELS.crop_horizontal}</Option>
                  <Option value="crop_vertical">{STRATEGY_LABELS.crop_vertical}</Option>
                  <Option value="pad_horizontal">{STRATEGY_LABELS.pad_horizontal}</Option>
                  <Option value="pad_vertical">{STRATEGY_LABELS.pad_vertical}</Option>
                </Select>
              </div>
            </Space>
        </div>

        {/* 图片网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
            maxHeight: 600,
            overflowY: 'auto',
          }}
        >
          {images.map((img, index) => {
            const state = imageStates[img.id];
            if (!state) return null;

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
                {/* 图片标题 */}
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <Tag color={index === 0 ? 'green' : 'default'}>
                      {img.label || `图片 ${index + 1}`}
                    </Tag>
                  </div>
                  <Button
                    size="small"
                    type="text"
                    icon={<EyeOutlined />}
                    onClick={() => handlePreview(state.previewUrl || img.url)}
                  />
                </div>

                {/* 原图尺寸 */}
                {state.size && (
                  <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
                    原图：{state.size.width}×{state.size.height}
                  </div>
                )}

                {/* 图片预览 */}
                <div
                  style={{
                    width: '100%',
                    height: 180,
                    border: '1px solid #e8e8e8',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#fafafa',
                    marginBottom: 8,
                    position: 'relative',
                    cursor: 'pointer',
                  }}
                  onClick={() => handlePreview(state.previewUrl || img.url)}
                >
                  {state.previewLoading ? (
                    <Spin size="small" />
                  ) : state.previewUrl ? (
                    <img
                      src={state.previewUrl}
                      alt="预览"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                      }}
                    />
                  ) : (
                    <img
                      src={img.url}
                      alt="原图"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        opacity: 0.6,
                      }}
                    />
                  )}
                </div>

                {/* 状态信息 */}
                {state.resolution && (
                  <div style={{ fontSize: 11, color: '#666' }}>
                    目标：{state.resolution.width}×{state.resolution.height}
                    {state.recommendedStrategy && (
                      <span style={{ marginLeft: 4, color: '#1890ff', fontSize: 10 }}>
                        ({STRATEGY_LABELS[state.recommendedStrategy]})
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <Modal
        title={images.length > 1 ? `改分辨率（${images.length}张图片）` : '改分辨率'}
        open={visible}
        onCancel={handleClose}
        width={1200}
        footer={
          <Space>
            <Button onClick={handleClose}>取消</Button>
            <Button
              type="primary"
              onClick={handleSave}
              loading={saveLoading}
              disabled={!canSave()}
            >
              保存{canSave() && images.length > 1 ? `（${images.filter(img => imageStates[img.id]?.previewUrl).length}张）` : ''}
            </Button>
          </Space>
        }
        destroyOnClose
      >
        {renderBatchMode()}
      </Modal>

      {/* 图片预览组件 */}
      <ImagePreview
        images={previewImages}
        visible={previewVisible}
        initialIndex={previewIndex}
        onClose={() => setPreviewVisible(false)}
      />
    </>
  );
};

export default ImageResizeModal;
