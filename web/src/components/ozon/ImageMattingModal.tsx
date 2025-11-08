/**
 * 象寄智能抠图工具对话框
 * 使用iframe集成象寄智能抠图工具，通过postMessage进行通信
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Spin } from 'antd';

import {
  getMattingToken,
  generateMattingSign,
  MattingResult,
} from '@/services/xiangjifanyiApi';
import { notifySuccess, notifyError, notifyInfo } from '@/utils/notification';

interface ImageMattingModalProps {
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onCancel: () => void;
  /** 需要抠图的图片URL */
  imageUrl: string;
  /** 抠图完成回调 */
  onMattingComplete?: (result: MattingResult) => void;
}

/**
 * 智能抠图对话框组件
 */
const ImageMattingModal: React.FC<ImageMattingModalProps> = ({
  visible,
  onCancel,
  imageUrl,
  onMattingComplete,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [iframeUrl, setIframeUrl] = useState<string>('');

  /**
   * 加载抠图iframe URL
   */
  useEffect(() => {
    if (visible && imageUrl) {
      loadIframeUrl();
    }
  }, [visible, imageUrl]);

  /**
   * 加载iframe URL（获取token和签名）
   */
  const loadIframeUrl = async () => {
    try {
      setLoading(true);

      // 获取token和配置
      const tokenData = await getMattingToken();
      const { token, user_key, aigc_key, img_matting_key } = tokenData;

      // 生成签名
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = await generateMattingSign(timestamp);

      // 构建iframe URL
      const params = new URLSearchParams({
        src: imageUrl,
        token: token,
        aigcKey: aigc_key,
        CommitTime: timestamp.toString(),
        sign: sign,
        disabledQuota: 'true', // 禁用额度确认
      });

      const url = `https://www.xiangjifanyi.com/fusion/tools/iframe-matting?${params.toString()}`;
      setIframeUrl(url);
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      notifyError(
        '加载抠图工具失败',
        error.response?.data?.detail?.detail || error.message || '请检查象寄配置'
      );
      onCancel();
    }
  };

  /**
   * 监听象寄iframe返回的message
   */
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // 验证来源
      if (e.origin !== 'https://www.xiangjifanyi.com') {
        return;
      }

      const { name, res, requestId, all, points } = e.data;

      // XJ_ASK_QUOTA: 询问额度
      if (name === 'XJ_ASK_QUOTA') {
        // 回复：有额度（禁用额度确认）
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            {
              quota: true, // 始终返回有额度
            },
            'https://www.xiangjifanyi.com'
          );
        }
      }

      // XJ_MATTING_DONE: 抠图完成
      else if (name === 'XJ_MATTING_DONE') {
        if (onMattingComplete) {
          onMattingComplete({
            url: res, // 抠图后的图片URL
            requestId: requestId,
            all: all, // 所有图片的映射
          });
        }
        notifySuccess('抠图完成', '图片已成功抠图');
      }

      // XJ_MATTING_CANCEL: 用户取消
      else if (name === 'XJ_MATTING_CANCEL') {
        notifyInfo('已取消', '抠图操作已取消');
        onCancel();
      }

      // XJ_AI_TASK_CREATED: 任务创建完成
      else if (name === 'XJ_AI_TASK_CREATED') {
        // 可选：显示任务开始提示
        console.log('抠图任务已创建，requestId:', requestId);
      }

      // XJ_TASK_BILLING: 任务计费
      else if (name === 'XJ_TASK_BILLING') {
        // 可选：记录消耗积分
        console.log('抠图任务已计费，消耗积分:', e.data.credits);
      }
    };

    // 添加事件监听
    window.addEventListener('message', handleMessage);

    // 清理
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onMattingComplete, onCancel]);

  /**
   * 重置状态
   */
  useEffect(() => {
    if (!visible) {
      setLoading(true);
      setIframeUrl('');
    }
  }, [visible]);

  return (
    <Modal
      title="智能抠图"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width="90vw"
      style={{ top: '5vh' }}
      bodyStyle={{ height: 'calc(90vh - 55px)', padding: 0 }}
      destroyOnClose
    >
      {loading && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
          }}
        >
          <Spin size="large" tip="正在加载象寄抠图工具..." />
        </div>
      )}

      {!loading && iframeUrl && (
        <iframe
          ref={iframeRef}
          title="象寄智能抠图工具"
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      )}
    </Modal>
  );
};

export default ImageMattingModal;
