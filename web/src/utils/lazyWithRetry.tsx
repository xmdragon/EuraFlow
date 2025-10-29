/**
 * 带重试机制的懒加载组件加载器
 * 用于处理懒加载组件加载失败的情况（如HMR更新导致的模块失效）
 */

import { ComponentType, lazy } from 'react';
import { loggers } from './logger';
import { handleChunkLoadError } from './versionCheck';

interface RetryOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
}

/**
 * 延迟函数
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带重试机制的懒加载
 * @param importFunc 动态导入函数
 * @param options 重试选项
 * @returns React 懒加载组件
 *
 * @example
 * const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFunc: () => Promise<{ default: T }>,
  options: RetryOptions = {}
): React.LazyExoticComponent<T> {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  return lazy(async () => {
    let lastError: Error | null = null;

    // 尝试加载模块，失败则重试
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const module = await importFunc();

        // 首次尝试失败后成功，记录日志
        if (attempt > 1) {
          loggers.api.info(`懒加载组件重试成功 (尝试 ${attempt}/${maxRetries})`);
        }

        return module;
      } catch (error) {
        lastError = error as Error;
        const errorMsg = error instanceof Error ? error.message : String(error);

        loggers.api.warn(`懒加载组件失败 (尝试 ${attempt}/${maxRetries}):`, {
          error: errorMsg,
          attempt,
          maxRetries,
        });

        // 检查是否为致命错误（不应重试）
        if (
          errorMsg.includes('404') || // 模块不存在
          errorMsg.includes('Failed to fetch') === false // 非网络错误
        ) {
          // 对于非网络错误，立即失败
          break;
        }

        // 最后一次尝试失败，不再重试
        if (attempt === maxRetries) {
          break;
        }

        // 等待后重试
        await delay(retryDelay * attempt); // 指数退避
      }
    }

    // 所有重试都失败，记录错误并抛出
    loggers.api.error('懒加载组件最终失败，建议刷新页面', {
      error: lastError?.message,
      stack: lastError?.stack,
      maxRetries,
    });

    // 检查是否为chunk加载错误
    if (
      lastError?.message.includes('Failed to fetch') ||
      lastError?.message.includes('importing a module script failed') ||
      lastError?.message.includes('Loading chunk') ||
      lastError?.message.includes('ChunkLoadError')
    ) {
      // 检查是否因为版本更新导致的chunk加载失败
      await handleChunkLoadError();

      // 对于chunk加载错误，建议用户刷新页面
      const error = new Error(
        '模块加载失败，这可能是由于代码更新导致的。请刷新页面重试。'
      );
      error.name = 'ChunkLoadError';
      throw error;
    }

    // 抛出原始错误
    throw lastError || new Error('模块加载失败');
  });
}

export default lazyWithRetry;
