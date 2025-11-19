/**
 * OZON API 标准Headers生成模块
 *
 * 用于生成符合OZON官网标准的HTTP请求headers，避免被识别为机器人请求触发限流
 */

/**
 * OZON版本信息
 */
export interface OzonVersionInfo {
  appVersion: string;         // X-O3-App-Version (例: release_18-10-2025_c87fd5b6)
  manifestVersion: string;    // X-O3-Manifest-Version (例: frontend-ozon-ru:c87fd5b...)
  timestamp: number;          // 提取时间戳（用于缓存过期判断）
}

/**
 * 默认版本信息（作为fallback）
 */
const DEFAULT_VERSION_INFO: OzonVersionInfo = {
  appVersion: 'release_18-10-2025_c87fd5b6',
  manifestVersion: 'frontend-ozon-ru:c87fd5b67349c79b1186a63d756a969351cf71d3;sf-render-api:56343b4def173bc70fe6528eab1e2255fbb80590;checkout-render-api:a5877e91aafb7607399bb458f6d4eae5f51bf9ce;pdp-render-api:08d5a1f879caf3ff65ee1067ed69f5151268588;fav-render-api:c01de8196f0d2fe79f0423137facbe243a6a521a',
  timestamp: Date.now()
};

const VERSION_CACHE_KEY = 'ozon_version_info';
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

/**
 * 从页面DOM提取OZON版本信息
 *
 * @returns 版本信息对象
 */
export async function extractOzonVersions(): Promise<OzonVersionInfo> {
  try {
    // 1. 尝试从缓存读取
    const cached = await chrome.storage.local.get(VERSION_CACHE_KEY);
    if (cached[VERSION_CACHE_KEY]) {
      const cachedData = cached[VERSION_CACHE_KEY] as OzonVersionInfo;
      const isExpired = Date.now() - cachedData.timestamp > CACHE_DURATION;

      if (!isExpired) {
        console.log('[EuraFlow] 使用缓存的OZON版本信息');
        return cachedData;
      }
    }

    // 2. 如果在service worker中运行，无法访问DOM，直接返回默认值
    if (typeof document === 'undefined') {
      console.log('[EuraFlow] Service Worker环境，使用默认版本信息');
      return DEFAULT_VERSION_INFO;
    }

    // 3. 尝试从页面提取（仅在content script中有效）
    let appVersion = DEFAULT_VERSION_INFO.appVersion;
    let manifestVersion = DEFAULT_VERSION_INFO.manifestVersion;

    // 方法1: 从 <meta> 标签提取
    const appVersionMeta = document.querySelector('meta[name="app-version"]');
    if (appVersionMeta) {
      appVersion = appVersionMeta.getAttribute('content') || appVersion;
    }

    const manifestVersionMeta = document.querySelector('meta[name="manifest-version"]');
    if (manifestVersionMeta) {
      manifestVersion = manifestVersionMeta.getAttribute('content') || manifestVersion;
    }

    // 方法2: 从 window 对象提取
    if ((window as any).__OZON_VERSION__) {
      appVersion = (window as any).__OZON_VERSION__.appVersion || appVersion;
      manifestVersion = (window as any).__OZON_VERSION__.manifestVersion || manifestVersion;
    }

    const versionInfo: OzonVersionInfo = {
      appVersion,
      manifestVersion,
      timestamp: Date.now()
    };

    // 4. 缓存到storage
    await chrome.storage.local.set({ [VERSION_CACHE_KEY]: versionInfo });
    console.log('[EuraFlow] 已提取并缓存OZON版本信息', versionInfo);

    return versionInfo;
  } catch (error) {
    console.error('[EuraFlow] 提取OZON版本信息失败，使用默认值', error);
    return DEFAULT_VERSION_INFO;
  }
}

/**
 * 生成UUID（用于请求追踪ID）
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 生成OZON标准headers
 *
 * @param options 配置选项
 * @returns 标准headers对象
 */
export async function getOzonStandardHeaders(options: {
  method?: 'GET' | 'POST';
  referer?: string;
  includeContentType?: boolean;
}): Promise<Record<string, string>> {
  const { method = 'GET', referer, includeContentType = true } = options;

  // 获取版本信息
  const versionInfo = await extractOzonVersions();

  // 基础headers
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Origin': 'https://www.ozon.ru',
    'Pragma': 'no-cache',
    'Priority': 'u=1, i',
    'X-O3-App-Name': 'dweb_client',
    'X-O3-App-Version': versionInfo.appVersion,
    'X-O3-Manifest-Version': versionInfo.manifestVersion,
    'X-O3-Parent-Requestid': generateUUID(),
    'X-Page-View-Id': generateUUID()
  };

  // 可选: Content-Type
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }

  // 可选: Referer
  if (referer) {
    headers['Referer'] = referer;
  }

  return headers;
}

/**
 * 清除版本信息缓存（用于测试或强制刷新）
 */
export async function clearVersionCache(): Promise<void> {
  await chrome.storage.local.remove(VERSION_CACHE_KEY);
  console.log('[EuraFlow] 已清除OZON版本信息缓存');
}
