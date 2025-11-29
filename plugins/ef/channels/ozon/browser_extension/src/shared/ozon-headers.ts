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
const BROWSER_INFO_CACHE_KEY = 'browser_info_cache';
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
 * 浏览器信息缓存结构
 */
interface BrowserInfoCache {
  browserName: string;         // 浏览器名称（如 "Google Chrome" 或 "Microsoft Edge"）
  chromeVersion: string;       // Chromium 主版本号（如 "136"）
  fullVersion: string;         // 完整版本号（如 "136.0.0.0"）
  secChUa: string;             // sec-ch-ua header 值
  userAgent: string;           // User-Agent header 值
  timestamp: number;
}

/**
 * 默认版本信息（fallback）
 * 当拦截失败或缓存过期时使用
 * 更新于 2025-11-27（从真实请求中提取）
 */
const FALLBACK_APP_VERSION = 'release_26-10-2025_8c89c203';
const FALLBACK_MANIFEST_VERSION = 'frontend-ozon-ru:8c89c203596282a83b13ccb7e135e0f6324a8619;checkout-render-api:8f355203eb2d681f25c4bfdf1d3ae4a97621b7e8;fav-render-api:5ff5cd7b6a74633afb5bb7b2517706b8f94d6fed;sf-render-api:3a16dc35125e614c314decfc16f0ae2c95d01e10;pdp-render-api:08d5a1f8796caf3ff65ea1067ee6c9f515126858';

// 默认 Chrome 版本（fallback）
const FALLBACK_CHROME_VERSION = '136';

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
 * 获取浏览器信息（动态获取真实 Chrome 版本）
 *
 * 优先级：
 * 1. 缓存中的有效数据（24小时内）
 * 2. 从 navigator.userAgentData 获取（现代 API）
 * 3. 从 navigator.userAgent 解析（兼容旧版）
 * 4. 使用 fallback 默认值
 *
 * @returns 浏览器信息对象
 */
async function getBrowserInfo(): Promise<{
  chromeVersion: string;
  secChUa: string;
  userAgent: string;
  source: 'cached' | 'detected' | 'fallback';
}> {
  try {
    // 1. 尝试从缓存读取
    const result = await chrome.storage.local.get(BROWSER_INFO_CACHE_KEY);
    const cached = result[BROWSER_INFO_CACHE_KEY] as BrowserInfoCache | undefined;

    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
      return {
        chromeVersion: cached.chromeVersion,
        secChUa: cached.secChUa,
        userAgent: cached.userAgent,
        source: 'cached'
      };
    }
  } catch (error) {
    // 缓存读取失败，继续尝试检测
  }

  // 2. 尝试动态检测
  try {
    let chromeVersion = FALLBACK_CHROME_VERSION;
    let fullVersion = `${FALLBACK_CHROME_VERSION}.0.0.0`;

    // 方式 1：使用现代 userAgentData API（Chrome 90+）
    if (typeof navigator !== 'undefined' && 'userAgentData' in navigator) {
      const uaData = (navigator as any).userAgentData;
      if (uaData?.brands) {
        const chromeBrand = uaData.brands.find((b: any) =>
          b.brand === 'Google Chrome' || b.brand === 'Chromium'
        );
        if (chromeBrand?.version) {
          chromeVersion = chromeBrand.version;
        }
      }
      // 获取完整版本（需要高熵值）
      if (uaData?.getHighEntropyValues) {
        try {
          const highEntropy = await uaData.getHighEntropyValues(['fullVersionList']);
          const chromeInfo = highEntropy.fullVersionList?.find((b: any) =>
            b.brand === 'Google Chrome' || b.brand === 'Chromium'
          );
          if (chromeInfo?.version) {
            fullVersion = chromeInfo.version;
          }
        } catch {
          // 高熵值获取失败，使用主版本号
          fullVersion = `${chromeVersion}.0.0.0`;
        }
      }
    }

    // 方式 2：从 userAgent 解析（兼容方案）
    if (chromeVersion === FALLBACK_CHROME_VERSION && typeof navigator !== 'undefined') {
      const ua = navigator.userAgent;
      const match = ua.match(/Chrome\/(\d+)(?:\.(\d+)\.(\d+)\.(\d+))?/);
      if (match) {
        chromeVersion = match[1];
        if (match[2]) {
          fullVersion = `${match[1]}.${match[2]}.${match[3] || '0'}.${match[4] || '0'}`;
        }
      }
    }

    // 检测浏览器名称（Edge vs Chrome）
    let browserName = 'Google Chrome';
    if (typeof navigator !== 'undefined') {
      if ('userAgentData' in navigator) {
        const uaData = (navigator as any).userAgentData;
        const edgeBrand = uaData?.brands?.find((b: any) => b.brand === 'Microsoft Edge');
        if (edgeBrand) {
          browserName = 'Microsoft Edge';
        }
      } else if (navigator.userAgent.includes('Edg/')) {
        browserName = 'Microsoft Edge';
      }
    }

    // 构建 sec-ch-ua（符合浏览器标准格式）
    const secChUa = `"Chromium";v="${chromeVersion}", "${browserName}";v="${chromeVersion}", "Not_A Brand";v="99"`;

    // 构建 User-Agent
    const edgeSuffix = browserName === 'Microsoft Edge' ? ` Edg/${fullVersion}` : '';
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVersion} Safari/537.36${edgeSuffix}`;

    // 3. 缓存检测结果
    const browserInfo: BrowserInfoCache = {
      browserName,
      chromeVersion,
      fullVersion,
      secChUa,
      userAgent,
      timestamp: Date.now()
    };

    try {
      await chrome.storage.local.set({ [BROWSER_INFO_CACHE_KEY]: browserInfo });
    } catch {
      // 缓存写入失败，不影响返回
    }

    return {
      chromeVersion,
      secChUa,
      userAgent,
      source: 'detected'
    };
  } catch (error) {
    // 检测失败，使用 fallback
  }

  // 4. Fallback
  return {
    chromeVersion: FALLBACK_CHROME_VERSION,
    secChUa: `"Chromium";v="${FALLBACK_CHROME_VERSION}", "Google Chrome";v="${FALLBACK_CHROME_VERSION}", "Not_A Brand";v="99"`,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${FALLBACK_CHROME_VERSION}.0.0.0 Safari/537.36`,
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
  const { appVersion, manifestVersion } = await getOzonVersions();

  // 动态获取浏览器信息（真实 Chrome 版本）
  const browserInfo = await getBrowserInfo();

  // 标记已获取版本（避免重复获取）
  if (!hasLoggedVersionSource) {
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
    // 【动态获取】Chrome 浏览器特征 headers（使用真实版本）
    'sec-ch-ua': browserInfo.secChUa,
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

  // 添加服务名称（用于 entrypoint-api.bx 等内部网关）
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

/**
 * 导出浏览器信息获取函数（供其他模块使用）
 */
export { getBrowserInfo };
