/**
 * 智能抠图颜色选择对话框
 * 用于选择抠图后的背景颜色，然后调用API进行抠图
 */
import React, { useState } from 'react';
import { Modal, Button, ColorPicker, Space, Spin } from 'antd';
import type { Color } from 'antd/es/color-picker';
import { notifySuccess, notifyError } from '@/utils/notification';
import { mattingSingleImage } from '@/services/xiangjifanyiApi';

interface ImageMattingColorModalProps {
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onCancel: () => void;
  /** 需要抠图的图片URL */
  imageUrl: string;
  /** 图片ID */
  imageId: string;
  /** 抠图完成回调 */
  onMattingComplete?: (imageId: string, mattedUrl: string, requestId: string) => void;
}

/**
 * 将Ant Design Color对象转换为RGB字符串
 */
const colorToRgbString = (color: Color): string => {
  const rgb = color.toRgb();
  return `${rgb.r},${rgb.g},${rgb.b}`;
};

/**
 * 智能抠图颜色选择对话框组件
 */
const ImageMattingColorModal: React.FC<ImageMattingColorModalProps> = ({
  visible,
  onCancel,
  imageUrl,
  imageId,
  onMattingComplete,
}) => {
  const [bgColor, setBgColor] = useState<Color | string>('#FFFFFF'); // 默认白色
  const [loading, setLoading] = useState(false);

  /**
   * 处理抠图
   */
  const handleMatting = async () => {
    try {
      setLoading(true);

      // 转换颜色为RGB字符串
      let rgbString = '255,255,255'; // 默认白色
      if (typeof bgColor === 'string') {
        // 如果是hex字符串，转换为RGB
        const hex = bgColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        rgbString = `${r},${g},${b}`;
      } else {
        // Color对象
        rgbString = colorToRgbString(bgColor);
      }

      // 调用API
      const result = await mattingSingleImage(imageUrl, rgbString);

      if (result.success && result.url) {
        if (onMattingComplete && result.request_id) {
          onMattingComplete(imageId, result.url, result.request_id);
        }
        notifySuccess('抠图成功', '图片已成功抠图');
        onCancel();
      } else {
        notifyError('抠图失败', result.error || '未知错误');
      }
    } catch (error: any) {
      notifyError('抠图失败', error.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 预设颜色
   */
  const presetColors = [
    { label: '白色', color: '#FFFFFF' },
    { label: '透明', color: '#00000000' },
    { label: '浅灰', color: '#F5F5F5' },
    { label: '黑色', color: '#000000' },
  ];

  return (
    <Modal
      title="选择背景颜色"
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={loading}>
          取消
        </Button>,
        <Button key="ok" type="primary" onClick={handleMatting} loading={loading}>
          开始抠图
        </Button>,
      ]}
      width={400}
      destroyOnClose
    >
      <Spin spinning={loading} tip="正在抠图，请稍候...">
        <div style={{ padding: '20px 0' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* 第一行：选择背景颜色 + 颜色选择器 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>选择背景颜色：</div>
              <ColorPicker
                value={bgColor}
                onChange={setBgColor}
                showText
                size="large"
              />
            </div>

            {/* 第二行：常用颜色 + 按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>常用颜色：</div>
              <Space wrap>
                {presetColors.map((preset) => (
                  <Button
                    key={preset.label}
                    size="small"
                    style={{
                      backgroundColor: preset.color === '#00000000' ? 'transparent' : preset.color,
                      border: preset.color === '#FFFFFF' ? '1px solid #d9d9d9' : 'none',
                      color: preset.color === '#000000' ? '#fff' : '#000',
                    }}
                    onClick={() => setBgColor(preset.color)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Space>
            </div>

            {/* 第三行：预览图片 */}
            <div>
              <div style={{ marginBottom: 10, fontWeight: 500 }}>原图预览：</div>
              <div
                style={{
                  width: '100%',
                  height: 200,
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src={imageUrl}
                  alt="预览"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              </div>
            </div>
          </Space>
        </div>
      </Spin>
    </Modal>
  );
};

export default ImageMattingColorModal;
