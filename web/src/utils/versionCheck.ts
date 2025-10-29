/**
 * 版本检测工具
 * 用于检测应用版本更新，在chunk加载失败时提示用户刷新页面
 */

import { message, Modal } from 'antd';
import { loggers } from './logger';

// 版本检查间隔（生产环境5分钟，开发环境禁用）
const VERSION_CHECK_INTERVAL = import.meta.env.PROD ? 5 * 60 * 1000 : 0;

// 版本文件路径
const VERSION_FILE_PATH = '/version.json';

// 当前版本（构建时注入）
let currentVersion: string | null = null;

// 版本检查定时器
let versionCheckTimer: number | null = null;

// 是否正在显示更新提示
let isShowingUpdatePrompt = false;

/**
 * 获取远程版本信息
 */
async function fetchRemoteVersion(): Promise<string | null> {
  try {
    // 添加时间戳防止缓存
    const response = await fetch(`${VERSION_FILE_PATH}?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.version || null;
  } catch (error) {
    loggers.api.warn('获取版本信息失败:', { error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * 检查版本更新
 * @param silent 是否静默检查（不显示提示）
 * @returns 是否有新版本
 */
export async function checkForUpdate(silent = false): Promise<boolean> {
  try {
    const remoteVersion = await fetchRemoteVersion();

    if (!remoteVersion) {
      return false;
    }

    // 首次检查，记录当前版本
    if (!currentVersion) {
      currentVersion = remoteVersion;
      loggers.api.info('初始化应用版本:', { version: currentVersion });
      return false;
    }

    // 检查是否有新版本
    const hasUpdate = remoteVersion !== currentVersion;

    if (hasUpdate) {
      loggers.api.info('检测到新版本:', {
        current: currentVersion,
        remote: remoteVersion,
      });

      if (!silent && !isShowingUpdatePrompt) {
        showUpdatePrompt();
      }
    }

    return hasUpdate;
  } catch (error) {
    loggers.api.warn('版本检查失败:', { error: error instanceof Error ? error.message : error });
    return false;
  }
}

/**
 * 显示更新提示
 */
function showUpdatePrompt() {
  if (isShowingUpdatePrompt) {
    return;
  }

  isShowingUpdatePrompt = true;

  Modal.confirm({
    title: '发现新版本',
    content: '系统已更新到新版本，建议刷新页面以获取最新功能和修复。',
    okText: '立即刷新',
    cancelText: '稍后再说',
    onOk: () => {
      // 强制刷新，清除所有缓存
      window.location.reload();
    },
    onCancel: () => {
      isShowingUpdatePrompt = false;
      message.info('您可以稍后手动刷新页面以获取更新');
    },
    afterClose: () => {
      isShowingUpdatePrompt = false;
    },
  });
}

/**
 * 处理chunk加载错误
 * 当chunk加载失败时调用，检查是否因为版本更新导致
 */
export async function handleChunkLoadError(): Promise<void> {
  loggers.api.warn('Chunk加载失败，检查是否有版本更新...');

  const hasUpdate = await checkForUpdate(false);

  if (hasUpdate) {
    // 版本更新导致的chunk加载失败，提示用户刷新
    loggers.api.info('Chunk加载失败是由于版本更新，提示用户刷新');
  } else {
    // 其他原因导致的加载失败
    loggers.api.warn('Chunk加载失败，但不是版本更新导致');

    // 延迟后自动重试一次
    setTimeout(() => {
      message.warning('页面资源加载失败，请检查网络连接或刷新页面');
    }, 1000);
  }
}

/**
 * 启动版本检查
 */
export function startVersionCheck(): void {
  if (!VERSION_CHECK_INTERVAL || versionCheckTimer) {
    return;
  }

  // 初始检查
  checkForUpdate(true);

  // 定期检查
  versionCheckTimer = window.setInterval(() => {
    checkForUpdate(true);
  }, VERSION_CHECK_INTERVAL);

  loggers.api.info('版本检查已启动', { interval: VERSION_CHECK_INTERVAL });
}

/**
 * 停止版本检查
 */
export function stopVersionCheck(): void {
  if (versionCheckTimer) {
    clearInterval(versionCheckTimer);
    versionCheckTimer = null;
    loggers.api.info('版本检查已停止');
  }
}

/**
 * 监听页面可见性变化
 * 页面重新可见时检查版本
 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && VERSION_CHECK_INTERVAL) {
    // 页面变为可见，检查版本更新
    checkForUpdate(true);
  }
});

// 监听在线/离线状态
window.addEventListener('online', () => {
  loggers.api.info('网络已连接，检查版本更新');
  checkForUpdate(true);
});

window.addEventListener('offline', () => {
  loggers.api.warn('网络已断开');
});