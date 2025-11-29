/**
 * API 客户端统一导出
 *
 * 提供四类 API 客户端：
 * 1. OZON Seller API - 卖家后台 API（获取商品尺寸、变体信息）
 * 2. OZON Buyer API - 买家端公开 API（分页列表、跟卖数据）
 * 3. SPBang API - 上品帮 API（销售数据、佣金数据）
 * 4. EuraFlow API - EuraFlow 后端 API（商品上传、快速上架）
 *
 * 使用方式：
 *
 * Service Worker 中：
 * ```ts
 * import { getOzonSellerApi, getOzonBuyerApi, getSpbangApi, createEuraflowApi } from '../shared/api';
 *
 * const sellerApi = getOzonSellerApi();
 * const buyerApi = getOzonBuyerApi();
 * const spbangApi = getSpbangApi();
 * const euraflowApi = createEuraflowApi(apiUrl, apiKey);
 * ```
 *
 * Content Script 中：
 * ```ts
 * import { ozonBuyerApiProxy, spbangApiProxy, createEuraflowApiProxy } from '../shared/api';
 *
 * const products = await ozonBuyerApiProxy.getProductsPage(pageUrl, page);
 * const salesData = await spbangApiProxy.getSalesDataBatch(skus);
 * const euraflow = createEuraflowApiProxy(apiUrl, apiKey);
 * ```
 */

// Base Client
export { BaseApiClient, createApiError, isApiError } from './base-client';
export type { ApiError, ApiClientConfig } from './base-client';

// OZON Seller API
export {
  OzonSellerApi,
  getOzonSellerApi,
  executeSellerApiInPage
} from './ozon-seller-api';
export type { SellerVariant, SellerProductDetail } from './ozon-seller-api';

// OZON Buyer API
export {
  OzonBuyerApi,
  OzonBuyerApiProxy,
  getOzonBuyerApi,
  ozonBuyerApiProxy
} from './ozon-buyer-api';
export type { ProductBasicInfo, FollowSellerData } from './ozon-buyer-api';

// SPBang API
export {
  SpbangApi,
  SpbangApiProxy,
  getSpbangApi,
  spbangApiProxy
} from './spbang-api';
export type { SpbSalesData, SpbSalesDataRaw, CommissionData } from './spbang-api';

// EuraFlow API
export {
  EuraflowApi,
  EuraflowApiProxy,
  createEuraflowApi,
  createEuraflowApiProxy
} from './euraflow-api';
export type {
  Shop,
  Warehouse,
  Watermark,
  QuickPublishRequest,
  QuickPublishResponse,
  QuickPublishBatchRequest,
  QuickPublishBatchResponse,
  TaskStatus,
  ProductUploadData
} from './euraflow-api';
