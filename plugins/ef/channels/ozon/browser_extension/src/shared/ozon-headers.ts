/**
 * OZON API 标准Headers生成模块
 *
 * 用于生成符合OZON官网标准的HTTP请求headers，避免被识别为机器人请求触发限流
 *
 * ✨ 版本信息来源：
 * 1. **优先**：从动态拦截的真实OZON请求中获取（自动更新）
 * 2. **降级**：如果拦截失败或缓存过期（>24小时），使用硬编码默认值
 *
 * 工作流程：
 * - background/service-worker.ts 拦截OZON API请求，捕获真实headers
 * - 版本信息缓存到 chrome.storage.local（24小时有效期）
 * - 本模块从缓存读取，确保使用最新版本号
 *
 * 最后更新：2025-01-19
 */

const OZON_VERSION_CACHE_KEY = 'ozon_intercepted_versions';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时

/**
 * 拦截到的版本信息结构
 */
interface InterceptedVersions {
  appVersion: string;
  manifestVersion: string;
  timestamp: number;
}

/**
 * 默认版本信息（fallback）
 * 当拦截失败或缓存过期时使用
 */
const FALLBACK_APP_VERSION = 'release_18-10-2025_c87fd5b6';
const FALLBACK_MANIFEST_VERSION = 'frontend-ozon-ru:c87fd5b67349c79b1186a63d756a969351cf71d3;sf-render-api:56343b4def173bc70fe6528eab1e2255fbb80590;checkout-render-api:a5877e91aafb7607399bb458f6d4eae5f51bf9ce;pdp-render-api:08d5a1f879caf3ff65ee1067ed69f5151268588;fav-render-api:c01de8196f0d2fe79f0423137facbe243a6a521a';

/**
 * 获取OZON版本信息
 * 优先使用拦截到的真实版本，回退到硬编码
 *
 * @returns 版本信息对象
 */
async function getOzonVersions(): Promise<{
  appVersion: string;
  manifestVersion: string;
  source: 'intercepted' | 'fallback';
}> {
  try {
    // 尝试从缓存读取拦截结果
    const result = await chrome.storage.local.get(OZON_VERSION_CACHE_KEY);
    const cached = result[OZON_VERSION_CACHE_KEY] as InterceptedVersions | undefined;

    if (cached) {
      const isExpired = Date.now() - cached.timestamp > CACHE_DURATION;

      if (!isExpired) {
        // 使用拦截的真实版本
        return {
          appVersion: cached.appVersion,
          manifestVersion: cached.manifestVersion,
          source: 'intercepted'
        };
      }
    }
  } catch (error) {
    console.error('[EuraFlow] 读取拦截版本信息失败:', error);
  }

  // 回退到硬编码
  return {
    appVersion: FALLBACK_APP_VERSION,
    manifestVersion: FALLBACK_MANIFEST_VERSION,
    source: 'fallback'
  };
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
 * @returns Promise<标准headers对象>
 *
 * @example
 * const headers = await getOzonStandardHeaders({
 *   referer: 'https://www.ozon.ru/product/...'
 * });
 */
export async function getOzonStandardHeaders(options: {
  referer?: string;
  includeContentType?: boolean;
} = {}): Promise<Record<string, string>> {
  const { referer, includeContentType = true } = options;

  // 动态获取版本信息（优先拦截，回退硬编码）
  const { appVersion, manifestVersion } = await getOzonVersions();

  // 基础headers（模拟真实浏览器请求）
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Origin': 'https://www.ozon.ru',
    'Pragma': 'no-cache',
    'Priority': 'u=1, i',
    'X-O3-App-Name': 'dweb_client',
    'X-O3-App-Version': appVersion,  // ← 动态版本号
    'X-O3-Manifest-Version': manifestVersion,  // ← 动态版本号
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
