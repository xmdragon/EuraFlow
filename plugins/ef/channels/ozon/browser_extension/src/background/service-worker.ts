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

// 导入自动采集模块
import { registerAutoCollectorHandlers } from './auto-collector';

// 导入促销自动拉取清理模块
import { promoAutoAddCleaner, registerPromoCleanerHandlers } from './promo-auto-add-cleaner';

// 导入账单付款同步模块
import { invoicePaymentSyncer, registerInvoicePaymentSyncerHandlers } from './invoice-payment-syncer';

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

  // 执行促销自动拉取清理（每天首次执行）
  promoAutoAddCleaner.run().catch((error) => {
    console.error('[ServiceWorker] 促销清理执行失败:', error);
  });

  // 执行账单付款同步（检查窗口内每天首次执行）
  invoicePaymentSyncer.run().catch((error) => {
    console.error('[ServiceWorker] 账单付款同步执行失败:', error);
  });
});

// Service Worker 启动时也检查执行
chrome.runtime.onStartup.addListener(() => {
  promoAutoAddCleaner.run().catch((error) => {
    console.error('[ServiceWorker] 促销清理执行失败:', error);
  });

  invoicePaymentSyncer.run().catch((error) => {
    console.error('[ServiceWorker] 账单付款同步执行失败:', error);
  });
});

