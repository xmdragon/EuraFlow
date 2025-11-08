import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button, Dropdown, MenuProps, Progress } from 'antd';
import {
  UploadOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { ImageSortableList, ImageItem } from './ImageSortableList';
import { CloudinaryImageGrid } from './CloudinaryImageGrid';
import { uploadMedia } from '@/services/ozonApi';
import { getCloudinaryConfig, uploadRefinedImages } from '@/services/watermarkApi';
import { notifyError, notifySuccess, notifyWarning, notifyInfo } from '@/utils/notification';
import { loggers } from '@/utils/logger';
import TranslationEngineModal from './TranslationEngineModal';
import type { TranslationResult as EngineTranslationResult } from './TranslationEngineModal';
import ImageRefineModal from './ImageRefineModal';
import type { RefineResult } from './ImageRefineModal';
import ImageMattingModal from './ImageMattingModal';
import ImageMattingColorModal from './ImageMattingColorModal';
import ImageWatermarkModal from './watermark/ImageWatermarkModal';
import ImageResizeModal from './ImageResizeModal';
import {
  translateBatchImages,
  getTranslationResult,
  type TranslationResult,
} from '@/services/xiangjifanyiApi';
import styles from './VariantImageManagerModal.module.scss';

const logger = loggers.ozon;

interface VariantImageManagerModalProps {
  visible: boolean;
  variantId: string;
  offerId: string;
  images?: string[];
  shopId: number;
  onOk: (images: string[]) => void;
  onCancel: () => void;
}

export const VariantImageManagerModal: React.FC<VariantImageManagerModalProps> = ({
  visible,
  variantId,
  offerId,
  images: initialImages,
  shopId,
  onOk,
  onCancel,
}) => {
  const [imageItems, setImageItems] = useState<ImageItem[]>(() =>
    (initialImages || []).map((url, index) => ({
      id: `img-${index}-${Date.now()}`,
      url,
    }))
  );
  const [uploading, setUploading] = useState(false);
  const [productFolder, setProductFolder] = useState<string>('products'); // 默认文件夹
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 批量翻译相关状态
  const [translationModalVisible, setTranslationModalVisible] = useState(false);
  const [batchTranslating, setBatchTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationRequestId, setTranslationRequestId] = useState<string | null>(null);

  // 精修相关状态
  const [refineModalVisible, setRefineModalVisible] = useState(false);
  const [refineRequestIds, setRefineRequestIds] = useState<string[]>([]);

  // 水印相关状态
  const [watermarkModalVisible, setWatermarkModalVisible] = useState(false);

  // 改分辨率相关状态
  const [resizeModalVisible, setResizeModalVisible] = useState(false);
  const [resizeImageUrl, setResizeImageUrl] = useState<string>('');
  const [resizeImageId, setResizeImageId] = useState<string>('');

  // 抠图相关状态（颜色选择对话框）
  const [mattingColorModalVisible, setMattingColorModalVisible] = useState(false);
  const [mattingColorImageUrl, setMattingColorImageUrl] = useState<string>('');
  const [mattingColorImageId, setMattingColorImageId] = useState<string>('');

  // 抠图精修相关状态（iframe精修）
  const [mattingRefineModalVisible, setMattingRefineModalVisible] = useState(false);
  const [mattingRefineImageUrl, setMattingRefineImageUrl] = useState<string>('');
  const [mattingRefineImageId, setMattingRefineImageId] = useState<string>('');
  const [mattingRefineRequestId, setMattingRefineRequestId] = useState<string | undefined>();

  // 加载 Cloudinary 配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getCloudinaryConfig();
        if (config.product_images_folder) {
          setProductFolder(config.product_images_folder);
        }
      } catch (error) {
        // 使用默认值 'products'
      }
    };
    loadConfig();
  }, []);

  // 同步 props 变化
  React.useEffect(() => {
    if (visible) {
      setImageItems(
        (initialImages || []).map((url, index) => ({
          id: `img-${index}-${Date.now()}`,
          url,
        }))
      );
    }
  }, [visible, initialImages]);

  const handleOk = () => {
    const urls = imageItems.map((item) => item.url);
    onOk(urls);
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleImageChange = (newImages: ImageItem[]) => {
    setImageItems(newImages);
  };

  const handleCloudinarySelect = (urls: string[]) => {
    // 检查是否超过30张限制
    const remainingSlots = 30 - imageItems.length;
    if (remainingSlots <= 0) {
      notifyError('超出限制', '最多只能上传30张图片');
      return;
    }

    // 过滤掉已存在的图片
    const existingUrls = new Set(imageItems.map(item => item.url));
    const newUrls = urls.filter(url => !existingUrls.has(url));

    if (newUrls.length === 0) {
      return;
    }

    // 限制添加的数量
    const urlsToAdd = newUrls.slice(0, remainingSlots);

    const newItems: ImageItem[] = urlsToAdd.map((url) => ({
      id: `img-${Date.now()}-${Math.random()}`,
      url,
    }));
    setImageItems([...imageItems, ...newItems]);

    if (newUrls.length > remainingSlots) {
      notifyError('超出限制', `只添加了 ${remainingSlots} 张图片，剩余图片已忽略`);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 检查是否超过30张限制
    const remainingSlots = 30 - imageItems.length;
    if (remainingSlots <= 0) {
      notifyError('超出限制', '最多只能上传30张图片');
      return;
    }

    setUploading(true);
    const uploadedUrls: string[] = [];

    try {
      // 限制上传数量
      const filesToUpload = Array.from(files).slice(0, remainingSlots);

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];

        // 读取为 Base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result) {
              const base64String = (reader.result as string).split(',')[1];
              resolve(base64String);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // 上传到 Cloudinary
        const result = await uploadMedia({
          shop_id: shopId,
          type: 'base64',
          data: base64,
          folder: productFolder,
        });

        if (result?.url) {
          uploadedUrls.push(result.url);
        }
      }

      // 添加到图片列表
      const newItems: ImageItem[] = uploadedUrls.map((url) => ({
        id: `img-${Date.now()}-${Math.random()}`,
        url,
      }));
      setImageItems([...imageItems, ...newItems]);

      if (files.length > remainingSlots) {
        notifyError('超出限制', `只上传了 ${remainingSlots} 张图片，剩余图片已忽略`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      notifyError('上传失败', errorMsg);
    } finally {
      setUploading(false);
      // 重置 input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownload = () => {
    if (imageItems.length === 0) {
      return;
    }

    imageItems.forEach((item, index) => {
      const link = document.createElement('a');
      link.href = item.url;
      link.download = `${offerId}_${index + 1}.jpg`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  /**
   * 打开水印应用对话框
   */
  const handleWatermark = () => {
    if (imageItems.length === 0) {
      notification.warning({
        message: '无可用图片',
        description: '请先添加图片后再应用水印',
        placement: 'bottomRight',
      });
      return;
    }

    setWatermarkModalVisible(true);
  };

  /**
   * 处理水印应用结果
   */
  const handleWatermarkApply = (results: Array<{ id: string; url: string }>) => {
    logger.info('应用水印结果', { count: results.length });

    // 创建 ID 到新 URL 的映射
    const urlMap = new Map(results.map((r) => [r.id, r.url]));

    // 更新 imageItems 中的 URL
    const updatedItems = imageItems.map((item) => {
      const newUrl = urlMap.get(item.id);
      return newUrl ? { ...item, url: newUrl } : item;
    });

    setImageItems(updatedItems);
    setWatermarkModalVisible(false);

    notification.success({
      message: '水印应用成功',
      description: `成功应用水印到 ${results.length} 张图片`,
      placement: 'bottomRight',
    });
  };

  /**
   * 打开单张改分辨率对话框
   */
  const handleResize = (imageId: string, imageUrl: string) => {
    logger.info('打开单张改分辨率对话框', { imageId, imageUrl });
    setResizeImageId(imageId);
    setResizeImageUrl(imageUrl);
    setResizeModalVisible(true);
  };

  /**
   * 打开批量改分辨率对话框
   */
  const handleBatchResize = () => {
    if (imageItems.length === 0) {
      notification.warning({
        message: '无可用图片',
        description: '请先添加图片后再改分辨率',
        placement: 'bottomRight',
      });
      return;
    }

    logger.info('打开批量改分辨率对话框', { count: imageItems.length });
    // 批量模式不需要设置单个图片ID
    setResizeImageId('');
    setResizeImageUrl('');
    setResizeModalVisible(true);
  };

  /**
   * 处理改分辨率保存结果（支持单张和批量）
   */
  const handleResizeSave = (results: Array<{ id: string; url: string }>) => {
    logger.info('改分辨率保存成功', { count: results.length });

    // 替换原图：将原图的URL替换为新的URL
    const newItems = imageItems.map((item) => {
      const result = results.find((r) => r.id === item.id);
      if (result) {
        return {
          ...item,
          url: result.url,
        };
      }
      return item;
    });

    setImageItems(newItems);

    // 通知已由ImageResizeModal处理，这里不再重复通知
  };

  /**
   * 打开颜色选择对话框（图片白底）
   */
  const handleMatting = (imageId: string, imageUrl: string) => {
    logger.info('打开颜色选择对话框', { imageId, imageUrl });
    setMattingColorImageId(imageId);
    setMattingColorImageUrl(imageUrl);
    setMattingColorModalVisible(true);
  };

  /**
   * 处理抠图完成（从颜色选择对话框返回）
   */
  const handleMattingColorComplete = async (imageId: string, mattedUrl: string, requestId: string) => {
    logger.info('抠图完成', { imageId, mattedUrl, requestId });

    try {
      // 上传抠图后的图片到图床
      const uploadResult = await uploadRefinedImages(shopId, [
        {
          xiangji_url: mattedUrl,
          request_id: requestId,
        },
      ]);

      if (uploadResult.success && uploadResult.results.length > 0) {
        const storageUrl = uploadResult.results[0].storage_url;

        // 更新图片列表，保存mattingRequestId
        const newItems = imageItems.map((item) => {
          if (item.id === imageId) {
            return {
              ...item,
              url: storageUrl,
              mattingRequestId: requestId, // 保存requestId用于精修
            };
          }
          return item;
        });

        setImageItems(newItems);

        notifySuccess('抠图成功', '图片已成功抠图并上传到图床');
      } else {
        // 上传失败，保留象寄URL
        const newItems = imageItems.map((item) => {
          if (item.id === imageId) {
            return {
              ...item,
              url: mattedUrl, // 使用象寄服务器的URL
              mattingRequestId: requestId,
            };
          }
          return item;
        });

        setImageItems(newItems);

        notifyWarning('抠图成功，上传图床失败', '图片将使用象寄服务器的链接');
      }
    } catch (error: any) {
      logger.error('上传抠图图片失败', { error });
      // 上传失败也要更新URL（使用象寄服务器的URL）
      const newItems = imageItems.map((item) => {
        if (item.id === imageId) {
          return {
            ...item,
            url: mattedUrl,
            mattingRequestId: requestId,
          };
        }
        return item;
      });

      setImageItems(newItems);

      notifyError('上传图床失败', error.message || '图片将使用象寄服务器的链接');
    }
  };

  /**
   * 打开抠图精修对话框（iframe）
   */
  const handleMattingRefine = (imageId: string, imageUrl: string, mattingRequestId?: string) => {
    logger.info('打开抠图精修对话框', { imageId, imageUrl, mattingRequestId });
    setMattingRefineImageId(imageId);
    setMattingRefineImageUrl(imageUrl);
    setMattingRefineRequestId(mattingRequestId);
    setMattingRefineModalVisible(true);
  };

  /**
   * 处理抠图精修完成（从iframe返回）
   */
  const handleMattingRefineComplete = async (result: { url: string; requestId?: string }) => {
    logger.info('抠图精修完成', { url: result.url, requestId: result.requestId });

    try {
      // 上传精修后的图片到图床
      const uploadResult = await uploadRefinedImages(shopId, [
        {
          xiangji_url: result.url,
          request_id: result.requestId || mattingRefineImageId,
        },
      ]);

      if (uploadResult.success && uploadResult.results.length > 0) {
        const storageUrl = uploadResult.results[0].storage_url;

        // 更新图片列表
        const newItems = imageItems.map((item) => {
          if (item.id === mattingRefineImageId) {
            return {
              ...item,
              url: storageUrl,
              mattingRequestId: result.requestId || item.mattingRequestId, // 更新或保留requestId
            };
          }
          return item;
        });

        setImageItems(newItems);

        notifySuccess('抠图精修成功', '图片已成功精修并上传到图床');
      } else {
        // 上传失败，保留象寄URL
        const newItems = imageItems.map((item) => {
          if (item.id === mattingRefineImageId) {
            return {
              ...item,
              url: result.url,
              mattingRequestId: result.requestId || item.mattingRequestId,
            };
          }
          return item;
        });

        setImageItems(newItems);

        notifyWarning('抠图精修成功，上传图床失败', '图片将使用象寄服务器的链接');
      }
    } catch (error: any) {
      logger.error('上传精修图片失败', { error });
      // 上传失败也要更新URL（使用象寄服务器的URL）
      const newItems = imageItems.map((item) => {
        if (item.id === mattingRefineImageId) {
          return {
            ...item,
            url: result.url,
            mattingRequestId: result.requestId || item.mattingRequestId,
          };
        }
        return item;
      });

      setImageItems(newItems);

      notifyError('上传图床失败', error.message || '图片将使用象寄服务器的链接');
    }

    // 关闭精修对话框
    setMattingRefineModalVisible(false);
  };

  /**
   * 启动批量翻译
   */
  const handleBatchTranslate = () => {
    if (imageItems.length === 0) {
      notifyError('无图片', '请先添加图片');
      return;
    }
    setTranslationModalVisible(true);
  };

  /**
   * 执行批量翻译（提交请求后立即返回，轮询在后台进行）
   */
  const handleTranslationExecute = async (engineType: number): Promise<EngineTranslationResult> => {
    if (imageItems.length === 0) {
      return { success: false, error: '无图片' };
    }

    try {
      // 提交批量翻译请求
      const imageUrls = imageItems.map((item) => item.url);
      const batchResult = await translateBatchImages(imageUrls, engineType);

      if (!batchResult.request_id) {
        throw new Error('批量翻译请求失败');
      }

      const requestId = batchResult.request_id;

      notification.info({
        message: '翻译任务已提交',
        description: `正在翻译 ${batchResult.total} 张图片，请稍候...`,
        placement: 'bottomRight',
        duration: 3,
      });

      // 立即返回成功，关闭引擎选择弹窗
      // 然后在后台开始轮询
      startPollingTranslation(requestId);

      return { success: true, requestId };
    } catch (error: any) {
      notification.error({
        message: '批量翻译失败',
        description: error.message || '网络错误',
        placement: 'bottomRight',
      });
      return { success: false, error: error.message };
    }
  };

  /**
   * 开始轮询翻译结果（后台执行）
   */
  const startPollingTranslation = async (requestId: string) => {
    setBatchTranslating(true);
    setTranslationProgress(0);
    setTranslationRequestId(requestId);

    try {
      // 最多60次，每2秒一次，总共2分钟
      const maxRetries = 60;
      const interval = 2000; // 2秒

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, interval));

        const resultData = await getTranslationResult(requestId);

        // 更新进度（估算）
        const progress = Math.min(95, Math.floor(((attempt + 1) / maxRetries) * 100));
        setTranslationProgress(progress);

        if (resultData.completed) {
          setTranslationProgress(100);

          // 处理翻译结果
          handleBatchTranslationResults(resultData.results || []);

          notification.success({
            message: '批量翻译完成',
            description: `成功翻译 ${resultData.results?.filter((r) => r.success).length} 张图片`,
            placement: 'bottomRight',
          });

          return;
        }
      }

      // 超时
      notification.warning({
        message: '翻译超时',
        description: '翻译任务处理时间较长，请稍后手动刷新查看结果',
        placement: 'bottomRight',
      });
    } catch (error: any) {
      notification.error({
        message: '轮询翻译结果失败',
        description: error.message || '网络错误',
        placement: 'bottomRight',
      });
    } finally {
      setBatchTranslating(false);
      setTranslationProgress(0);
      setTranslationRequestId(null);
    }
  };

  /**
   * 处理批量翻译结果
   */
  const handleBatchTranslationResults = async (results: TranslationResult[]) => {
    if (results.length === 0) return;

    // 创建URL到翻译结果的映射
    const urlToResult = new Map<string, TranslationResult>();
    results.forEach((result) => {
      urlToResult.set(result.url, result);
    });

    // 1. 先立即更新UI显示象寄的URL（快速反馈）
    const tempImageItems = imageItems.map((item) => {
      const result = urlToResult.get(item.url);
      if (result && result.success && result.translated_url) {
        return {
          ...item,
          url: result.translated_url,
          translationRequestId: result.request_id,
        };
      }
      return item;
    });

    setImageItems(tempImageItems);

    // 收集所有已翻译图片的requestId（用于批量精修）
    const requestIds = results
      .filter((r) => r.success && r.request_id)
      .map((r) => r.request_id!);

    if (requestIds.length > 0) {
      setRefineRequestIds(requestIds);
    }

    // 统计成功和失败数量
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    // 2. 异步上传到我们的图床
    if (successCount > 0) {
      try {
        const imagesToUpload = results
          .filter((r) => r.success && r.translated_url && r.request_id)
          .map((r) => ({
            xiangji_url: r.translated_url!,
            request_id: r.request_id!,
          }));

        if (imagesToUpload.length === 0) return;

        logger.info('开始异步上传翻译图片到图床', { count: imagesToUpload.length });

        const uploadResult = await uploadRefinedImages(shopId, imagesToUpload);

        // 3. 更新UI显示我们图床的URL
        if (uploadResult.success && uploadResult.results.length > 0) {
          const requestIdToStorageUrl = new Map<string, string>();
          uploadResult.results.forEach((result) => {
            if (result.success && result.storage_url) {
              requestIdToStorageUrl.set(result.request_id, result.storage_url);
            }
          });

          const finalImageItems = tempImageItems.map((item) => {
            if (item.translationRequestId) {
              const storageUrl = requestIdToStorageUrl.get(item.translationRequestId);
              if (storageUrl) {
                return { ...item, url: storageUrl };
              }
            }
            return item;
          });

          setImageItems(finalImageItems);

          if (uploadResult.success_count > 0) {
            notification.success({
              message: '图片已保存到图床',
              description: `成功上传 ${uploadResult.success_count} 张图片${uploadResult.fail_count > 0 ? `，${uploadResult.fail_count} 张失败` : ''}`,
              placement: 'bottomRight',
            });
          }
        }
      } catch (error: any) {
        logger.error('异步上传翻译图片失败', error);
        notification.warning({
          message: '图片上传失败',
          description: '图片将保留象寄服务器的链接',
          placement: 'bottomRight',
        });
      }
    }
  };

  /**
   * 批量精修
   */
  const handleBatchRefine = () => {
    if (refineRequestIds.length === 0) {
      notifyError('无可精修图片', '请先翻译图片');
      return;
    }
    setRefineModalVisible(true);
  };

  /**
   * 精修完成回调（异步上传到我们的图床）
   */
  const handleRefineComplete = async (result: RefineResult) => {
    // 1. 先立即更新UI显示象寄的URL（快速反馈）
    const requestIdToXiangjiUrl = new Map<string, string>();
    Object.entries(result.all).forEach(([requestId, url]) => {
      requestIdToXiangjiUrl.set(requestId, url);
    });

    const tempImageItems = imageItems.map((item) => {
      if (item.translationRequestId) {
        const refinedUrl = requestIdToXiangjiUrl.get(item.translationRequestId);
        if (refinedUrl) {
          return { ...item, url: refinedUrl };
        }
      }
      return item;
    });

    setImageItems(tempImageItems);

    notification.success({
      message: '批量精修完成',
      description: '图片已更新，正在上传到图床...',
      placement: 'bottomRight',
    });

    // 2. 异步上传到我们的图床
    try {
      const imagesToUpload = Object.entries(result.all).map(([requestId, xiangjiUrl]) => ({
        xiangji_url: xiangjiUrl,
        request_id: requestId,
      }));

      const uploadResult = await uploadRefinedImages(shopId, imagesToUpload);

      // 3. 更新UI显示我们图床的URL
      if (uploadResult.success && uploadResult.results.length > 0) {
        const requestIdToStorageUrl = new Map<string, string>();
        uploadResult.results.forEach((result) => {
          if (result.success && result.storage_url) {
            requestIdToStorageUrl.set(result.request_id, result.storage_url);
          }
        });

        const finalImageItems = imageItems.map((item) => {
          if (item.translationRequestId) {
            const storageUrl = requestIdToStorageUrl.get(item.translationRequestId);
            if (storageUrl) {
              return { ...item, url: storageUrl };
            }
            // 如果上传失败，保持象寄的URL
            const xiangjiUrl = requestIdToXiangjiUrl.get(item.translationRequestId);
            if (xiangjiUrl) {
              return { ...item, url: xiangjiUrl };
            }
          }
          return item;
        });

        setImageItems(finalImageItems);

        if (uploadResult.success_count > 0) {
          notification.success({
            message: '图片已保存到图床',
            description: `成功上传 ${uploadResult.success_count} 张图片${uploadResult.fail_count > 0 ? `，${uploadResult.fail_count} 张失败` : ''}`,
            placement: 'bottomRight',
          });
        } else {
          notification.warning({
            message: '图片上传失败',
            description: '图片将保留象寄服务器的链接',
            placement: 'bottomRight',
          });
        }
      }
    } catch (error: any) {
      notification.error({
        message: '图片上传失败',
        description: error.message || '图片将保留象寄服务器的链接',
        placement: 'bottomRight',
      });
    }
  };

  const processMenuItems: MenuProps['items'] = [
    {
      key: 'translate',
      label: '图片翻译',
      onClick: handleBatchTranslate,
      disabled: imageItems.length === 0,
    },
    {
      key: 'refine',
      label: '图片精修',
      onClick: handleBatchRefine,
      disabled: refineRequestIds.length === 0,
    },
    {
      key: 'resize',
      label: '改分辨率',
      onClick: handleBatchResize,
      disabled: imageItems.length === 0,
    },
    {
      key: 'whitebg',
      label: '图片白底',
      onClick: () => {
        // 象寄智能抠图为单张处理，不支持批量
        notifyInfo(
          '智能抠图提示',
          '象寄智能抠图为单张处理，批量操作会较耗时。建议单张处理（点击图片下方的抠图按钮）'
        );
      },
      disabled: imageItems.length === 0,
    },
    {
      key: 'watermark',
      label: '图片水印',
      onClick: handleWatermark,
      disabled: imageItems.length === 0,
    },
    {
      key: 'download',
      label: '图片下载',
      onClick: handleDownload,
      disabled: imageItems.length === 0,
    },
  ];

  return (
    <Modal
      title={`变体图片编辑（货号：${offerId}）`}
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      width={1200}
      centered
      okText="保存"
      cancelText="取消"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className={styles.toolbar}>
        <Button
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          loading={uploading}
        >
          本地图片
        </Button>

        <Dropdown menu={{ items: processMenuItems }} trigger={['hover']}>
          <Button icon={<ToolOutlined />}>
            图片处理
          </Button>
        </Dropdown>
      </div>

      <div className={styles.content}>
        <div className={styles.leftPanel}>
          <div className={styles.panelTitle}>
            该区域为SKU图片，拖动可调整图片顺序。第一张默认为主图（最多可传30张，已有 {imageItems.length} 张）
          </div>

          {/* 批量翻译进度条 */}
          {batchTranslating && (
            <div style={{ marginBottom: 16 }}>
              <Progress
                percent={translationProgress}
                status="active"
                strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
              />
              <div style={{ textAlign: 'center', marginTop: 8, color: '#8c8c8c' }}>
                正在批量翻译图片，请稍候...（{translationProgress}%）
              </div>
            </div>
          )}

          <ImageSortableList
            images={imageItems}
            onChange={handleImageChange}
            shopId={shopId}
            onResize={handleResize}
            onMatting={handleMatting}
            onMattingRefine={handleMattingRefine}
          />
        </div>

        <div className={styles.rightPanel}>
          <div className={styles.panelTitle}>空间图片</div>
          <CloudinaryImageGrid onSelect={handleCloudinarySelect} folder={productFolder} />
        </div>
      </div>

      {/* 翻译引擎选择对话框 */}
      <TranslationEngineModal
        visible={translationModalVisible}
        onCancel={() => setTranslationModalVisible(false)}
        onTranslate={handleTranslationExecute}
        title="选择批量翻译引擎"
        isBatch={true}
      />

      {/* 批量精修对话框 */}
      {refineRequestIds.length > 0 && (
        <ImageRefineModal
          visible={refineModalVisible}
          onCancel={() => setRefineModalVisible(false)}
          requestIds={refineRequestIds}
          onRefineComplete={handleRefineComplete}
          lang="CHS"
        />
      )}

      {/* 水印应用对话框 */}
      <ImageWatermarkModal
        visible={watermarkModalVisible}
        onCancel={() => setWatermarkModalVisible(false)}
        onApply={handleWatermarkApply}
        images={imageItems.map((item) => ({
          id: item.id,
          url: item.url,
          label: `图片 ${imageItems.indexOf(item) + 1}`,
        }))}
        shopId={shopId}
      />

      {/* 改分辨率对话框 */}
      <ImageResizeModal
        visible={resizeModalVisible}
        onCancel={() => setResizeModalVisible(false)}
        onSave={handleResizeSave}
        images={
          resizeImageId
            ? // 单张模式：只传递当前图片
              imageItems
                .filter((item) => item.id === resizeImageId)
                .map((item, index) => ({
                  id: item.id,
                  url: item.url,
                  label: `图片 ${imageItems.indexOf(item) + 1}`,
                }))
            : // 批量模式：传递所有图片
              imageItems.map((item, index) => ({
                id: item.id,
                url: item.url,
                label: `图片 ${index + 1}`,
              }))
        }
        shopId={shopId}
      />

      {/* 智能抠图颜色选择对话框（图片白底） */}
      <ImageMattingColorModal
        visible={mattingColorModalVisible}
        onCancel={() => setMattingColorModalVisible(false)}
        imageUrl={mattingColorImageUrl}
        imageId={mattingColorImageId}
        onMattingComplete={handleMattingColorComplete}
      />

      {/* 智能抠图精修对话框（iframe） */}
      <ImageMattingModal
        visible={mattingRefineModalVisible}
        onCancel={() => setMattingRefineModalVisible(false)}
        imageUrl={mattingRefineImageUrl}
        onMattingComplete={handleMattingRefineComplete}
      />
    </Modal>
  );
};
