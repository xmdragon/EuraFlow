/**
 * 图片翻译引擎选择对话框
 */
import React, { useState } from 'react';
import { Modal, Radio, Space, Alert } from 'antd';
import type { RadioChangeEvent } from 'antd';

/**
 * 翻译引擎类型
 */
export enum TranslationEngine {
  /** 阿里云（默认） */
  ALIBABA = 'alibaba',
  /** ChatGPT */
  CHATGPT = 'chatgpt',
}

/**
 * 翻译结果（包含requestId用于精修）
 */
export interface TranslationResult {
  success: boolean;
  requestId?: string;
  translatedUrl?: string;
  error?: string;
}

interface TranslationEngineModalProps {
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onCancel: () => void;
  /** 翻译回调（返回requestId用于后续精修） */
  onTranslate: (engineType: number) => Promise<TranslationResult>;
  /** 标题 */
  title?: string;
  /** 是否批量翻译 */
  isBatch?: boolean;
}

/**
 * 翻译引擎选择对话框组件
 */
const TranslationEngineModal: React.FC<TranslationEngineModalProps> = ({
  visible,
  onCancel,
  onTranslate,
  title = '选择翻译引擎',
  isBatch = false,
}) => {
  const [engine, setEngine] = useState<TranslationEngine>(TranslationEngine.ALIBABA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 引擎类型转换为API参数
   */
  const getEngineType = (engine: TranslationEngine): number => {
    switch (engine) {
      case TranslationEngine.ALIBABA:
        return 1; // 阿里云
      case TranslationEngine.CHATGPT:
        return 5; // ChatGPT
      default:
        return 1; // 默认阿里云
    }
  };

  /**
   * 引擎选择变化
   */
  const handleEngineChange = (e: RadioChangeEvent) => {
    setEngine(e.target.value);
    setError(null);
  };

  /**
   * 确认翻译
   */
  const handleOk = async () => {
    try {
      setLoading(true);
      setError(null);

      const engineType = getEngineType(engine);
      const result = await onTranslate(engineType);

      // 检查返回值是否有效
      if (!result) {
        setError('翻译请求失败：未返回结果');
        return;
      }

      if (result.success) {
        // 翻译成功，关闭对话框（父组件会处理后续精修逻辑）
        onCancel();
      } else {
        setError(result.error || '翻译失败');
      }
    } catch (err: any) {
      setError(err.message || '翻译请求失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 取消对话框
   */
  const handleCancel = () => {
    if (!loading) {
      setError(null);
      onCancel();
    }
  };

  return (
    <Modal
      title={title}
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText="开始翻译"
      cancelText="取消"
      width={480}
      maskClosable={!loading}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <div style={{ marginBottom: 12, fontWeight: 500 }}>
            请选择翻译引擎：
          </div>
          <Radio.Group value={engine} onChange={handleEngineChange}>
            <Space direction="vertical">
              <Radio value={TranslationEngine.ALIBABA}>
                阿里云翻译（默认）
                <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 8 }}>
                  速度快，适合批量翻译
                </span>
              </Radio>
              <Radio value={TranslationEngine.CHATGPT}>
                ChatGPT 翻译
                <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 8 }}>
                  质量高，但速度较慢
                </span>
              </Radio>
            </Space>
          </Radio.Group>
        </div>

        {isBatch && (
          <Alert
            message="批量翻译提示"
            description="批量翻译采用异步模式，翻译完成后会自动刷新图片。翻译过程可能需要几分钟，请耐心等待。"
            type="info"
            showIcon
          />
        )}

        {error && (
          <Alert
            message="翻译失败"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
          />
        )}
      </Space>
    </Modal>
  );
};

export default TranslationEngineModal;
