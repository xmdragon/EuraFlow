/**
 * 批量打印Hook
 * 封装批量打印标签的核心逻辑和错误处理
 */
import { useState } from 'react';
import * as ozonApi from '@/services/ozon';
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
  onError?: (error: unknown) => void;
}

interface UseBatchPrintReturn {
  isPrinting: boolean;
  printErrors: FailedPosting[];
  printSuccessPostings: string[];
  printErrorModalVisible: boolean;
  batchPrint: (postingNumbers: string[], weights?: Record<string, number>) => Promise<BatchPrintResult | null>;
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

  const extractErrorMessage = (error: unknown): string => {
    const err = error as { response?: { data?: { error?: unknown } }; message?: string };
    if (err.response?.data?.error) {
      const errorData = err.response.data.error as { title?: unknown; detail?: unknown };
      const title = errorData.title as { message?: string } | string | undefined;
      const detail = errorData.detail as { message?: string } | string | undefined;

      if (typeof title === 'object' && title?.message) {
        return title.message;
      } else if (typeof title === 'string') {
        return title;
      } else if (typeof detail === 'object' && detail?.message) {
        return detail.message;
      } else if (detail) {
        return typeof detail === 'string' ? detail : JSON.stringify(detail);
      }
    }
    return err.message || '打印失败';
  };

  const batchPrint = async (postingNumbers: string[], weights?: Record<string, number>): Promise<BatchPrintResult | null> => {
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
      const result = await ozonApi.batchPrintLabels(postingNumbers, weights);

      if (result.success) {
        // 全部成功 - 不在这里显示通知，由调用方统一显示"标签加载成功"
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
    } catch (error: unknown) {
      console.error('批量打印错误:', error);
      const err = error as { response?: { status?: number; data?: { error?: { detail?: unknown }; detail?: unknown } } };

      // 处理422错误（业务逻辑错误）
      if (err.response?.status === 422) {
        const errorData = err.response.data?.error?.detail || err.response.data?.detail;
        const errorObj = errorData as { error?: string; failed_postings?: FailedPosting[]; invalid_postings?: FailedPosting[] } | undefined;

        if (errorObj && typeof errorObj === 'object' && errorObj.error === 'ALL_FAILED') {
          // 全部失败 - 显示详细错误信息
          setPrintErrors(errorObj.failed_postings || []);
          setPrintSuccessPostings([]);
          setPrintErrorModalVisible(true);
        } else if (
          errorObj &&
          typeof errorObj === 'object' &&
          errorObj.error === 'INVALID_STATUS'
        ) {
          // 状态错误
          setPrintErrors(errorObj.invalid_postings || []);
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
