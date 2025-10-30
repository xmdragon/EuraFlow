/**
 * 批量打印Hook
 * 封装批量打印标签的核心逻辑和错误处理
 */
import { useState } from 'react';
import * as ozonApi from '@/services/ozonApi';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import type { FailedPosting } from '@/components/ozon/packing/PrintErrorModal';

interface BatchPrintResult {
  success: boolean;
  pdf_url?: string;
  total?: number;
  cached_count?: number;
  fetched_count?: number;
  error?: string;
  failed_postings?: FailedPosting[];
  success_postings?: string[];
}

interface UseBatchPrintOptions {
  maxPostings?: number;
  onSuccess?: (result: BatchPrintResult, postingNumbers: string[]) => void;
  onPartialSuccess?: (result: BatchPrintResult) => void;
  onError?: (error: any) => void;
}

interface UseBatchPrintReturn {
  isPrinting: boolean;
  printErrors: FailedPosting[];
  printSuccessPostings: string[];
  printErrorModalVisible: boolean;
  batchPrint: (postingNumbers: string[]) => Promise<BatchPrintResult | null>;
  closePrintErrorModal: () => void;
  setPrintErrors: (errors: FailedPosting[]) => void;
  setPrintSuccessPostings: (postings: string[]) => void;
}

export const useBatchPrint = (options: UseBatchPrintOptions = {}): UseBatchPrintReturn => {
  const { maxPostings = 20, onSuccess, onPartialSuccess, onError } = options;

  const [isPrinting, setIsPrinting] = useState(false);
  const [printErrors, setPrintErrors] = useState<FailedPosting[]>([]);
  const [printSuccessPostings, setPrintSuccessPostings] = useState<string[]>([]);
  const [printErrorModalVisible, setPrintErrorModalVisible] = useState(false);

  const closePrintErrorModal = () => {
    setPrintErrorModalVisible(false);
  };

  const extractErrorMessage = (error: any): string => {
    if (error.response?.data?.error) {
      const err = error.response.data.error;
      if (typeof err.title === 'object' && err.title?.message) {
        return err.title.message;
      } else if (typeof err.title === 'string') {
        return err.title;
      } else if (err.detail?.message) {
        return err.detail.message;
      } else if (err.detail) {
        return typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
      }
    }
    return error.message || '打印失败';
  };

  const batchPrint = async (postingNumbers: string[]): Promise<BatchPrintResult | null> => {
    // 验证
    if (postingNumbers.length === 0) {
      notifyWarning('打印失败', '请先选择需要打印的订单');
      return null;
    }

    if (postingNumbers.length > maxPostings) {
      notifyError('打印失败', `最多支持同时打印${maxPostings}个标签`);
      return null;
    }

    setIsPrinting(true);

    try {
      const result = await ozonApi.batchPrintLabels(postingNumbers);

      if (result.success) {
        // 全部成功
        if (result.pdf_url) {
          notifySuccess(
            '打印成功',
            `成功打印${result.total}个标签（缓存:${result.cached_count}, 新获取:${result.fetched_count}）`
          );
        }
        onSuccess?.(result, postingNumbers);
        return result;
      } else if (result.error === 'PARTIAL_FAILURE') {
        // 部分成功
        setPrintErrors(result.failed_postings || []);
        setPrintSuccessPostings(result.success_postings || []);
        setPrintErrorModalVisible(true);
        onPartialSuccess?.(result);
        return result;
      }

      return result;
    } catch (error: any) {
      console.error('批量打印错误:', error);

      // 处理422错误（业务逻辑错误）
      if (error.response?.status === 422) {
        const errorData = error.response.data?.error?.detail || error.response.data?.detail;

        if (errorData && typeof errorData === 'object' && errorData.error === 'ALL_FAILED') {
          // 全部失败 - 显示详细错误信息
          setPrintErrors(errorData.failed_postings || []);
          setPrintSuccessPostings([]);
          setPrintErrorModalVisible(true);
        } else if (
          errorData &&
          typeof errorData === 'object' &&
          errorData.error === 'INVALID_STATUS'
        ) {
          // 状态错误
          setPrintErrors(errorData.invalid_postings || []);
          setPrintSuccessPostings([]);
          setPrintErrorModalVisible(true);
        } else {
          // 其他422错误
          const errorMessage =
            extractErrorMessage(error) || '部分标签尚未准备好，请在订单装配后45-60秒重试';
          notifyWarning('打印提醒', errorMessage);
        }
      } else {
        // 其他错误
        const errorMessage = extractErrorMessage(error);
        notifyError('打印失败', errorMessage);
      }

      onError?.(error);
      return null;
    } finally {
      setIsPrinting(false);
    }
  };

  return {
    isPrinting,
    printErrors,
    printSuccessPostings,
    printErrorModalVisible,
    batchPrint,
    closePrintErrorModal,
    setPrintErrors,
    setPrintSuccessPostings,
  };
};
