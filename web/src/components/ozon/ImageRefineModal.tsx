/**
 * 象寄图片精修工具对话框
 * 使用iframe集成象寄精修工具，通过postMessage传递requestId
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';

/**
 * 精修结果
 */
export interface RefineResult {
  /** 当前图片的requestId */
  requestId: string;
  /** 当前图片的精修URL */
  url: string;
  /** 所有图片的requestId与精修URL映射 */
  all: Record<string, string>;
}

interface ImageRefineModalProps {
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onCancel: () => void;
  /** 需要精修的图片requestId列表（翻译API返回的RequestId） */
  requestIds: string[];
  /** 精修完成回调 */
  onRefineComplete?: (result: RefineResult) => void;
  /** 精修工具界面语言（默认俄语） */
  lang?: 'CHS' | 'CHT' | 'EN' | 'JPN' | 'KOR' | 'ESP' | 'PTB' | 'RUS' | 'VIN';
}

/**
 * 图片精修工具对话框组件
 */
const ImageRefineModal: React.FC<ImageRefineModalProps> = ({
  visible,
  onCancel,
  requestIds,
  onRefineComplete,
  lang = 'CHS',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  /**
   * iframe加载完成事件
   */
  const handleIframeLoad = () => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) {
      return;
    }

    try {
      // 向iframe发送需要精修的图片requestId数组
      const message = {
        name: 'XJ_IMAGE_EDITOR_REQUESTIDS',
        requestIds: requestIds,
      };

      iframeRef.current.contentWindow.postMessage(
        message,
        'https://www.xiangjifanyi.com'
      );

      setIframeLoaded(true);
    } catch (error) {
      // 忽略错误
    }
  };

  /**
   * 监听精修工具返回的message
   */
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // 验证来源
      if (e.origin !== 'https://www.xiangjifanyi.com') {
        return;
      }

      const { name, url, requestId, all } = e.data;

      // 检查是否是精修结果消息
      if (name === 'XJ_IMAGE_EDITOR_URL') {
        // 调用回调函数
        if (onRefineComplete) {
          onRefineComplete({
            requestId,
            url,
            all,
          });
        }
      }
      // 忽略其他消息类型（如 XJ_CHANGE_LOCALE 等象寄内部消息）
    };

    // 添加事件监听
    window.addEventListener('message', handleMessage);

    // 清理
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onRefineComplete]);

  /**
   * 重置iframe加载状态
   */
  useEffect(() => {
    if (!visible) {
      setIframeLoaded(false);
    }
  }, [visible]);

  /**
   * 精修工具URL（带语言参数）
   * 默认使用简体中文界面
   */
  const editorUrl = `https://www.xiangjifanyi.com/image-editor/#/?lang=${lang}`;

  return (
    <Modal
      title="图片精修"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width="90vw"
      style={{ top: '5vh' }}
      bodyStyle={{ height: 'calc(90vh - 55px)', padding: 0 }}
      destroyOnClose
    >
      <iframe
        ref={iframeRef}
        title="象寄图片精修工具"
        src={editorUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
        }}
        onLoad={handleIframeLoad}
      />
      {!iframeLoaded && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 16,
            color: '#8c8c8c',
          }}
        >
          正在加载精修工具...
        </div>
      )}
    </Modal>
  );
};

export default ImageRefineModal;
