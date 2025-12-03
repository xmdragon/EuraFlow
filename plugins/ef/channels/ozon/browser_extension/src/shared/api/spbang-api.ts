/**
 * 上品帮 (SPBang) API 客户端
 *
 * 负责与上品帮 API 交互：
 * - Token 认证（自动登录和刷新）
 * - 销售数据批量获取
 * - 佣金数据批量获取
 */

import { BaseApiClient, createApiError } from './base-client';

/**
 * 上品帮销售数据（原始格式）
 */
export interface SpbSalesDataRaw {
  goodsId?: string;
  sku?: string;
  // 销售数据
  soldCount?: number;           // 月销量
  soldSum?: number;             // 月销售额
  avgOrdersOnAccDays?: number;  // 日均销量
  avgGmvOnAccDays?: number;     // 日均销售额
  salesDynamics?: number;       // 销售动态百分比
  // 成交数据
  nullableRedemptionRate?: number;  // 成交率
  // 营销数据
  sessionCount?: number;        // 商品卡片浏览量
  qtyViewPdp?: number;          // PDP 页面浏览量
  convToCartPdp?: number;       // 商品卡片加购率
  sessionCountSearch?: number;  // 搜索浏览量
  convToCartSearch?: number;    // 搜索加购率
  views?: number;               // 总浏览量
  daysInPromo?: number;         // 参与促销天数
  discount?: number;            // 促销折扣
  promoRevenueShare?: number;   // 促销转化率
  daysWithTrafarets?: number;   // 付费推广天数
  drr?: number;                 // 广告份额
  // 商品信息
  avgPrice?: number;
  weight?: number;
  packageWeight?: number;
  depth?: number;
  length?: number;
  packageLength?: number;
  width?: number;
  packageWidth?: number;
  height?: number;
  packageHeight?: number;
  sellerCount?: number;         // 竞争对手数量
  minSellerPrice?: number;      // 竞争对手最低价
  nullableCreateDate?: string;  // 上架日期
  create_time?: string;         // 上架日期（备用）
  salesSchema?: string;         // 销售模式
  sellerMode?: string;          // 销售模式（备用）
  // 类目和品牌
  category?: string;
  categoryPath?: string;
  category1?: string;
  category1Id?: string;
  category2?: string;
  category2Id?: string;
  category3?: string;
  category3Id?: string;
  brand?: string;
  photo?: string;
  image?: string;
  mainImage?: string;
  // 评分
  rating?: number;
  score?: number;
  reviewCount?: number;
  review_count?: number;
  commentsCount?: number;
  // 佣金数据（销售数据 API 也会返回）
  rfbs?: number;
  rfbs_small?: number;
  rfbs_large?: number;
  fbp?: number;
  fbp_small?: number;
  fbp_large?: number;
}

/**
 * 上品帮销售数据（标准格式）
 */
export interface SpbSalesData {
  // 销售数据
  monthlySales: number | null;
  monthlySalesAmount: number | null;
  dailySales: number | null;
  dailySalesAmount: number | null;
  salesDynamic: number | null;
  // 成交数据
  transactionRate: number | null;
  returnCancelRate: number | null;
  // 营销数据
  cardViews: number | null;
  cardAddToCartRate: number | null;
  searchViews: number | null;
  searchAddToCartRate: number | null;
  clickThroughRate: number | null;
  promoDays: number | null;
  promoDiscount: number | null;
  promoConversion: number | null;
  paidPromoDays: number | null;
  adShare: number | null;
  // 佣金数据
  rfbsCommissionLow: number | null;
  rfbsCommissionMid: number | null;
  rfbsCommissionHigh: number | null;
  fbpCommissionLow: number | null;
  fbpCommissionMid: number | null;
  fbpCommissionHigh: number | null;
  // 商品信息
  avgPrice: number | null;
  weight: number | null;
  depth: number | null;
  width: number | null;
  height: number | null;
  competitorCount: number | null;
  competitorMinPrice: number | null;
  listingDate: string | null;
  listingDays: number | null;
  sellerMode: string | null;
  // 类目和品牌
  category: string | null;
  category1: string | null;
  category1Id: string | null;
  category2: string | null;
  category2Id: string | null;
  category3: string | null;
  category3Id: string | null;
  brand: string | null;
  photo: string | null;
  sku: string | null;
  // 评分
  rating: number | null;
  reviewCount: number | null;
}