// ============================================================================
// 消息处理器
// ============================================================================

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {

  // EuraFlow API
  if (message.type === 'UPLOAD_PRODUCTS') {
    handleUploadProducts(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => {
        // 详细记录上传错误
        console.error('[EuraFlow] 上传失败:', error.message || error);
        if (error.code) {
          console.error('[EuraFlow] 错误代码:', error.code);
        }
        if (error.status) {
          console.error('[EuraFlow] HTTP状态:', error.status);
        }
        sendResponse({ success: false, error: error.message || '上传失败（未知错误）' });
      });
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

  // 配置预加载（document_start 时调用，不需要 Cookie）
  if (message.type === 'GET_CONFIG_PREFETCH') {
    handleGetConfigPrefetch()
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

  if (message.type === 'FOLLOW_PDP') {
    handleFollowPdp(message.data)
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

  // Modal API（在页面上下文中执行）
  if (message.type === 'GET_MODAL_VARIANTS') {
    handleGetModalVariants(message.data)
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

/**
 * 配置预加载（document_start 时调用）
 * 从 chrome.storage 获取 API 配置，并预加载 EuraFlow 配置
 */
async function handleGetConfigPrefetch(): Promise<any> {
  const storageData = await new Promise<any>((resolve) => {
    chrome.storage.sync.get(['apiUrl', 'apiKey'], resolve);
  });

  if (!storageData.apiUrl || !storageData.apiKey) {
    return { apiUrl: null, apiKey: null, config: null };
  }

  // 预加载 EuraFlow 配置
  const api = createEuraflowApi(storageData.apiUrl, storageData.apiKey);
  const config = await api.getConfig().catch(() => null);

  return {
    apiUrl: storageData.apiUrl,
    apiKey: storageData.apiKey,
    config
  };
}

async function handleQuickPublish(data: { apiUrl: string; apiKey: string; data: any }) {
  const { apiUrl, apiKey, data: publishData } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.quickPublish(publishData);
}

async function handleFollowPdp(data: { apiUrl: string; apiKey: string; data: any }) {
  const { apiUrl, apiKey, data: followData } = data;
  const api = createEuraflowApi(apiUrl, apiKey);
  return api.followPdp(followData);
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

/**
 * 处理 Modal API 请求（复用 OzonBuyerApi）
 */
async function handleGetModalVariants(data: { productId: string }): Promise<any[] | null> {
  const { productId } = data;
  const api = getOzonBuyerApi();
  return api.getModalVariants(productId);
}

// ============================================================================
// 综合数据获取
// ============================================================================

async function handleFetchAllProductData(data: {
  url: string;
  productSku: string;
  productDetail: any;
  ratingData?: { rating: number | null; reviewCount: number | null };
  spbSalesData?: any;  // 可选：content script 已预先获取的上品帮数据
  followSellerData?: { count: number; skus: string[]; prices: number[]; sellers?: any[] } | null;  // 可选：content script 通过页面上下文获取的跟卖数据
}): Promise<any> {
  const { url, productSku, productDetail, ratingData, spbSalesData: preloadedSpbSales, followSellerData } = data;

  // 数据完整性检查
  if (!productDetail) {
    throw new Error('Content Script 未传递 productDetail，数据采集失败');
  }

  // 1. 检查缓存
  const cached = productDataCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    if (__DEBUG__) {
      console.log('[商品数据] 命中缓存, url:', url);
    }
    return {
      ozonProduct: cached.ozonProduct,
      spbSales: cached.spbSales,
      euraflowConfig: cached.euraflowConfig
    };
  }

  // 2. 获取辅助数据
  const spbangApi = getSpbangApi();

  // 如果 content script 已预先获取上品帮数据，直接使用；否则在此获取
  let spbSalesDataResult: any = preloadedSpbSales;
  let euraflowConfig: any = null;

  if (preloadedSpbSales) {
    // 上品帮数据已预加载，只需获取 EuraFlow 配置
    euraflowConfig = await getEuraflowConfig().catch(err => {
      console.error('[商品数据] EuraFlow配置获取失败:', err.message);
      return null;
    });
  } else {
    // 并发获取上品帮数据和 EuraFlow 配置
    const [spbResult, configResult] = await Promise.all([
      spbangApi.getSalesData(productSku).catch(err => {
        console.error('[商品数据] 上品帮销售数据获取失败:', err.message);
        return null;
      }),
      getEuraflowConfig().catch(err => {
        console.error('[商品数据] EuraFlow配置获取失败:', err.message);
        return null;
      })
    ]);
    spbSalesDataResult = spbResult;
    euraflowConfig = configResult;
  }

  // 初始化 spbSales 对象（即使上品帮没数据也需要存储 OZON 数据）
  let spbSales: any = spbSalesDataResult || {};

  // 佣金数据已包含在 getSalesData 返回中，无需单独获取
  // （如果 getSalesData 没返回佣金，getCommissionsBatch 也不会有数据）

  // 2.5 跟卖数据处理
  // 优先使用上品帮返回的数据，否则使用 Content Script 通过页面上下文获取的数据
  if (spbSales.followSellerPrices?.length > 0) {
    // 上品帮已返回跟卖数据
    const prices = spbSales.followSellerPrices.filter((p: number) => p > 0);
    if (prices.length > 0) {
      if (spbSales.competitorCount == null) {
        spbSales.competitorCount = prices.length;
      }
      if (spbSales.competitorMinPrice == null) {
        spbSales.competitorMinPrice = Math.min(...prices);
      }
    }
  } else if (followSellerData && spbSales.competitorCount == null) {
    // 使用 Content Script 通过页面上下文获取的跟卖数据
    spbSales.competitorCount = followSellerData.count;
    spbSales.followSellerSkus = followSellerData.skus;
    spbSales.followSellerPrices = followSellerData.prices;
    spbSales.followSellerList = followSellerData.sellers;  // 完整的卖家列表（用于悬浮窗口）
    if (followSellerData.prices?.length > 0) {
      spbSales.competitorMinPrice = Math.min(...followSellerData.prices);
    }
    if (__DEBUG__) {
      console.log('[商品数据] 使用页面上下文获取的跟卖数据:', followSellerData);
    }
  }

  // 2.6 合并页面提取的评分数据
  if (ratingData) {
    if (ratingData.rating != null) {
      spbSales.rating = ratingData.rating;
    }
    if (ratingData.reviewCount != null) {
      spbSales.reviewCount = ratingData.reviewCount;
    }
  }

  // 2.8 补充类目名称（通过 EuraFlow API）
  // 逻辑：如果上品帮已有完整三级类目，直接使用；否则根据属性 Тип 查询我们的 API
  let hasAllCategories = false;

  // 优先检查 category 字段是否已有完整三级类目（如 "家具 > 架子和货架 > 置物架"）
  if (spbSales.category) {
    const categoryParts = spbSales.category.split(' > ');
    if (categoryParts.length >= 3) {
      // 从 category 字段提取三级类目
      spbSales.category1 = categoryParts[0];
      spbSales.category2 = categoryParts[1];
      spbSales.category3 = categoryParts[2];
      hasAllCategories = true;
      if (__DEBUG__) {
        console.log('[商品数据] 从 category 字段提取三级类目:', categoryParts.slice(0, 3).join(' > '));
      }
    }
  }

  // 其次检查 category1, category2, category3 是否都有值
  if (!hasAllCategories && spbSales.category1 && spbSales.category2 && spbSales.category3) {
    hasAllCategories = true;
  }

  // 如果上品帮三级类目不完整，从商品属性中提取 Тип 并查询我们的 API
  if (!hasAllCategories && euraflowConfig?.apiUrl && euraflowConfig?.apiKey) {
    // 从商品属性中提取 Тип（类型属性，key = "Тип"）
    // 注意：attributes 中的 attribute_id 是哈希值，不是 OZON 原始 ID
    // 需要使用 productDetail.typeNameRu 或从 attributes 中找 key="Тип" 的值
    const typeNameRu = productDetail?.typeNameRu;

    if (typeNameRu) {
      try {
        // 使用已导入的 createEuraflowApi（避免动态导入触发 modulePreload polyfill）
        const api = createEuraflowApi(euraflowConfig.apiUrl, euraflowConfig.apiKey);
        const categoryData = await api.getCategoryByRussianName(typeNameRu);

        if (categoryData) {
          // 使用我们 API 返回的完整三级类目
          spbSales.category1 = categoryData.category1;
          spbSales.category1Id = categoryData.category1Id?.toString();
          spbSales.category2 = categoryData.category2;
          spbSales.category2Id = categoryData.category2Id?.toString();
          spbSales.category3 = categoryData.category3;
          spbSales.category3Id = categoryData.category3Id?.toString();
          spbSales.category = categoryData.fullPath;
        }
      } catch (err: any) {
        console.error('[商品数据] 类目查询失败:', err.message);
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

// ============================================================================
// 注册消息处理器
// ============================================================================
registerAutoCollectorHandlers();
registerPromoCleanerHandlers();
registerInvoicePaymentSyncerHandlers();

// 导出类型（供TypeScript使用）
export {};
