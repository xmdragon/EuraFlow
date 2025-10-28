/**
 * Vite HMR 错误处理器
 * 用于捕获热更新过程中的错误，自动刷新页面避免黑屏
 */

import { loggers } from './logger';

// 是否已经在刷新页面
let isReloading = false;

/**
 * 检查是否为 HMR 相关错误
 */
function isHMRError(error: Error): boolean {
  const errorMsg = error.message.toLowerCase();
  return (
    errorMsg.includes('failed to fetch') ||
    errorMsg.includes('importing a module script failed') ||
    errorMsg.includes('failed to load module') ||
    errorMsg.includes('chunk') ||
    errorMsg.includes('hmr')
  );
}

/**
 * 检查是否为懒加载模块加载失败
 */
function isChunkLoadError(error: Error): boolean {
  const errorMsg = error.message.toLowerCase();
  return (
    error.name === 'ChunkLoadError' ||
    errorMsg.includes('loading chunk') ||
    errorMsg.includes('failed to fetch dynamically imported module')
  );
}

/**
 * 自动刷新页面（带防抖）
 */
function reloadPage(reason: string) {
  if (isReloading) return;

  isReloading = true;
  loggers.api.warn(`检测到${reason}，3秒后自动刷新页面...`);

  // 延迟刷新，给用户一些时间看到提示
  setTimeout(() => {
    window.location.reload();
  }, 3000);
}

/**
 * 初始化 HMR 错误处理
 */
export function initHMRErrorHandler() {
  // 只在开发环境启用
  if (import.meta.env.MODE !== 'development') {
    return;
  }

  // 监听全局错误事件
  window.addEventListener('error', (event) => {
    const error = event.error;

    if (!error) return;

    // 检查是否为 HMR 错误
    if (isHMRError(error)) {
      event.preventDefault();
      loggers.api.error('HMR 错误:', {
        message: error.message,
        stack: error.stack,
      });
      reloadPage('HMR更新失败');
      return;
    }

    // 检查是否为懒加载错误
    if (isChunkLoadError(error)) {
      event.preventDefault();
      loggers.api.error('懒加载模块失败:', {
        message: error.message,
        stack: error.stack,
      });
      reloadPage('模块加载失败');
      return;
    }
  });

  // 监听未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;

    if (!error || typeof error !== 'object') return;

    const errorMsg = error.message || String(error);

    // 检查是否为模块加载错误
    if (
      errorMsg.toLowerCase().includes('failed to fetch') ||
      errorMsg.toLowerCase().includes('importing a module script failed')
    ) {
      event.preventDefault();
      loggers.api.error('未处理的模块加载错误:', errorMsg);
      reloadPage('模块加载失败');
      return;
    }
  });

  // 监听 Vite HMR 事件
  if (import.meta.hot) {
    import.meta.hot.on('vite:error', (payload) => {
      loggers.api.error('Vite HMR 错误:', payload);
      reloadPage('Vite热更新错误');
    });

    // 监听 HMR 连接状态
    import.meta.hot.on('vite:ws:disconnect', () => {
      loggers.api.warn('Vite HMR 连接已断开');
    });

    import.meta.hot.on('vite:ws:connect', () => {
      loggers.api.info('Vite HMR 连接已恢复');
    });
  }

  loggers.api.info('HMR 错误处理器已初始化');
}

/**
 * 手动触发页面重载（用于 ErrorBoundary）
 */
export function triggerReload(reason: string = '未知错误') {
  reloadPage(reason);
}