/**
 * 佣金数据
 */
export interface CommissionData {
  goods_id: string;
  rfbs_small?: number;
  rfbs?: number;
  rfbs_large?: number;
  fbp_small?: number;
  fbp?: number;
  fbp_large?: number;
}

/**
 * 上品帮登录凭据
 */
interface SpbCredentials {
  phone: string;
  password: string;
  token?: string;
}

/**
 * 上品帮 API 客户端
 *
 * 仅在 Service Worker 中使用（跨域请求）
 */
export class SpbangApi extends BaseApiClient {
  private static instance: SpbangApi;

  private constructor() {
    super('https://plus.shopbang.cn/api', {
      useRateLimiter: false,  // 上品帮 API 不需要限流
      timeout: 30000,
      maxRetries: 1
    });
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SpbangApi {
    if (!SpbangApi.instance) {
      SpbangApi.instance = new SpbangApi();
    }
    return SpbangApi.instance;
  }

  /**
   * 登录并获取 Token
   *
   * @param phone - 手机号
   * @param password - 密码
   */
  async login(phone: string, password: string): Promise<string> {
    try {
      const response = await fetch('https://plus.shopbang.cn/api/user/open/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone, pwd: password })
      });

      const result = await response.json();

      if (result.code === 0 && result.data && result.data.token) {
        // 登录成功，存储 Token
        const token = result.data.token;
        await chrome.storage.sync.set({
          spbToken: token,
          spbPhone: phone,
          spbPassword: password
        });

        return token;
      } else if (result.code === -1) {
        throw createApiError('LOGIN_FAILED', result.message || '登录失败');
      } else {
        throw createApiError('UNKNOWN_ERROR', '登录失败，服务器返回异常数据');
      }
    } catch (error: any) {
      if (error.code) {
        throw error;
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw createApiError('NETWORK_ERROR', '网络连接失败，请检查网络');
      }
      throw createApiError('LOGIN_ERROR', error.message);
    }
  }

  /**
   * 获取存储的凭据
   */
  async getCredentials(): Promise<SpbCredentials | null> {
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
   * 获取 Token（自动登录如果需要）
   */
  async getToken(): Promise<string | null> {
    const credentials = await this.getCredentials();
    if (!credentials) {
      return null;
    }

    if (credentials.token) {
      return credentials.token;
    }

    // 自动登录
    try {
      return await this.login(credentials.phone, credentials.password);
    } catch {
      return null;
    }
  }

  /**
   * 批量获取销售数据
   *
   * @param productIds - SKU 数组（最多 50 个）
   */
  async getSalesDataBatch(productIds: string[]): Promise<Map<string, SpbSalesData>> {
    const results = new Map<string, SpbSalesData>();

    if (__DEBUG__) {
      console.log('[API] SpbangApi.getSalesDataBatch 调用, productIds:', productIds);
    }

    if (!productIds || productIds.length === 0) {
      return results;
    }

    if (productIds.length > 50) {
      throw createApiError('BATCH_TOO_LARGE', '单批次最多支持 50 个 SKU');
    }

    const credentials = await this.getCredentials();
    if (!credentials) {
      if (__DEBUG__) {
        console.warn('[SpbangApi] 上品帮未登录（未配置账号）');
      }
      return results;
    }

    // 确保有 Token
    if (!credentials.token) {
      try {
        credentials.token = await this.login(credentials.phone, credentials.password);
      } catch {
        return results;
      }
    }

    const apiUrl = 'https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds';
    const requestBody = {
      goodsIds: productIds,
      token: credentials.token,
      apiType: 'getGoodsInfoByIds',
      is_new: true,
      v: 4
    };

    if (__DEBUG__) {
      console.log('[API] SpbangApi.getSalesDataBatch 请求:', {
        url: apiUrl,
        params: { goodsIds: productIds, apiType: 'getGoodsInfoByIds' }
      });
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        console.error('[SpbangApi] HTTP 错误:', response.status);
        return results;
      }

      const result = await response.json();

      if (__DEBUG__) {
        console.log('[API] SpbangApi.getSalesDataBatch 返回:', result);
      }

      // 检测 Token 过期
      if (this.isTokenExpired(result)) {
        // 重新登录并重试
        try {
          credentials.token = await this.login(credentials.phone, credentials.password);
          return this.getSalesDataBatch(productIds);
        } catch {
          return results;
        }
      }

      // 解析响应
      if (result.code === 0 && result.data && Array.isArray(result.data)) {
        result.data.forEach((item: any) => {
          const rawData = item.data || item;
          // 兼容 goods_id（下划线）和 goodsId（驼峰）
          const sku = rawData.goodsId || rawData.goods_id || rawData.sku || item.goodsId || item.goods_id;
          if (sku) {
            results.set(sku, this.transformSalesData(rawData));
          }
        });
      }

      return results;
    } catch (error: any) {
      console.error('[SpbangApi] 批量获取销售数据失败:', error.message);
      return results;
    }
  }

