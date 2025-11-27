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

// 本次会话中是否已打印版本来源日志（避免重复输出）
let hasLoggedVersionSource = false;

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
 * 更新于 2025-11-27（从真实请求中提取）
 */
const FALLBACK_APP_VERSION = 'release_26-10-2025_8c89c203';
const FALLBACK_MANIFEST_VERSION = 'frontend-ozon-ru:8c89c203596282a83b13ccb7e135e0f6324a8619;checkout-render-api:8f355203eb2d681f25c4bfdf1d3ae4a97621b7e8;fav-render-api:5ff5cd7b6a74633afb5bb7b2517706b8f94d6fed;sf-render-api:3a16dc35125e614c314decfc16f0ae2c95d01e10;pdp-render-api:08d5a1f8796caf3ff65ea1067ee6c9f515126858';

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
 * 获取 OZON Auth Token（从 storage 读取）
 *
 * Token 由 collector.ts 的 injectTokenReader() 注入到 storage
 *
 * @returns Token 字符串或 null
 */
async function getOzonAuthToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get('ozon_auth_token');
    return result.ozon_auth_token || null;
  } catch (error) {
    console.error('[EuraFlow] 读取 OZON Auth Token 失败:', error);
    return null;
  }
}

/**
 * 生成OZON标准headers
 *
 * @param options 配置选项
 * @returns Promise<标准headers对象>
 *
 * @example
 * const headers = await getOzonStandardHeaders({
 *   referer: 'https://www.ozon.ru/product/...',
 *   serviceName: 'composer'  // 用于 entrypoint-api.bx
 * });
 */
export async function getOzonStandardHeaders(options: {
  referer?: string;
  includeContentType?: boolean;
  serviceName?: string;  // ← Phase 4: 用于 entrypoint-api.bx 的服务标识
  requestId?: string;    // ← 可选：使用指定的 requestId（用于 URL 参数一致性）
} = {}): Promise<{ headers: Record<string, string>; requestId: string }> {
  const { referer, includeContentType = true, serviceName } = options;

  // 动态获取版本信息（优先拦截，回退硬编码）
  const { appVersion, manifestVersion, source } = await getOzonVersions();

  // 日志显示版本来源（每次会话只打印一次）
  if (!hasLoggedVersionSource) {
    console.log(`[EuraFlow Headers] 版本来源: ${source === 'intercepted' ? '✅ 动态拦截' : '⚠️ 硬编码备用'}`, {
      appVersion: appVersion.substring(0, 30) + '...',
      source
    });
    hasLoggedVersionSource = true;
  }

  // 生成或使用指定的请求 ID
  const requestId = options.requestId || generateUUID().replace(/-/g, '');

  // 基础headers（完全模拟真实浏览器请求 + 上品帮headers）
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Cache-Control': 'no-cache',
    'Dnt': '1',  // ← 添加 Do Not Track
    'Origin': 'https://www.ozon.ru',
    'Pragma': 'no-cache',
    'Priority': 'u=1, i',
    // 【关键修复】Chrome 浏览器特征 headers（使用更新版本）
    'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not_A Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',  // ← 修正为 same-origin（www.ozon.ru 调用自己的 API）
    'Sec-Fetch-Storage-Access': 'active',  // ← 修正大小写（Sec 大写）
    'X-O3-App-Name': 'dweb_client',
    'X-O3-App-Version': appVersion,  // ← 动态版本号
    'X-O3-Manifest-Version': manifestVersion,  // ← 动态版本号
    'X-O3-Parent-Requestid': requestId,
    'X-Page-View-Id': generateUUID().replace(/-/g, '')
  };

  // 【Phase 3】优先使用 Token 认证（模拟 OZON 官方）
  const token = await getOzonAuthToken();
  if (token) {
    headers['ozonid-auth-tokens'] = token;
  }
  // 如果没有 Token，调用方需要手动添加 Cookie（fallback）

  // 【Phase 4】添加服务名称（用于 entrypoint-api.bx 等内部网关）
  if (serviceName) {
    headers['x-o3-service-name'] = serviceName;
  }

  // 可选: Content-Type
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }

  // 可选: Referer
  if (referer) {
    headers['Referer'] = referer;
  }

  return { headers, requestId };
}

/**
 * 生成随机短字符串（用于 sh 参数）
 */
export function generateShortHash(length: number = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
