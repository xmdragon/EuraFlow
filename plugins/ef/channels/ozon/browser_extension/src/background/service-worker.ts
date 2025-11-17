/**
 * 后台服务工作线程
 *
 * 负责：
 * 1. 监听扩展安装和更新事件
 * 2. 处理跨域API请求
 * 3. 管理扩展状态
 */

// 监听扩展安装
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {

  if (details.reason === 'install' || details.reason === 'update') {
    // 首次安装或更新：确保默认配置存在
    chrome.storage.sync.get(['targetCount', 'scrollDelay', 'scrollWaitTime'], (result) => {
      const updates: { [key: string]: any } = {};

      // 只设置缺失的配置项
      if (result.targetCount === undefined) {
        updates.targetCount = 100;
      }
      if (result.scrollDelay === undefined) {
        updates.scrollDelay = 5000;
      }
      if (result.scrollWaitTime === undefined) {
        updates.scrollWaitTime = 1000;
      }

      // 如果有缺失项，更新存储
      if (Object.keys(updates).length > 0) {
        chrome.storage.sync.set(updates);
      }
    });
  }
});

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {


  if (message.type === 'UPLOAD_PRODUCTS') {
    // 处理商品数据上传
    handleUploadProducts(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // 保持消息通道开启（异步响应）
  }

  if (message.type === 'TEST_CONNECTION') {
    // 测试API连接
    handleTestConnection(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'GET_CONFIG') {
    // 获取一键上架所需的所有配置（店铺+仓库+水印）
    handleGetConfig(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'QUICK_PUBLISH') {
    // 快速上架商品
    handleQuickPublish(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'QUICK_PUBLISH_BATCH') {
    // 批量上架商品（多个变体）
    handleQuickPublishBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'GET_TASK_STATUS') {
    // 查询任务状态
    handleGetTaskStatus(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'COLLECT_PRODUCT') {
    // 采集商品
    handleCollectProduct(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'SPB_LOGIN') {
    // 上品帮登录
    handleShangpinbangLogin(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'SPB_GET_TOKEN') {
    // 获取上品帮Token
    handleGetShangpinbangToken()
      .then(token => sendResponse({ success: true, data: { token } }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'SPB_API_CALL') {
    // 调用上品帮 API（支持自动 Token 刷新）
    handleShangpinbangAPICall(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  if (message.type === 'GET_OZON_PRODUCT_DETAIL') {
    // 获取 OZON 商品详情
    handleGetOzonProductDetail(message.data)
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

    // 处理不同类型的错误
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
      // 多层级解析错误信息
      if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.detail) {
        errorMessage = errorData.detail.detail;
      } else if (errorData.detail && typeof errorData.detail === 'string') {
        errorMessage = errorData.detail;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      errorMessage = `服务器错误 (HTTP ${response.status})`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
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
  if (responseData.code !== -1) {
    return false;
  }

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

  // 调用 API
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
 * 获取 OZON Seller 的所有 Cookie
 * 参考 spbang 插件的实现：使用 .ozon.ru 域名 + partitionKey
 */
async function getOzonSellerCookies(): Promise<string> {
  console.log('[OZON API] ========== 开始读取 OZON Cookie ==========');

  try {
    // 1. 尝试多种域名格式
    const domains = ['.ozon.ru', 'ozon.ru', '.seller.ozon.ru', 'seller.ozon.ru'];
    let allCookies: chrome.cookies.Cookie[] = [];

    for (const domain of domains) {
      const cookies = await chrome.cookies.getAll({ domain });
      console.log(`[OZON API] 从 ${domain} 获取到 ${cookies.length} 个 Cookie`);
      if (cookies.length > 0) {
        console.log(`[OZON API] Cookie 名称:`, cookies.map(c => c.name).join(', '));
        allCookies = allCookies.concat(cookies);
      }
    }

    // 2. 等待 2 秒（让 Cookie 加载完成）
    console.log('[OZON API] 等待 2 秒...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. 尝试获取分区 Cookie（带 partitionKey）
    console.log('[OZON API] 尝试获取分区 Cookie...');
    const partitionKey: any = { topLevelSite: 'https://www.ozon.ru' };
    try {
      const partitionedCookies = await chrome.cookies.getAll({
        domain: '.ozon.ru',
        partitionKey
      } as any);
      console.log(`[OZON API] 从 .ozon.ru (partitionKey) 获取到 ${partitionedCookies.length} 个分区 Cookie`);

      const validPartitionedCookie = partitionedCookies.find(
        (cookie: any) => cookie.partitionKey && cookie.partitionKey.hasCrossSiteAncestor === false
      );

      if (validPartitionedCookie) {
        console.log(`[OZON API] 找到有效的分区 Cookie: ${validPartitionedCookie.name}`);
        allCookies.push(validPartitionedCookie);
      }
    } catch (error) {
      console.log('[OZON API] 不支持 partitionKey 或获取失败:', error);
    }

    // 4. 检查是否获取到 Cookie
    console.log(`[OZON API] 总共获取到 ${allCookies.length} 个 Cookie`);

    if (allCookies.length === 0) {
      console.error('[OZON API] ========== 错误：未找到任何 OZON Cookie ==========');
      console.error('[OZON API] 请按以下步骤排查：');
      console.error('[OZON API] 1. 在新标签页打开 https://seller.ozon.ru 并登录');
      console.error('[OZON API] 2. 按 F12 打开控制台，输入 document.cookie 查看是否有 Cookie');
      console.error('[OZON API] 3. 在 chrome://extensions/ 页面点击扩展的刷新按钮');
      console.error('[OZON API] 4. 重新访问商品页面');
      throw new Error('未找到 OZON Cookie，请先登录 OZON Seller 后台并重新加载扩展');
    }

    // 5. 去重并拼接 Cookie 字符串
    const uniqueCookies = Array.from(
      new Map(allCookies.map(c => [c.name, c])).values()
    );

    const cookieString = uniqueCookies
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');

    console.log(`[OZON API] ========== 成功获取 ${uniqueCookies.length} 个有效 Cookie ==========`);
    console.log(`[OZON API] Cookie 前10个: ${uniqueCookies.map(c => c.name).slice(0, 10).join(', ')}`);

    return cookieString;

  } catch (error: any) {
    console.error('[OZON API] Cookie 读取失败:', error);
    throw error;
  }
}

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
    console.log(`[OZON API] 从 sc_company_id 提取到 Seller ID: ${sellerId}`);
    return sellerId;
  }

  // 2. 尝试匹配 contentId=数字（备用方案）
  match = cookieString.match(/contentId=(\d+)/);
  if (match && match[1]) {
    const sellerId = parseInt(match[1], 10);
    console.log(`[OZON API] 从 contentId 提取到 Seller ID: ${sellerId}`);
    return sellerId;
  }

  // 3. 都没有找到，抛出错误
  console.error('[OZON API] Cookie 内容:', cookieString.substring(0, 200) + '...');
  console.error('[OZON API] 未找到 sc_company_id 或 contentId');
  console.error('[OZON API] 请确认已登录 OZON Seller 后台');
  throw new Error('未找到 OZON Seller ID，请先登录 OZON Seller 后台');
}

/**
 * 处理获取 OZON 商品详情请求
 */
async function handleGetOzonProductDetail(data: { productSku: string }) {
  const { productSku } = data;

  console.log('[OZON API] 获取商品详情, SKU:', productSku);

  try {
    // 1. 获取 OZON Seller Cookie
    const cookieString = await getOzonSellerCookies();

    // 2. 从 Cookie 字符串中提取 Seller ID
    const sellerId = await getOzonSellerId(cookieString);

    // 3. 调用 OZON search-variant-model API（参考 spbang 的 headers）
    const response = await fetch('https://seller.ozon.ru/api/v1/search-variant-model', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieString,
        'x-o3-company-id': sellerId.toString(),
        'x-o3-app-name': 'seller-ui',
        'x-o3-language': 'zh-Hans',
        'x-o3-page-type': 'products-other',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        limit: '10',
        name: productSku
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[OZON API] 获取商品详情成功, 商品数:', result.items?.length || 0);

    // 4. 提取尺寸和重量（如果存在）
    if (result.items && result.items.length > 0) {
      const attrs = result.items[0].attributes || [];
      const findAttr = (key: string) => {
        const attr = attrs.find((a: any) => a.key == key);
        return attr ? attr.value : null;
      };

      const dimensions = {
        weight: findAttr('4497'),   // 重量（克）
        depth: findAttr('9454'),    // 深度（毫米）
        width: findAttr('9455'),    // 宽度（毫米）
        height: findAttr('9456')    // 高度（毫米）
      };

      console.log('[OZON API] 尺寸和重量:', dimensions);

      // 将尺寸信息附加到结果中
      return {
        ...result,
        dimensions: dimensions
      };
    }

    return result;
  } catch (error: any) {
    console.error('[OZON API] 获取商品详情失败:', error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('网络连接失败，请检查网络');
    } else {
      throw error;
    }
  }
}

// 导出类型（供TypeScript使用）
export {};