  /**
   * 获取单个商品的销售数据
   */
  async getSalesData(productSku: string): Promise<SpbSalesData | null> {
    const results = await this.getSalesDataBatch([productSku]);
    return results.get(productSku) || null;
  }

  /**
   * 批量获取佣金数据
   *
   * @param goods - 商品数组 [{ goods_id, category_name }]
   */
  async getCommissionsBatch(
    goods: Array<{ goods_id: string; category_name: string }>
  ): Promise<Map<string, CommissionData>> {
    const results = new Map<string, CommissionData>();

    if (!goods || goods.length === 0) {
      return results;
    }

    const credentials = await this.getCredentials();
    if (!credentials) {
      return results;
    }

    // 确保有 Token
    if (!credentials.token) {
      try {
        credentials.token = await this.login(credentials.phone, credentials.password);
      } catch {
        return results;
      }
    }

    const apiUrl = 'https://api.shopbang.cn/ozonMallSale/';
    const requestBody = {
      token: credentials.token,
      apiType: 'getGoodsCommissions',
      goods: goods
    };

    if (__DEBUG__) {
      console.log('[API] SpbangApi.getCommissionsBatch 请求:', {
        url: apiUrl,
        params: { goods, apiType: 'getGoodsCommissions' }
      });
    }

    try {
      // 注意：佣金 API 使用不同的域名
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        console.error('[SpbangApi] 佣金 API HTTP 错误:', response.status);
        return results;
      }

      const result = await response.json();

      if (__DEBUG__) {
        console.log('[API] SpbangApi.getCommissionsBatch 返回:', JSON.stringify(result, null, 2));
      }

      // 检测 Token 过期
      if (this.isTokenExpired(result)) {
        try {
          credentials.token = await this.login(credentials.phone, credentials.password);
          return this.getCommissionsBatch(goods);
        } catch {
          return results;
        }
      }

      // 解析响应
      if (result.code === 0 && result.data && Array.isArray(result.data)) {
        result.data.forEach((item: CommissionData) => {
          if (item.goods_id) {
            results.set(item.goods_id, item);
          }
        });
      }

      return results;
    } catch (error: any) {
      console.error('[SpbangApi] 批量获取佣金数据失败:', error.message);
      return results;
    }
  }

  /**
   * 安全解析数字（处理字符串和数字类型）
   */
  private parseNumber(value: any): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  /**
   * 检测是否为 Token 过期错误
   */
  private isTokenExpired(responseData: any): boolean {
    if (responseData.code === 0) {
      return false;
    }

    const message = (responseData.message || '').toLowerCase();
    const tokenRelatedKeywords = [
      'token', '登录', '登陆', '过期', '失效',
      '未登录', '请登录', 'expired', 'unauthorized', 'not logged in'
    ];

    return tokenRelatedKeywords.some(keyword => message.includes(keyword));
  }

  /**
   * 转换原始销售数据为标准格式
   */
  private transformSalesData(rawData: SpbSalesDataRaw): SpbSalesData {
    // 计算上架天数
    let listingDays: number | null = null;
    const listingDate = rawData.nullableCreateDate ?? rawData.create_time ?? null;
    if (listingDate) {
      const createDate = new Date(listingDate);
      const now = new Date();
      listingDays = Math.floor((now.getTime() - createDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    // 月销数据
    const monthlySales = rawData.soldCount ?? null;
    const monthlySalesAmount = rawData.soldSum ?? null;

    // 日销数据
    const dayOfMonth = new Date().getDate();
    const dailySales = rawData.avgOrdersOnAccDays ??
      (monthlySales != null ? Math.round((monthlySales / dayOfMonth) * 1000) / 1000 : null);
    const dailySalesAmount = rawData.avgGmvOnAccDays ??
      (monthlySalesAmount != null ? Math.round((monthlySalesAmount / dayOfMonth) * 100) / 100 : null);

    // 成交率和退货取消率
    const redemptionRate = rawData.nullableRedemptionRate ?? null;
    const returnCancelRate = redemptionRate != null
      ? Math.round((100 - redemptionRate) * 100) / 100
      : null;

    // 点击率
    const clickThroughRate = (rawData.qtyViewPdp && rawData.views)
      ? Math.round((rawData.qtyViewPdp / rawData.views) * 10000) / 100
      : null;

    // 类目：优先完整类目路径，其次拼接，最后用一级类目
    const category = rawData.category ?? rawData.categoryPath ??
      (rawData.category1 && rawData.category3
        ? `${rawData.category1} > ${rawData.category3}`
        : rawData.category1 ?? rawData.category3 ?? null);

    return {
      // 销售数据
      monthlySales,
      monthlySalesAmount,
      dailySales,
      dailySalesAmount,
      salesDynamic: rawData.salesDynamics ?? null,
      // 成交数据
      transactionRate: redemptionRate,
      returnCancelRate,
      // 营销数据
      cardViews: rawData.sessionCount ?? rawData.qtyViewPdp ?? null,
      cardAddToCartRate: rawData.convToCartPdp ?? null,
      searchViews: rawData.sessionCountSearch ?? null,
      searchAddToCartRate: rawData.convToCartSearch ?? null,
      clickThroughRate,
      promoDays: rawData.daysInPromo ?? null,
      promoDiscount: rawData.discount ?? null,
      promoConversion: rawData.promoRevenueShare ?? null,
      paidPromoDays: rawData.daysWithTrafarets ?? null,
      adShare: rawData.drr ?? null,
      // 佣金数据（从销售数据 API 提取）
      rfbsCommissionLow: rawData.rfbs_small ?? null,
      rfbsCommissionMid: rawData.rfbs ?? null,
      rfbsCommissionHigh: rawData.rfbs_large ?? null,
      fbpCommissionLow: rawData.fbp_small ?? null,
      fbpCommissionMid: rawData.fbp ?? null,
      fbpCommissionHigh: rawData.fbp_large ?? null,
      // 商品信息（注意：API 可能返回字符串，需要转换为数字）
      avgPrice: rawData.avgPrice ?? rawData.minSellerPrice ?? null,
      weight: this.parseNumber(rawData.weight) ?? this.parseNumber(rawData.packageWeight) ?? null,
      depth: this.parseNumber(rawData.depth) ?? this.parseNumber(rawData.length) ?? this.parseNumber(rawData.packageLength) ?? null,
      width: this.parseNumber(rawData.width) ?? this.parseNumber(rawData.packageWidth) ?? null,
      height: this.parseNumber(rawData.height) ?? this.parseNumber(rawData.packageHeight) ?? null,
      competitorCount: rawData.sellerCount ?? null,
      competitorMinPrice: rawData.minSellerPrice ?? null,
      listingDate,
      listingDays,
      sellerMode: rawData.salesSchema ?? rawData.sellerMode ?? null,
      // 类目和品牌
      category,
      category1: rawData.category1 ?? null,
      category1Id: rawData.category1Id ?? null,
      category2: rawData.category2 ?? null,
      category2Id: rawData.category2Id ?? null,
      category3: rawData.category3 ?? null,
      category3Id: rawData.category3Id ?? null,
      brand: rawData.brand ?? null,
      photo: rawData.photo ?? rawData.image ?? rawData.mainImage ?? null,
      sku: rawData.sku ?? rawData.goodsId ?? null,
      // 评分
      rating: rawData.rating ?? rawData.score ?? null,
      reviewCount: rawData.reviewCount ?? rawData.review_count ?? rawData.commentsCount ?? null,
    };
  }
}

/**
 * 获取上品帮 API 客户端单例
 */
export function getSpbangApi(): SpbangApi {
  return SpbangApi.getInstance();
}

/**
 * Content Script 专用客户端（通过消息转发）
 */
export class SpbangApiProxy {
  /**
   * 批量获取销售数据
   */
  async getSalesDataBatch(productIds: string[]): Promise<Map<string, SpbSalesData>> {
    if (productIds.length === 0) {
      return new Map();
    }

    if (productIds.length > 50) {
      throw new Error('单批次最多支持 50 个 SKU，请分批调用');
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SPB_SALES_DATA_BATCH',
        data: { productIds }
      });

      if (!response.success) {
        throw new Error(response.error || '获取上品帮数据失败');
      }

      const dataMap = new Map<string, SpbSalesData>();

      if (Array.isArray(response.data)) {
        response.data.forEach((item: any) => {
          const sku = item.goodsId || item.sku;
          if (sku) {
            dataMap.set(sku, item);
          }
        });
      }

      return dataMap;
    } catch (error: any) {
      console.error('[SpbangApiProxy] 批量获取失败:', error);
      throw new Error(`上品帮 API 错误: ${error.message}`);
    }
  }

  /**
   * 分批获取销售数据（支持超过 50 个 SKU）
   */
  async getSalesDataInBatches(
    productIds: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, SpbSalesData>> {
    const BATCH_SIZE = 50;
    const allData = new Map<string, SpbSalesData>();

    for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
      const batch = productIds.slice(i, i + BATCH_SIZE);

      try {
        const batchData = await this.getSalesDataBatch(batch);
        batchData.forEach((data, sku) => allData.set(sku, data));

        if (onProgress) {
          onProgress(i + batch.length, productIds.length);
        }

        // 批次间延迟
        if (i + BATCH_SIZE < productIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error: any) {
        console.error('[SpbangApiProxy] 批次失败:', error.message);
        // 继续处理下一批（容错）
      }
    }

    return allData;
  }

  /**
   * 批量获取佣金数据
   */
  async getCommissionsBatch(
    goods: Array<{ goods_id: string; category_name: string }>
  ): Promise<Map<string, CommissionData>> {
    if (goods.length === 0) {
      return new Map();
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_GOODS_COMMISSIONS_BATCH',
        data: { goods }
      });

      if (!response.success) {
        throw new Error(response.error || '获取佣金数据失败');
      }

      const dataMap = new Map<string, CommissionData>();

      if (Array.isArray(response.data)) {
        response.data.forEach((item: CommissionData) => {
          if (item.goods_id) {
            dataMap.set(item.goods_id, item);
          }
        });
      }

      return dataMap;
    } catch (error: any) {
      console.error('[SpbangApiProxy] 获取佣金数据失败:', error);
      return new Map();
    }
  }
}

/**
 * Content Script 专用客户端单例
 */
export const spbangApiProxy = new SpbangApiProxy();
