// 导入全局OZON API限流器和标准headers生成器
import { OzonApiRateLimiter } from '../shared/ozon-rate-limiter';
import { getOzonStandardHeaders } from '../shared/ozon-headers';

// ============================================================================
// OZON 版本信息动态拦截器
// ============================================================================
// 监听OZON API请求，自动捕获真实的 x-o3-app-version 和 x-o3-manifest-version
// 缓存到 chrome.storage.local（24小时有效期），供 ozon-headers.ts 使用
// ============================================================================

const OZON_VERSION_CACHE_KEY = 'ozon_intercepted_versions';
const OZON_VERSION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时

// 用于标记是否已经拦截过（避免重复日志）
let hasInterceptedVersion = false;

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // 如果已经拦截过且在24小时内，跳过
    if (hasInterceptedVersion) {
      return { requestHeaders: details.requestHeaders };
    }

    const headers = details.requestHeaders || [];
    const versionHeaders: Record<string, string> = {};

    // 提取关键headers
    headers.forEach((header) => {
      const name = header.name.toLowerCase();
      if (name === 'x-o3-app-version' || name === 'x-o3-manifest-version') {
        versionHeaders[name] = header.value || '';
      }
    });

    // 如果找到了完整的版本信息，缓存起来
    if (versionHeaders['x-o3-app-version'] && versionHeaders['x-o3-manifest-version']) {
      chrome.storage.local.set({
        [OZON_VERSION_CACHE_KEY]: {
          appVersion: versionHeaders['x-o3-app-version'],
          manifestVersion: versionHeaders['x-o3-manifest-version'],
          timestamp: Date.now()
        }
      });

      console.log('[EuraFlow] ✅ 成功拦截OZON版本信息:', {
        appVersion: versionHeaders['x-o3-app-version'],
        manifestVersion: versionHeaders['x-o3-manifest-version'].substring(0, 50) + '...'
      });

      // 标记已拦截（Service Worker 生命周期内不再重复拦截）
      hasInterceptedVersion = true;
    }

    return { requestHeaders: details.requestHeaders };
  },
  {
    urls: [
      'https://www.ozon.ru/api/*',
      'https://api.ozon.ru/*',
      'https://seller.ozon.ru/api/*'
    ]
  },
  ['requestHeaders']
);

// Service Worker 启动时，检查缓存是否有效
chrome.storage.local.get([OZON_VERSION_CACHE_KEY], (result) => {
  const cached = result[OZON_VERSION_CACHE_KEY];
  if (cached && (Date.now() - cached.timestamp < OZON_VERSION_CACHE_DURATION)) {
    hasInterceptedVersion = true;
    console.log('[EuraFlow] 🔍 OZON版本信息已缓存，有效期至:', new Date(cached.timestamp + OZON_VERSION_CACHE_DURATION).toLocaleString());
  }
});

console.log('[EuraFlow] 🔍 OZON版本拦截器已启动');

// ============================================================================
// 全局商品数据缓存（5分钟有效期）
// ============================================================================

interface GlobalProductData {
  url: string;
  ozonProduct: any;           // OZON API数据（包括变体）
  spbSales: any | null;       // 上品帮销售数据
  dimensions: any | null;     // OZON Seller API 尺寸数据
  euraflowConfig: any | null; // EuraFlow配置（店铺、仓库、水印）
  timestamp: number;
}

const productDataCache = new Map<string, GlobalProductData>();
const CACHE_DURATION = 5 * 60 * 1000;

chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.storage.sync.get(['targetCount'], (result) => {
      if (result.targetCount === undefined) {
        chrome.storage.sync.set({ targetCount: 100 });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {

  if (message.type === 'UPLOAD_PRODUCTS') {
    handleUploadProducts(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'TEST_CONNECTION') {
    handleTestConnection(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_CONFIG') {
    handleGetConfig(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'QUICK_PUBLISH') {
    handleQuickPublish(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'QUICK_PUBLISH_BATCH') {
    handleQuickPublishBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_TASK_STATUS') {
    handleGetTaskStatus(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'COLLECT_PRODUCT') {
    handleCollectProduct(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'SPB_LOGIN') {
    handleShangpinbangLogin(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'SPB_GET_TOKEN') {
    handleGetShangpinbangToken()
      .then(token => sendResponse({ success: true, data: { token } }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'SPB_API_CALL') {
    handleShangpinbangAPICall(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_OZON_PRODUCT_DETAIL') {
    handleGetOzonProductDetail(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_SPB_SALES_DATA') {
    handleGetSpbSalesData(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_SPB_SALES_DATA_BATCH') {
    handleGetSpbSalesDataBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_GOODS_COMMISSIONS_BATCH') {
    handleGetGoodsCommissionsBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_FOLLOW_SELLER_DATA_BATCH') {
    handleGetFollowSellerDataBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ✅ GET_FOLLOW_SELLER_DATA_SINGLE 已移到 Content Script 直接调用（显示在网络面板）

  if (message.type === 'GET_SPB_COMMISSIONS') {
    handleGetSpbCommissions(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'FETCH_ALL_PRODUCT_DATA') {
    // 并发获取所有商品数据
    handleFetchAllProductData(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }
});

/**
 * 处理商品数据上传
 */
async function handleUploadProducts(data: { apiUrl: string; apiKey: string; products: any[] }) {
  const { apiUrl, apiKey, products } = data;

  // 创建超时控制器（60秒超时）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${apiUrl}/api/ef/v1/ozon/product-selection/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ products }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = '上传失败';
      let errorDetails = '';

      try {
        const errorData = await response.json();

        // 调试日志：输出完整错误响应
        console.error('[Upload] Error response:', JSON.stringify(errorData, null, 2));

        // 多层级解析错误信息
        // 1. 尝试 errorData.detail.message (FastAPI HTTPException)
        if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.message) {
          errorMessage = errorData.detail.message;
          if (errorData.detail.code) {
            errorDetails = ` [${errorData.detail.code}]`;
          }
        }
        // 2. 尝试 errorData.detail 作为字符串
        else if (errorData.detail && typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        }
        // 3. 尝试 errorData.message
        else if (errorData.message) {
          errorMessage = errorData.message;
        }
        // 4. 尝试 errorData.error.message (统一错误格式)
        else if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        }
        // 5. 根据 code 提供友好提示
        else if (errorData.code || (errorData.detail && errorData.detail.code)) {
          const code = errorData.code || errorData.detail.code;
          switch (code) {
            case 'UNAUTHORIZED':
              errorMessage = 'API Key无效或权限不足';
              break;
            case 'PAYLOAD_TOO_LARGE':
              errorMessage = '数据量过大（最多1000条）';
              break;
            case 'EMPTY_PAYLOAD':
              errorMessage = '没有可上传的商品';
              break;
            default:
              errorMessage = `上传失败 [${code}]`;
          }
        }
        // 6. 如果都没有，使用 HTTP 状态码
        else {
          errorMessage = `服务器错误 (HTTP ${response.status})`;
          errorDetails = JSON.stringify(errorData).substring(0, 100);
        }
      } catch (parseError) {
        // JSON解析失败，尝试读取文本
        try {
          const errorText = await response.text();
          errorMessage = `服务器错误 (HTTP ${response.status})`;
          if (errorText) {
            errorDetails = `: ${errorText.substring(0, 100)}`;
          }
        } catch {
          errorMessage = `服务器错误 (HTTP ${response.status})`;
        }
      }

      throw new Error(errorMessage + errorDetails);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('上传超时（请检查网络连接或减少上传数量）');
    } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
      throw new Error('网络连接失败（请检查API地址和网络）');
    } else {
      throw error;
    }
  }
}

/**
 * 测试API连接
 */
async function handleTestConnection(data: { apiUrl: string; apiKey: string }) {
  const { apiUrl, apiKey } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/auth/me`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const userData = await response.json();
  return { status: 'ok', username: userData.username };
}

/**
 * 获取一键上架所需的所有配置（店铺、仓库、水印）
 * 优化：单次请求减少网络往返
 */
async function handleGetConfig(data: { apiUrl: string; apiKey: string }) {
  const { apiUrl, apiKey } = data;

  console.log('[Service Worker] 请求配置, URL:', apiUrl, ', API Key前4位:', apiKey.substring(0, 4));

  const response = await fetch(`${apiUrl}/api/ef/v1/ozon/quick-publish/config`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey
    }
  });

  console.log('[Service Worker] 响应状态:', response.status, response.statusText);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[Service Worker] 错误响应:', errorData);
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  console.log('[Service Worker] 原始响应:', result);
  console.log('[Service Worker] result.data存在:', !!result.data);
  console.log('[Service Worker] result.success:', result.success);

  // 后端返回 {success: true, data: {shops: [], watermarks: []}}
  // 需要返回data对象
  if (result.success && result.data) {
    return result.data;
  }
  return result;
}

/**
 * 快速上架商品
 */
async function handleQuickPublish(data: { apiUrl: string; apiKey: string; data: any }) {
  const { apiUrl, apiKey, data: publishData } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/ozon/quick-publish/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(publishData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 批量快速上架商品（多个变体）
 */
async function handleQuickPublishBatch(data: { apiUrl: string; apiKey: string; data: any }) {
  const { apiUrl, apiKey, data: publishData } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/ozon/quick-publish/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(publishData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 查询任务状态
 */
async function handleGetTaskStatus(data: { apiUrl: string; apiKey: string; taskId: string; shopId?: number }) {
  const { apiUrl, apiKey, taskId, shopId } = data;

  // 构建URL，如果有shopId则添加查询参数
  let url = `${apiUrl}/api/ef/v1/ozon/quick-publish/task/${taskId}/status`;
  if (shopId !== undefined) {
    url += `?shop_id=${shopId}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 采集商品
 */
async function handleCollectProduct(data: { apiUrl: string; apiKey: string; source_url: string; product_data: any }) {
  const { apiUrl, apiKey, source_url, product_data } = data;

  try {
    const response = await fetch(`${apiUrl}/api/ef/v1/ozon/collection-records/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        source_url,
        product_data
      })
    });

    if (!response.ok) {
      let errorMessage = '采集失败';
      try {
        const errorData = await response.json();
        console.error('[采集] 服务器错误响应:', JSON.stringify(errorData, null, 2));

        // 多层级解析错误信息
        if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.detail) {
          errorMessage = errorData.detail.detail;
        } else if (errorData.detail && typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        } else {
          // 如果都没解析到，使用完整的错误对象
          errorMessage = `采集失败 (HTTP ${response.status}): ${JSON.stringify(errorData)}`;
        }
      } catch (parseError) {
        errorMessage = `服务器错误 (HTTP ${response.status})`;
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error: any) {
    // 捕获网络错误、超时等异常
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('网络连接失败，请检查网络');
    } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      throw new Error('请求超时，请稍后重试');
    } else {
      // 如果是已经包装过的错误，直接抛出
      throw error;
    }
  }
}

// ========== 上品帮登录功能 ==========

/**
 * 处理上品帮登录
 */
async function handleShangpinbangLogin(data: { phone: string; password: string }) {
  const { phone, password } = data;

  console.log('[上品帮登录] 发起登录请求, 手机号:', phone);

  try {
    const response = await fetch('https://plus.shopbang.cn/api/user/open/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone, pwd: password })
    });

    console.log('[上品帮登录] 响应状态:', response.status);

    // 解析响应
    const result = await response.json();
    console.log('[上品帮登录] 响应数据:', { code: result.code, message: result.message });

    // 判断登录结果
    if (result.code === 0 && result.data && result.data.token) {
      // 登录成功，存储token
      const token = result.data.token;
      await chrome.storage.sync.set({
        spbToken: token,
        spbPhone: phone,
        spbPassword: password
      });

      console.log('[上品帮登录] 登录成功，Token已存储');

      return {
        success: true,
        token: token,
        message: result.message
      };
    } else if (result.code === -1) {
      // 登录失败（密码错误或手机号未注册）
      console.warn('[上品帮登录] 登录失败:', result.message);
      throw new Error(result.message);
    } else {
      // 其他未知错误
      console.error('[上品帮登录] 未知错误:', result);
      throw new Error('登录失败，服务器返回异常数据');
    }
  } catch (error: any) {
    console.error('[上品帮登录] 错误:', error);

    // 区分网络错误和业务错误
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('网络连接失败，请检查网络');
    } else {
      throw error;
    }
  }
}

/**
 * 获取上品帮Token
 */
async function handleGetShangpinbangToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['spbToken'], (result) => {
      resolve(result.spbToken);
    });
  });
}

/**
 * 获取上品帮完整配置（包括账号密码）
 */
async function getShangpinbangCredentials(): Promise<{ phone: string; password: string; token?: string } | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['spbPhone', 'spbPassword', 'spbToken'], (result) => {
      if (!result.spbPhone || !result.spbPassword) {
        resolve(null);
      } else {
        resolve({
          phone: result.spbPhone,
          password: result.spbPassword,
          token: result.spbToken
        });
      }
    });
  });
}

/**
 * 检测是否为 Token 过期错误
 */
function isTokenExpiredError(responseData: any): boolean {
  // 上品帮 API：code = 0 表示成功，code != 0 表示失败
  if (responseData.code === 0) {
    return false;
  }

  // code != 0 时，检查是否为 Token 相关错误
  const message = (responseData.message || '').toLowerCase();
  const tokenRelatedKeywords = [
    'token',
    '登录',
    '登陆',
    '过期',
    '失效',
    '未登录',
    '请登录',
    'expired',
    'unauthorized',
    'not logged in'
  ];

  return tokenRelatedKeywords.some(keyword => message.includes(keyword));
}

/**
 * 处理上品帮 API 调用请求
 */
async function handleShangpinbangAPICall(data: { apiUrl: string; apiType: string; params: Record<string, any> }) {
  const { apiUrl, apiType, params } = data;
  return await callShangpinbangAPIWithAutoRefresh(apiUrl, apiType, params);
}

/**
 * 通用上品帮 API 调用函数（支持自动 Token 刷新）
 *
 * @param apiUrl - API 地址（如：https://api.shopbang.cn/api/goods/collect）
 * @param apiType - API 类型（如：goodsCollect）
 * @param params - API 参数
 * @param retryCount - 当前重试次数（内部使用，外部调用时不传）
 * @returns API 响应数据
 */
async function callShangpinbangAPIWithAutoRefresh(
  apiUrl: string,
  apiType: string,
  params: Record<string, any>,
  retryCount: number = 0
): Promise<any> {
  // 获取配置（包括 token 和账号密码）
  const credentials = await getShangpinbangCredentials();

  if (!credentials) {
    throw new Error('未配置上品帮账号密码，请先在扩展配置中设置');
  }

  if (!credentials.token) {
    console.log('[上品帮 API] Token 不存在，尝试自动登录...');
    // Token 不存在，先尝试登录
    try {
      const loginResult = await handleShangpinbangLogin({
        phone: credentials.phone,
        password: credentials.password
      });
      credentials.token = loginResult.token;
    } catch (error: any) {
      throw new Error(`自动登录失败: ${error.message}`);
    }
  }

  console.log(`[上品帮 API] 调用 ${apiType}, URL: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: credentials.token,
        apiType: apiType,
        ...params
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[上品帮 API] ${apiType} 响应:`, { code: result.code, message: result.message });

    // 检测是否为 Token 过期错误
    if (isTokenExpiredError(result)) {
      if (retryCount >= 1) {
        // 已经重试过一次，不再重试
        console.error('[上品帮 API] Token 刷新后仍然失败，停止重试');
        throw new Error(`Token 已失效: ${result.message}`);
      }

      console.warn('[上品帮 API] 检测到 Token 过期，尝试重新登录...');

      // 重新登录
      try {
        await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });

        console.log('[上品帮 API] 重新登录成功，重试原请求...');

        // 递归重试（retryCount + 1）
        return await callShangpinbangAPIWithAutoRefresh(apiUrl, apiType, params, retryCount + 1);
      } catch (loginError: any) {
        throw new Error(`自动重新登录失败: ${loginError.message}`);
      }
    }

    // 返回 API 响应
    return result;
  } catch (error: any) {
    console.error(`[上品帮 API] ${apiType} 调用失败:`, error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('网络连接失败，请检查网络');
    } else {
      throw error;
    }
  }
}

// ========== OZON API 集成 ==========


/**
 * 从 Cookie 字符串中提取 sellerId
 * 参考 spbang：从 Cookie 中匹配 sc_company_id=数字
 */
async function getOzonSellerId(cookieString: string): Promise<number> {
  console.log('[OZON API] 从 Cookie 中提取 Seller ID...');

  // 1. 尝试匹配 sc_company_id=数字
  let match = cookieString.match(/sc_company_id=(\d+)/);

  if (match && match[1]) {
    const sellerId = parseInt(match[1], 10);
    console.log(`[OZON API] ✅ 从 sc_company_id 提取到 Seller ID: ${sellerId}`);
    return sellerId;
  }

  // 2. 尝试匹配 contentId=数字（备用方案）
  match = cookieString.match(/contentId=(\d+)/);
  if (match && match[1]) {
    const sellerId = parseInt(match[1], 10);
    console.log(`[OZON API] ✅ 从 contentId 提取到 Seller ID: ${sellerId}`);
    return sellerId;
  }

  // 3. 尝试匹配 company_id=数字（第三备用方案）
  match = cookieString.match(/company_id=(\d+)/);
  if (match && match[1]) {
    const sellerId = parseInt(match[1], 10);
    console.log(`[OZON API] ✅ 从 company_id 提取到 Seller ID: ${sellerId}`);
    return sellerId;
  }

  // 4. 都没有找到，输出详细调试信息
  console.error('[OZON API] ========== 未找到 Seller ID ==========');
  console.error('[OZON API] Cookie 字符串长度:', cookieString.length);
  console.error('[OZON API] Cookie 前 500 字符:', cookieString.substring(0, 500));

  // 提取所有可能包含 ID 的 cookie
  const potentialIdCookies = cookieString.split('; ')
    .filter(c => /\d{5,}/.test(c))  // 包含5位以上数字的 cookie
    .slice(0, 10);  // 只显示前10个

  if (potentialIdCookies.length > 0) {
    console.error('[OZON API] 包含数字的 Cookie (前10个):', potentialIdCookies);
  }

  console.error('[OZON API] ========================================');
  console.error('[OZON API] 🔴 请按以下步骤操作：');
  console.error('[OZON API] 1. 打开 https://seller.ozon.ru 并登录卖家后台');
  console.error('[OZON API] 2. 登录成功后，按 F12 打开开发者工具');
  console.error('[OZON API] 3. 在 Console 控制台输入: document.cookie');
  console.error('[OZON API] 4. 检查输出中是否包含 sc_company_id 或 company_id');
  console.error('[OZON API] 5. 重新加载浏览器扩展 (chrome://extensions/)');
  console.error('[OZON API] 6. 刷新商品页面重试');

  throw new Error('未找到 OZON Seller ID，请确认已登录卖家后台（seller.ozon.ru）');
}

/**
 * 处理获取 OZON 商品详情请求
 */
async function handleGetOzonProductDetail(data: { productSku?: string; productId?: string; cookieString?: string }) {
  // 兼容两种字段名：productSku（新）和 productId（旧）
  const productId = data.productSku || data.productId;
  const documentCookie = data.cookieString;

  console.log('[OZON API] 获取商品详情, SKU:', productId);

  try {
    // 验证必需参数
    if (!productId) {
      console.error('[OZON API] ❌ 缺少商品 SKU 参数');
      throw new Error('缺少商品 SKU 参数');
    }

    // 【简化】直接使用 document.cookie（Content Script 从页面传来）
    // 原因：document.cookie 包含所有必需的 cookies（如 sc_company_id），
    //      而 Background Cookie API 无法读取某些重要 cookies
    if (!documentCookie || documentCookie.length === 0) {
      console.error('[OZON API] ❌ 未接收到页面 Cookie，无法调用 Seller API');
      throw new Error('缺少必需的页面 Cookie');
    }

    console.log('[OZON API] 使用页面 Cookie');
    console.log(`  - Cookie 长度: ${documentCookie.length}`);

    // 检查关键 Cookie
    const sellerIdMatch = documentCookie.match(/sc_company_id=(\d+)/);
    if (sellerIdMatch) {
      console.log(`  - ✅ sc_company_id: ${sellerIdMatch[1]}`);
    } else {
      console.log(`  - ⚠️ 未找到 sc_company_id`);
    }

    // 从 Cookie 字符串中提取 Seller ID
    const sellerId = await getOzonSellerId(documentCookie);

    // 4. 使用全局OZON API限流器（统一管理所有OZON API请求频率）
    const limiter = OzonApiRateLimiter.getInstance();

    // 5. 调用 OZON search-variant-model API（使用完整headers避免触发限流）
    // 注意：seller.ozon.ru 需要特殊的 seller-ui headers，不能直接使用标准headers
    const baseHeaders = await getOzonStandardHeaders({
      referer: 'https://seller.ozon.ru/app/products'
    });

    // 覆盖/添加 seller-ui 专属headers
    const sellerHeaders = {
      ...baseHeaders,
      'Cookie': documentCookie,  // 直接使用页面 Cookie
      'Origin': 'https://seller.ozon.ru',
      'x-o3-company-id': sellerId.toString(),
      'x-o3-app-name': 'seller-ui',
      'x-o3-language': 'zh-Hans',
      'x-o3-page-type': 'products-other'
    };

    // 【路径策略】seller.ozon.ru/api/* → 不经过网关，直接调用 Seller 后台 API
    const requestUrl = 'https://seller.ozon.ru/api/v1/search-variant-model';
    const requestBody = {
      limit: '10',
      name: productId
    };

    console.log('[OZON API] 请求信息:', {
      url: requestUrl,
      method: 'POST',
      body: requestBody
    });

    const response = await limiter.execute(() =>
      fetch(requestUrl, {
        method: 'POST',
        headers: sellerHeaders,
        body: JSON.stringify(requestBody)
      })
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OZON API] ❌ Seller API 请求失败:', {
        status: response.status,
        statusText: response.statusText,
        url: requestUrl,
        body: requestBody,
        headers: {
          'x-o3-company-id': sellerHeaders['x-o3-company-id'],
          'x-o3-app-name': sellerHeaders['x-o3-app-name'],
          'Cookie长度': sellerHeaders['Cookie']?.length || 0
        },
        responseBody: errorText.substring(0, 500)
      });
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.items || result.items.length === 0) {
      throw new Error('商品不存在或已下架');
    }

    const product = result.items[0];

    // 输出原始数据结构（用于调试图片字段）
    console.log('[OZON API] 原始商品数据:', JSON.stringify(product, null, 2));
    console.log('[OZON API] 图片字段检查:', {
      images: product.images,
      primary_image: product.primary_image,
      image: product.image,
      pictures: product.pictures,
      photos: product.photos
    });

    const attrs = product.attributes || [];
    const findAttr = (key: string) => {
      const attr = attrs.find((a: any) => a.key == key);
      return attr ? attr.value : null;
    };

    const dimensions = {
      weight: findAttr('4497'),   // 重量（克）
      length: findAttr('9454'),   // 长度（毫米）- 对应后端的 length 字段
      width: findAttr('9455'),    // 宽度（毫米）
      height: findAttr('9456')    // 高度（毫米）
    };

    // 返回单个商品对象 + dimensions
    const baseData = {
      ...product,
      title: product.name,  // OZON Seller API 字段是 name，统一为 title
      dimensions: dimensions
    };

    console.log('[OZON API] Seller API 基础数据:', baseData);

    // 获取变体数据（从 content script）
    try {
      console.log('[OZON API] 开始获取变体数据...');
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tabs.length === 0 || !tabs[0].id) {
        console.warn('[OZON API] ⚠️ 未找到活动标签页，跳过变体提取');
        return baseData;
      }

      console.log('[OZON API] 向 content script 发送消息...');
      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'EXTRACT_PRODUCT_DATA'
      });

      console.log('[OZON API] 收到 content script 响应:', response);
      console.log('[OZON API] response.success:', response.success);
      console.log('[OZON API] response.data?.variants:', response.data?.variants);

      if (response.success && response.data?.variants) {
        console.log('[OZON API] ✅ 变体数据获取成功:', response.data.variants.length, '个变体');
        console.log('[OZON API] 第一个变体数据:', response.data.variants[0]);
        return {
          ...baseData,
          variants: response.data.variants,
          has_variants: response.data.has_variants
        };
      } else {
        console.warn('[OZON API] ⚠️ 变体提取失败或无变体:', response.error || '未知原因');
        return baseData;
      }
    } catch (error: any) {
      console.warn('[OZON API] ⚠️ 调用 content script 失败:', error.message);
      return baseData;
    }
  } catch (error: any) {
    console.error('[OZON API] 获取商品详情失败:', error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('网络连接失败，请检查网络');
    } else {
      throw error;
    }
  }
}

// ========== 上品帮销售数据 API ==========

/**
 * 将上品帮API原始数据转换为标准格式
 */
function transformSpbData(rawData: any): any {
  if (!rawData) return null;

  console.log('[上品帮数据转换] 开始转换，原始数据:', rawData);

  // 从 volume 字段解析尺寸（如果可能的话，上品帮可能没有详细尺寸）
  // volume 是体积（升），无法精确还原长宽高，这里设置为null
  // 实际尺寸可能需要从其他字段获取或设为null

  const transformed = {
    // 销售数据
    monthlySales: rawData.soldCount ?? null,  // 月销量
    monthlySalesAmount: rawData.soldSum ?? rawData.gmvSum ?? null,  // 月销售额
    dailySales: null,  // API未提供
    dailySalesAmount: null,  // API未提供
    salesDynamic: null,  // API未提供

    // 营销分析
    cardViews: rawData.sessionCount ?? null,  // 浏览量（会话数）
    cardAddToCartRate: rawData.convToCart ?? null,  // 加购率
    searchViews: null,  // API未提供
    searchAddToCartRate: rawData.convToCartSearch ?? null,  // 搜索加购率
    clickThroughRate: rawData.convViewToOrder ?? null,  // 点击率（浏览到订单转化）
    promoDays: rawData.daysInPromo ?? null,  // 促销天数
    promoDiscount: rawData.discount ?? null,  // 促销折扣
    promoConversion: null,  // API未提供
    paidPromoDays: null,  // API未提供
    adShare: null,  // API未提供

    // 成交数据
    transactionRate: rawData.convToCart ?? null,  // 成交率（暂用加购率）
    returnCancelRate: rawData.nullableRedemptionRate ?? null,  // 退货取消率

    // 商品基础数据（直接使用上品帮API字段名）
    avgPrice: rawData.avgPrice ?? rawData.minSellerPrice ?? null,  // 平均价格
    weight: rawData.weight ?? null,  // 包装重量（克）
    depth: rawData.depth ?? null,  // 深度/长度（毫米）
    width: rawData.width ?? null,  // 宽度（毫米）
    height: rawData.height ?? null,  // 高度（毫米）
    sellerMode: rawData.salesSchema ?? null,  // 发货模式（FBS/FBO）

    // 跟卖信息
    competitorCount: rawData.sellerCount ?? null,  // 跟卖者数量（卖家数）
    competitorMinPrice: null,  // API未提供

    // 上架信息
    listingDate: rawData.nullableCreateDate ?? rawData.create_time ?? null,  // 上架时间
    listingDays: null,  // 需要计算
    sku: rawData.sku ?? null,  // SKU

    // 额外信息
    category: rawData.category3 ?? rawData.category1 ?? null,  // 类目
    brand: rawData.brand ?? null,  // 品牌
    photo: rawData.photo ?? null,  // 主图 URL
  };

  console.log('[上品帮数据转换] 转换完成:', transformed);
  return transformed;
}

/**
 * 获取上品帮销售数据
 */
async function handleGetSpbSalesData(data: { productSku: string }): Promise<any> {
  const { productSku } = data;

  console.log('[上品帮销售数据] 获取商品销售数据, SKU:', productSku);

  try {
    // 获取配置（包括 token 和账号密码）
    const credentials = await getShangpinbangCredentials();

    if (!credentials) {
      console.warn('[上品帮销售数据] 未配置上品帮账号，返回 null');
      return null;
    }

    console.log('[上品帮销售数据] 已获取凭证, 有Token:', !!credentials.token, ', 手机号:', credentials.phone ? '已配置' : '未配置');

    // 如果没有 token，尝试自动登录
    if (!credentials.token) {
      console.log('[上品帮销售数据] Token 不存在，尝试自动登录...');
      try {
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });
        credentials.token = loginResult.token;
      } catch (error: any) {
        console.error('[上品帮销售数据] 自动登录失败:', error.message);
        return null;
      }
    }

    const requestBody = {
      goodsIds: [productSku],
      token: credentials.token,
      apiType: 'getGoodsInfoByIds',
      is_new: true,
      v: 4
    };

    console.log('[上品帮销售数据] 发送请求:', {
      url: 'https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds',
      body: { ...requestBody, token: credentials.token ? '***' : 'null' }
    });

    const response = await fetch('https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error('[上品帮销售数据] HTTP 错误:', response.status, response.statusText);
      return null;
    }

    const result = await response.json();
    console.log('[上品帮销售数据] API 响应:', { code: result.code, message: result.message, data: result.data });

    // 检测是否为 Token 过期错误
    if (isTokenExpiredError(result)) {
      console.warn('[上品帮销售数据] Token 过期，尝试重新登录...');

      try {
        // 重新登录
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });

        // 重试 API 调用
        const retryResponse = await fetch('https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            goodsIds: [productSku],
            token: loginResult.token,
            apiType: 'getGoodsInfoByIds',
            is_new: true,
            v: 4
          })
        });

        if (!retryResponse.ok) {
          console.error('[上品帮销售数据] 重试失败:', retryResponse.status);
          return null;
        }

        const retryResult = await retryResponse.json();

        if (retryResult.code === 0 && retryResult.data) {
          console.log('[上品帮销售数据] 重试成功，返回数据');
          if (Array.isArray(retryResult.data) && retryResult.data.length > 0) {
            const rawData = retryResult.data[0].data || retryResult.data[0];
            return transformSpbData(rawData);
          } else if (retryResult.data.list && Array.isArray(retryResult.data.list) && retryResult.data.list.length > 0) {
            const rawData = retryResult.data.list[0].data || retryResult.data.list[0];
            return transformSpbData(rawData);
          }
        } else {
          console.warn('[上品帮销售数据] 重试后仍无数据:', retryResult.message);
          return null;
        }
      } catch (loginError: any) {
        console.error('[上品帮销售数据] 重新登录失败:', loginError.message);
        return null;
      }
    }

    // 成功响应：code=0, data[0]（data 是数组）
    if (result.code === 0 && result.data) {
      // 检查 data 是否是数组
      if (Array.isArray(result.data) && result.data.length > 0) {
        console.log('[上品帮销售数据] 获取成功（数组格式）');
        // 实际商品数据在 data[0].data 中
        const rawData = result.data[0].data || result.data[0];
        return transformSpbData(rawData);
      }
      // 检查是否有 data.list 格式（兼容旧格式）
      else if (result.data.list && Array.isArray(result.data.list) && result.data.list.length > 0) {
        console.log('[上品帮销售数据] 获取成功（list格式）');
        const rawData = result.data.list[0].data || result.data.list[0];
        return transformSpbData(rawData);
      }
      // data 既不是数组也没有 list
      else {
        console.warn('[上品帮销售数据] data格式异常，既不是数组也没有list:', result.data);
        return null;
      }
    } else {
      console.warn('[上品帮销售数据] 无数据或code!=0:', { code: result.code, message: result.message });
      return null;
    }
  } catch (error: any) {
    console.error('[上品帮销售数据] 请求失败:', error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      console.error('[上品帮销售数据] 网络连接失败');
      return null;
    } else {
      // 其他错误也静默失败，不影响主功能
      return null;
    }
  }
}

/**
 * 批量获取上品帮销售数据（新增）
 *
 * @param data.productIds - SKU数组（最多50个）
 * @returns 商品数据数组（SpbSalesData[]）
 */
async function handleGetSpbSalesDataBatch(data: { productIds: string[] }): Promise<any[]> {
  const { productIds } = data;

  if (!productIds || productIds.length === 0) {
    console.warn('[上品帮批量销售数据] SKU列表为空');
    return [];
  }

  if (productIds.length > 50) {
    throw new Error('单批次最多支持50个SKU');
  }

  console.log(`[上品帮批量销售数据] 获取 ${productIds.length} 个商品数据`);

  try {
    // 获取配置（包括 token 和账号密码）
    const credentials = await getShangpinbangCredentials();

    if (!credentials) {
      console.warn('[上品帮批量销售数据] 未配置上品帮账号，返回空数组');
      return [];
    }

    // 如果没有 token，尝试自动登录
    if (!credentials.token) {
      console.log('[上品帮批量销售数据] Token 不存在，尝试自动登录...');
      try {
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });
        credentials.token = loginResult.token;
      } catch (error: any) {
        console.error('[上品帮批量销售数据] 自动登录失败:', error.message);
        return [];
      }
    }

    const requestBody = {
      goodsIds: productIds,  // 支持批量（最多50个）
      token: credentials.token,
      apiType: 'getGoodsInfoByIds',
      is_new: true,
      v: 4
    };

    console.log('[上品帮批量销售数据] 发送请求:', {
      url: 'https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds',
      goodsCount: productIds.length
    });

    const response = await fetch('https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error('[上品帮批量销售数据] HTTP 错误:', response.status, response.statusText);
      return [];
    }

    const result = await response.json();
    console.log('[上品帮批量销售数据] API 响应:', { code: result.code, message: result.message, dataCount: result.data?.length });

    // 检测是否为 Token 过期错误
    if (isTokenExpiredError(result)) {
      console.warn('[上品帮批量销售数据] Token 过期，尝试重新登录并重试...');

      try {
        // 重新登录
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });

        // 重试 API 调用
        const retryResponse = await fetch('https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            goodsIds: productIds,
            token: loginResult.token,
            apiType: 'getGoodsInfoByIds',
            is_new: true,
            v: 4
          })
        });

        if (!retryResponse.ok) {
          console.error('[上品帮批量销售数据] 重试失败:', retryResponse.status);
          return [];
        }

        const retryResult = await retryResponse.json();

        if (retryResult.code === 0 && retryResult.data && Array.isArray(retryResult.data)) {
          console.log(`[上品帮批量销售数据] 重试成功，返回 ${retryResult.data.length} 个商品数据`);
          return retryResult.data.map((item: any) => {
            const rawData = item.data || item;
            return transformSpbData(rawData);
          });
        } else {
          console.warn('[上品帮批量销售数据] 重试后仍无数据:', retryResult.message);
          return [];
        }
      } catch (loginError: any) {
        console.error('[上品帮批量销售数据] 重新登录失败:', loginError.message);
        return [];
      }
    }

    // 成功响应：code=0, data是数组
    if (result.code === 0 && result.data && Array.isArray(result.data)) {
      console.log(`[上品帮批量销售数据] 获取成功，共 ${result.data.length} 个商品`);

      // 转换所有商品数据
      return result.data.map((item: any, index: number) => {
        const rawData = item.data || item;

        // 调试：输出第一条原始数据的包装信息
        if (index === 0) {
          console.log('[上品帮DEBUG] 第一条原始数据的包装字段:', {
            weight: rawData.weight,
            depth: rawData.depth,
            width: rawData.width,
            height: rawData.height,
            // 完整的rawData前20个键
            allKeys: Object.keys(rawData).slice(0, 20)
          });
        }

        return transformSpbData(rawData);
      });
    } else {
      console.warn('[上品帮批量销售数据] 无数据或code!=0:', { code: result.code, message: result.message });
      return [];
    }
  } catch (error: any) {
    console.error('[上品帮批量销售数据] 请求失败:', error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      console.error('[上品帮批量销售数据] 网络连接失败');
      return [];
    } else {
      // 其他错误也静默失败，不影响主功能
      return [];
    }
  }
}

/**
 * 批量获取上品帮佣金数据（新增）
 *
 * @param data.goods - 商品数组 [{ goods_id, category_name }]
 * @returns 佣金数据数组
 */
async function handleGetGoodsCommissionsBatch(data: { goods: Array<{ goods_id: string; category_name: string }> }): Promise<any[]> {
  const { goods } = data;

  if (!goods || goods.length === 0) {
    console.warn('[上品帮批量佣金] 商品列表为空');
    return [];
  }

  console.log(`[上品帮批量佣金] 获取 ${goods.length} 个商品佣金数据`);

  try {
    // 获取配置（包括 token 和账号密码）
    const credentials = await getShangpinbangCredentials();

    if (!credentials) {
      console.warn('[上品帮批量佣金] 未配置上品帮账号，返回空数组');
      return [];
    }

    // 如果没有 token，尝试自动登录
    if (!credentials.token) {
      console.log('[上品帮批量佣金] Token 不存在，尝试自动登录...');
      try {
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });
        credentials.token = loginResult.token;
      } catch (error: any) {
        console.error('[上品帮批量佣金] 自动登录失败:', error.message);
        return [];
      }
    }

    const requestBody = {
      token: credentials.token,
      apiType: 'getGoodsCommissions',
      goods: goods  // [{ goods_id, category_name }]
    };

    console.log('[上品帮批量佣金] 请求:', { goodsCount: goods.length });

    // ⚠️ 正确的URL：https://api.shopbang.cn/ozonMallSale/（不是plus域名）
    const response = await fetch('https://api.shopbang.cn/ozonMallSale/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error('[上品帮批量佣金] HTTP 错误:', response.status, response.statusText);
      return [];
    }

    const result = await response.json();
    console.log('[上品帮批量佣金] API 响应:', { code: result.code, message: result.message, dataCount: result.data?.length });

    // 检测是否为 Token 过期错误
    if (isTokenExpiredError(result)) {
      console.warn('[上品帮批量佣金] Token 过期，尝试重新登录...');

      try {
        // 重新登录
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });

        // 重试 API 调用
        const retryResponse = await fetch('https://api.shopbang.cn/ozonMallSale/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: loginResult.token,
            apiType: 'getGoodsCommissions',
            goods: goods
          })
        });

        if (!retryResponse.ok) {
          console.error('[上品帮批量佣金] 重试失败:', retryResponse.status);
          return [];
        }

        const retryResult = await retryResponse.json();

        if (retryResult.code === 0 && retryResult.data && Array.isArray(retryResult.data)) {
          console.log(`[上品帮批量佣金] 重试成功，共 ${retryResult.data.length} 个商品`);
          return retryResult.data;
        } else {
          console.warn('[上品帮批量佣金] 重试后仍无数据:', retryResult.message);
          return [];
        }
      } catch (loginError: any) {
        console.error('[上品帮批量佣金] 重新登录失败:', loginError.message);
        return [];
      }
    }

    // 成功响应：code=0, data是数组
    if (result.code === 0 && result.data && Array.isArray(result.data)) {
      console.log(`[上品帮批量佣金] 获取成功，共 ${result.data.length} 个商品`);
      return result.data;
    } else {
      console.warn('[上品帮批量佣金] 无数据或code!=0:', { code: result.code, message: result.message });
      return [];
    }
  } catch (error: any) {
    console.error('[上品帮批量佣金] 请求失败:', error);
    return [];
  }
}

/**
 * 批量获取 OZON 跟卖数据（新增）
 *
 * @param data.productIds - SKU数组
 * @returns 跟卖数据数组 [{ goods_id, gm, gmGoodsIds, gmArr }]
 */
async function handleGetFollowSellerDataBatch(data: { productIds: string[] }): Promise<any[]> {
  const { productIds } = data;

  if (!productIds || productIds.length === 0) {
    console.warn('[OZON跟卖数据] SKU列表为空');
    return [];
  }

  console.log(`[OZON跟卖数据] 获取 ${productIds.length} 个商品跟卖数据`);

  const results: any[] = [];

  // 使用全局OZON API限流器
  const limiter = OzonApiRateLimiter.getInstance();

  // 【关键修复】获取 www.ozon.ru 的所有 Cookie（Service Worker 中 credentials: 'include' 不起作用）
  const ozonCookies = await chrome.cookies.getAll({ domain: '.ozon.ru' });
  const cookieString = ozonCookies.map(c => `${c.name}=${c.value}`).join('; ');

  console.log(`[OZON跟卖数据] Cookie 长度: ${cookieString.length} 字符`);

  for (const productId of productIds) {
    try {
      const origin = 'https://www.ozon.ru';
      const encodedUrl = encodeURIComponent(`/modal/otherOffersFromSellers?product_id=${productId}&page_changed=true`);
      // 【路径策略】www.ozon.ru/api/entrypoint-api.bx/* → 需要经过内部网关（模拟官方请求）
      const apiUrl = `${origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`;

      // 使用标准headers + composer 服务标识 + 限流器（避免触发限流）
      const baseHeaders = await getOzonStandardHeaders({
        referer: `https://www.ozon.ru/product/${productId}/`,
        serviceName: 'composer'  // 【Phase 4】添加服务名称，模拟 OZON 官方的内部网关调用
      });

      // 【关键修复】显式添加 Cookie header
      const headers = {
        ...baseHeaders,
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      };

      const response = await limiter.execute(() =>
        fetch(apiUrl, {
          method: 'GET',
          headers
          // 移除 credentials: 'include'，因为在 Service Worker 中不起作用
        })
      );

      if (!response.ok) {
        console.warn(`[OZON跟卖数据] SKU=${productId} HTTP错误: ${response.status}`);
        results.push({ goods_id: productId, gm: 0, gmGoodsIds: [], gmArr: [] });
        continue;
      }

      const data = await response.json();
      const widgetStates = data.widgetStates || {};

      // 查找包含 "webSellerList" 的 key
      const sellerListKey = Object.keys(widgetStates).find(key => key.includes('webSellerList'));

      if (!sellerListKey || !widgetStates[sellerListKey]) {
        console.log(`[OZON跟卖数据] SKU=${productId} 无跟卖商家`);
        results.push({ goods_id: productId, gm: 0, gmGoodsIds: [], gmArr: [] });
        continue;
      }

      const sellerListData = JSON.parse(widgetStates[sellerListKey]);
      const sellers = sellerListData.sellers || [];

      if (sellers.length === 0) {
        console.log(`[OZON跟卖数据] SKU=${productId} 无跟卖商家`);
        results.push({ goods_id: productId, gm: 0, gmGoodsIds: [], gmArr: [] });
        continue;
      }

      // 提取跟卖价格并解析（处理欧洲格式：2 189,50 → 2189.50）
      sellers.forEach((seller: any) => {
        let priceStr = seller.price?.cardPrice?.price || seller.price?.price || '';
        // 1. 移除空格（千位分隔符）
        // 2. 替换逗号为点（小数分隔符）
        // 3. 移除其他非数字字符（₽等）
        priceStr = priceStr.replace(/\s/g, '').replace(/,/g, '.').replace(/[^\d.]/g, '');
        seller.priceNum = isNaN(parseFloat(priceStr)) ? 99999999 : parseFloat(priceStr);
      });

      // 按价格排序
      sellers.sort((a: any, b: any) => a.priceNum - b.priceNum);

      results.push({
        goods_id: productId,
        gm: sellers.length,
        gmGoodsIds: sellers.map((s: any) => s.sku),
        gmArr: sellers.map((s: any) => s.priceNum)
      });

      console.log(`[OZON跟卖数据] SKU=${productId} 跟卖商家数: ${sellers.length}`);

    } catch (error: any) {
      console.error(`[OZON跟卖数据] SKU=${productId} 获取失败:`, error.message);
      results.push({ goods_id: productId, gm: 0, gmGoodsIds: [], gmArr: [] });
    }

    // 批次间延迟（至少100ms，避免限流）
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`[OZON跟卖数据] 总计获取 ${results.length}/${productIds.length} 个商品数据`);
  return results;
}

// ✅ handleGetFollowSellerDataSingle 已移到 Content Script（additional-data-client.ts）
// 原因：在 Content Script 中直接 fetch，请求会显示在网络面板，避免被识别为爬虫

/**
 * 获取上品帮佣金数据
 */
async function handleGetSpbCommissions(data: { price: number; categoryId: string }): Promise<any> {
  const { price, categoryId } = data;

  console.log('[上品帮佣金] 获取佣金数据, 价格:', price, ', 类目ID:', categoryId);

  try {
    // 获取配置（包括 token 和账号密码）
    const credentials = await getShangpinbangCredentials();

    if (!credentials) {
      console.warn('[上品帮佣金] 未配置上品帮账号，返回 null');
      return null;
    }

    // 如果没有 token，尝试自动登录
    if (!credentials.token) {
      console.log('[上品帮佣金] Token 不存在，尝试自动登录...');
      try {
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });
        credentials.token = loginResult.token;
      } catch (error: any) {
        console.error('[上品帮佣金] 自动登录失败:', error.message);
        return null;
      }
    }

    const response = await fetch('https://api.shopbang.cn/ozonMallSale/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: credentials.token,
        apiType: 'getGoodsCommissions',
        goods: [
          {
            price: price,
            categoryId: categoryId
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('[上品帮佣金] HTTP 错误:', response.status, response.statusText);
      return null;
    }

    const result = await response.json();
    console.log('[上品帮佣金] API 响应:', { code: result.code, message: result.message });

    // 检测是否为 Token 过期错误
    if (isTokenExpiredError(result)) {
      console.warn('[上品帮佣金] Token 过期，尝试重新登录...');

      try {
        // 重新登录
        const loginResult = await handleShangpinbangLogin({
          phone: credentials.phone,
          password: credentials.password
        });

        // 重试 API 调用
        const retryResponse = await fetch('https://api.shopbang.cn/ozonMallSale/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: loginResult.token,
            apiType: 'getGoodsCommissions',
            goods: [
              {
                price: price,
                categoryId: categoryId
              }
            ]
          })
        });

        if (!retryResponse.ok) {
          console.error('[上品帮佣金] 重试失败:', retryResponse.status);
          return null;
        }

        const retryResult = await retryResponse.json();

        if (retryResult.code === 0 && retryResult.data && retryResult.data.length > 0) {
          console.log('[上品帮佣金] 重试成功，返回数据');
          return retryResult.data[0];
        } else {
          console.warn('[上品帮佣金] 重试后仍无数据:', retryResult.message);
          return null;
        }
      } catch (loginError: any) {
        console.error('[上品帮佣金] 重新登录失败:', loginError.message);
        return null;
      }
    }

    // 成功响应：code=0, data[0]
    if (result.code === 0 && result.data && result.data.length > 0) {
      console.log('[上品帮佣金] 获取成功');
      return result.data[0];
    } else {
      console.warn('[上品帮佣金] 无数据或格式异常:', result);
      return null;
    }
  } catch (error: any) {
    console.error('[上品帮佣金] 请求失败:', error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      console.error('[上品帮佣金] 网络连接失败');
      return null;
    } else {
      // 其他错误也静默失败，不影响主功能
      return null;
    }
  }
}

// ========== 并发获取所有商品数据 ==========

/**
 * 并发获取所有商品数据（OZON + 上品帮 + OZON Seller + EuraFlow配置）
 */
async function handleFetchAllProductData(data: { url: string; productSku: string; cookieString?: string }): Promise<any> {
  const { url, productSku, cookieString } = data;

  console.log('[商品数据] 开始并发获取所有数据, URL:', url, 'ProductSKU:', productSku);
  if (cookieString) {
    console.log('[商品数据] 接收到页面 Cookie, 长度:', cookieString.length);
  }

  // 1. 检查缓存
  const cached = productDataCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('[商品数据] 使用缓存数据');
    return {
      ozonProduct: cached.ozonProduct,
      spbSales: cached.spbSales,
      dimensions: cached.dimensions,
      euraflowConfig: cached.euraflowConfig
    };
  }

  // 2. 并发获取4类数据
  const [ozonProduct, spbSales, euraflowConfig] = await Promise.all([
    handleGetOzonProductDetail({ productSku, cookieString }).catch(err => {
      console.error('[商品数据] OZON产品数据获取失败:', err);
      return null;
    }),
    handleGetSpbSalesData({ productSku }).catch(err => {
      console.error('[商品数据] 上品帮销售数据获取失败:', err);
      return null;
    }),
    getEuraflowConfig().catch(err => {
      console.error('[商品数据] EuraFlow配置获取失败:', err);
      return null;
    })
  ]);

  // 3. 从 ozonProduct 中提取 dimensions（与列表页保持一致）
  const dimensions = ozonProduct?.dimensions || null;

  // 4. 存储到缓存
  productDataCache.set(url, {
    url,
    ozonProduct,
    spbSales,
    dimensions,
    euraflowConfig,
    timestamp: Date.now()
  });

  console.log('[商品数据] 最终数据:', {
    ozonProduct,
    spbSales,
    dimensions,
    euraflowConfig
  });

  // 5. 返回数据
  return {
    ozonProduct,
    spbSales,
    dimensions,
    euraflowConfig
  };
}

/**
 * 获取 EuraFlow 配置
 */
async function getEuraflowConfig(): Promise<any> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiUrl', 'apiKey'], (result) => {
      if (!result.apiUrl || !result.apiKey) {
        resolve(null);
        return;
      }

      // 这里可以并发获取店铺、仓库、水印配置
      // 暂时返回 API 配置
      resolve({
        apiUrl: result.apiUrl,
        apiKey: result.apiKey
      });
    });
  });
}

// 导出类型（供TypeScript使用）
export {};
