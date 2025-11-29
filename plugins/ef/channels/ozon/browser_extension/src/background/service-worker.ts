/**
 * Service Worker - 浏览器扩展后台服务
 *
 * 职责：
 * - 处理跨域 API 请求（OZON Seller、上品帮、EuraFlow）
 * - OZON 版本信息动态拦截
 * - 商品数据缓存
 */

// 导入统一 API 客户端
import {
  getOzonSellerApi,
  getOzonBuyerApi,
  getSpbangApi,
  createEuraflowApi,
  type SpbSalesData
} from '../shared/api';

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
  }
});

// ============================================================================
// 全局商品数据缓存（5分钟有效期）
// ============================================================================

interface GlobalProductData {
  url: string;
  ozonProduct: any;
  spbSales: any | null;
  euraflowConfig: any | null;
  timestamp: number;
}

const productDataCache = new Map<string, GlobalProductData>();
const CACHE_DURATION = 5 * 60 * 1000;

// ============================================================================
// 扩展安装/更新事件
// ============================================================================

chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  if (details.reason === 'install' || details.reason === 'update') {
    chrome.storage.sync.get(['targetCount'], (result) => {
      if (result.targetCount === undefined) {
        chrome.storage.sync.set({ targetCount: 100 });
      }
    });
  }
});

// ============================================================================
// 消息处理器
// ============================================================================

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {

  // EuraFlow API
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

  // 上品帮 API
  if (message.type === 'SPB_LOGIN') {
    handleSpbLogin(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'SPB_GET_TOKEN') {
    handleGetSpbToken()
      .then(token => sendResponse({ success: true, data: { token } }))
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
    handleGetCommissionsBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_SPB_COMMISSIONS') {
    handleGetSpbCommissions(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // OZON Seller API
  if (message.type === 'GET_OZON_PRODUCT_DETAIL') {
    handleGetOzonProductDetail(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'REFRESH_SELLER_TAB') {
    handleRefreshSellerTab()
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // OZON Buyer API
  if (message.type === 'GET_FOLLOW_SELLER_DATA_BATCH') {
    handleGetFollowSellerDataBatch(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_OZON_PRODUCTS_PAGE') {
    handleGetOzonProductsPage(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 综合数据获取
  if (message.type === 'FETCH_ALL_PRODUCT_DATA') {
    handleFetchAllProductData(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// ============================================================================
// EuraFlow API 处理函数
// ============================================================================

async function handleUploadProducts(data: { apiUrl: string; apiKey: string; products: any[] }) {
  const { apiUrl, apiKey, products } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.uploadProducts(products);
}

async function handleTestConnection(data: { apiUrl: string; apiKey: string }) {
  const { apiUrl, apiKey } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.testConnection();
}

async function handleGetConfig(data: { apiUrl: string; apiKey: string }) {
  const { apiUrl, apiKey } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.getConfig();
}

async function handleQuickPublish(data: { apiUrl: string; apiKey: string; data: any }) {
  const { apiUrl, apiKey, data: publishData } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.quickPublish(publishData);
}

async function handleQuickPublishBatch(data: { apiUrl: string; apiKey: string; data: any }) {
  const { apiUrl, apiKey, data: publishData } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.quickPublishBatch(publishData);
}

async function handleGetTaskStatus(data: { apiUrl: string; apiKey: string; taskId: string; shopId?: number }) {
  const { apiUrl, apiKey, taskId, shopId } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.getTaskStatus(taskId, shopId);
}

async function handleCollectProduct(data: { apiUrl: string; apiKey: string; source_url: string; product_data: any }) {
  const { apiUrl, apiKey, source_url, product_data } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.collectProduct(source_url, product_data);
}

// ============================================================================
// 上品帮 API 处理函数
// ============================================================================

async function handleSpbLogin(data: { phone: string; password: string }) {
  const { phone, password } = data;
  const api = getSpbangApi();
  const token = await api.login(phone, password);
  return { success: true, token, message: '登录成功' };
}

async function handleGetSpbToken(): Promise<string | undefined> {
  const api = getSpbangApi();
  const token = await api.getToken();
  return token || undefined;
}

async function handleGetSpbSalesData(data: { productSku: string }): Promise<SpbSalesData | null> {
  const { productSku } = data;
  const api = getSpbangApi();
  return api.getSalesData(productSku);
}

async function handleGetSpbSalesDataBatch(data: { productIds: string[] }): Promise<SpbSalesData[]> {
  const { productIds } = data;

  if (!productIds || productIds.length === 0) {
    return [];
  }

  if (productIds.length > 50) {
    throw new Error('单批次最多支持50个SKU');
  }

  const api = getSpbangApi();
  const resultsMap = await api.getSalesDataBatch(productIds);

  // 转换 Map 为数组（保持原接口兼容）
  const results: SpbSalesData[] = [];
  resultsMap.forEach((data, sku) => {
    results.push({ ...data, sku });
  });

  return results;
}

async function handleGetCommissionsBatch(data: { goods: Array<{ goods_id: string; category_name: string }> }): Promise<any[]> {
  const { goods } = data;

  if (!goods || goods.length === 0) {
    return [];
  }

  const api = getSpbangApi();
  const resultsMap = await api.getCommissionsBatch(goods);

  // 转换 Map 为数组
  const results: any[] = [];
  resultsMap.forEach((data, _sku) => {
    results.push(data);
  });

  return results;
}

async function handleGetSpbCommissions(data: { price: number; categoryId: string }): Promise<any> {
  const { categoryId } = data;

  const api = getSpbangApi();
  const resultsMap = await api.getCommissionsBatch([{
    goods_id: 'temp',
    category_name: categoryId
  }]);

  if (resultsMap.size > 0) {
    return resultsMap.values().next().value;
  }
  return null;
}

// ============================================================================
// OZON Seller API 处理函数
// ============================================================================

async function handleGetOzonProductDetail(data: { productSku: string; cookieString?: string }) {
  const { productSku, cookieString } = data;
  const api = getOzonSellerApi();
  return api.searchVariantModel(productSku, cookieString);
}

async function handleRefreshSellerTab() {
  const api = getOzonSellerApi();
  return api.refreshSellerTab();
}

// ============================================================================
// OZON Buyer API 处理函数
// ============================================================================

async function handleGetFollowSellerDataBatch(data: { productIds: string[] }): Promise<any[]> {
  const { productIds } = data;

  if (!productIds || productIds.length === 0) {
    return [];
  }

  const api = getOzonBuyerApi();
  const resultsMap = await api.getFollowSellerDataBatch(productIds);

  // 转换为原接口格式
  const results: any[] = [];
  productIds.forEach(productId => {
    const data = resultsMap.get(productId);
    if (data) {
      results.push({
        goods_id: productId,
        gm: data.count,
        gmGoodsIds: data.skus,
        gmArr: data.prices
      });
    } else {
      results.push({
        goods_id: productId,
        gm: 0,
        gmGoodsIds: [],
        gmArr: []
      });
    }
  });

  return results;
}

async function handleGetOzonProductsPage(data: { pageUrl: string; page: number }): Promise<any[]> {
  const { pageUrl, page } = data;
  const api = getOzonBuyerApi();
  return api.getProductsPage(pageUrl, page);
}

// ============================================================================
// 综合数据获取
// ============================================================================

async function handleFetchAllProductData(data: {
  url: string;
  productSku: string;
  productDetail: any;
  ratingData?: { rating: number | null; reviewCount: number | null };
}): Promise<any> {
  const { url, productSku, productDetail, ratingData } = data;

  // 数据完整性检查
  if (!productDetail) {
    throw new Error('Content Script 未传递 productDetail，数据采集失败');
  }

  // 1. 检查缓存
  const cached = productDataCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return {
      ozonProduct: cached.ozonProduct,
      spbSales: cached.spbSales,
      euraflowConfig: cached.euraflowConfig
    };
  }

  // 2. 并发获取辅助数据
  const spbangApi = getSpbangApi();
  const buyerApi = getOzonBuyerApi();

  const [spbSalesData, euraflowConfig] = await Promise.all([
    spbangApi.getSalesData(productSku).then(data => {
      if (__DEBUG__) {
        console.log('[商品数据] 上品帮返回:', data ? '有数据' : '无数据', data);
      }
      return data;
    }).catch(err => {
      console.error('[商品数据] 上品帮销售数据获取失败:', err.message);
      return null;
    }),
    getEuraflowConfig().catch(err => {
      console.error('[商品数据] EuraFlow配置获取失败:', err.message);
      return null;
    })
  ]);

  // 初始化 spbSales 对象（即使上品帮没数据也需要存储 OZON 数据）
  let spbSales: any = spbSalesData || {};

  // 2.5 获取佣金数据（独立接口，不依赖销售数据是否存在）
  const hasCommissions = spbSales.rfbsCommissionMid != null || spbSales.fbpCommissionMid != null;
  if (!hasCommissions) {
    try {
      // 类目名称：优先从销售数据获取，否则用"未知类目"
      const categoryName = spbSales.category || '未知类目';
      const commissionsMap = await spbangApi.getCommissionsBatch([
        { goods_id: productSku, category_name: categoryName }
      ]);

      const commissionData = commissionsMap.get(productSku);
      if (commissionData) {
        spbSales.rfbsCommissionLow = commissionData.rfbs_small ?? null;
        spbSales.rfbsCommissionMid = commissionData.rfbs ?? null;
        spbSales.rfbsCommissionHigh = commissionData.rfbs_large ?? null;
        spbSales.fbpCommissionLow = commissionData.fbp_small ?? null;
        spbSales.fbpCommissionMid = commissionData.fbp ?? null;
        spbSales.fbpCommissionHigh = commissionData.fbp_large ?? null;
        if (__DEBUG__) {
          console.log('[商品数据] 佣金数据:', commissionData);
        }
      }
    } catch (err: any) {
      console.error('[商品数据] 佣金数据获取失败:', err.message);
    }
  }

  // 2.6 获取跟卖数据（从 OZON Buyer API，不依赖上品帮）
  const hasFollowSeller = spbSales.competitorCount != null;
  if (!hasFollowSeller) {
    try {
      const followSellerMap = await buyerApi.getFollowSellerDataBatch([productSku]);
      const followData = followSellerMap.get(productSku);
      if (followData) {
        spbSales.competitorCount = followData.count ?? null;
        spbSales.followSellerSkus = followData.skus ?? [];
        spbSales.followSellerPrices = followData.prices ?? [];
        if (__DEBUG__) {
          console.log('[商品数据] OZON跟卖数据:', followData);
        }
      }
    } catch (err: any) {
      console.error('[商品数据] 跟卖数据获取失败:', err.message);
    }
  }

  // 2.7 合并页面提取的评分数据
  if (ratingData) {
    if (ratingData.rating != null) {
      spbSales.rating = ratingData.rating;
    }
    if (ratingData.reviewCount != null) {
      spbSales.reviewCount = ratingData.reviewCount;
    }
  }

  // 2.8 补充缺失的类目名称（通过 EuraFlow API）
  const hasCategory1 = spbSales.category1 != null;
  const hasCategory2 = spbSales.category2 != null;
  const hasCategory3 = spbSales.category3 != null;

  // 如果有缺失的类目名称，且有对应的 ID，则调用 API 补充
  if (!hasCategory1 || !hasCategory2 || !hasCategory3) {
    const missingIds: number[] = [];
    if (!hasCategory1 && spbSales.category1Id) missingIds.push(parseInt(spbSales.category1Id));
    if (!hasCategory2 && spbSales.category2Id) missingIds.push(parseInt(spbSales.category2Id));
    if (!hasCategory3 && spbSales.category3Id) missingIds.push(parseInt(spbSales.category3Id));

    if (missingIds.length > 0 && euraflowConfig?.apiUrl && euraflowConfig?.apiKey) {
      try {
        const { createEuraflowApi } = await import('../shared/api/euraflow-api');
        const api = createEuraflowApi(euraflowConfig.apiUrl, euraflowConfig.apiKey);
        const categoryNames = await api.getCategoryNames(missingIds);

        // 补充缺失的类目名称（优先使用我们的数据）
        if (!hasCategory1 && spbSales.category1Id && categoryNames[spbSales.category1Id]) {
          spbSales.category1 = categoryNames[spbSales.category1Id];
        }
        if (!hasCategory2 && spbSales.category2Id && categoryNames[spbSales.category2Id]) {
          spbSales.category2 = categoryNames[spbSales.category2Id];
        }
        if (!hasCategory3 && spbSales.category3Id && categoryNames[spbSales.category3Id]) {
          spbSales.category3 = categoryNames[spbSales.category3Id];
        }

        // 重新构建完整的类目路径
        const parts = [spbSales.category1, spbSales.category2, spbSales.category3].filter(Boolean);
        if (parts.length > 0) {
          spbSales.category = parts.join(' > ');
        }

        if (__DEBUG__) {
          console.log('[商品数据] 类目名称补充:', { missingIds, categoryNames, finalCategory: spbSales.category });
        }
      } catch (err: any) {
        console.error('[商品数据] 类目名称补充失败:', err.message);
      }
    }
  }

  // 如果最终没有任何有意义的数据，设为 null
  const finalSpbSales = Object.keys(spbSales).length > 0 ? spbSales : null;

  // 3. 存储到缓存
  productDataCache.set(url, {
    url,
    ozonProduct: productDetail,
    spbSales: finalSpbSales,
    euraflowConfig,
    timestamp: Date.now()
  });

  // 4. 调试日志
  if (__DEBUG__) {
    console.log('[商品数据] 最终数据:', {
      变体数量: productDetail.variants?.length || 0,
      spbSales: finalSpbSales ? '✅' : '❌',
      评分: finalSpbSales?.rating,
      评价数: finalSpbSales?.reviewCount
    });
  }

  return {
    ozonProduct: productDetail,
    spbSales: finalSpbSales,
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
      resolve({
        apiUrl: result.apiUrl,
        apiKey: result.apiKey
      });
    });
  });
}

// 导出类型（供TypeScript使用）
export {};
