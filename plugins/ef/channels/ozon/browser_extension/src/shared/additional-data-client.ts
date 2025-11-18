/**
 * 佣金和跟卖数据获取客户端
 *
 * 功能：
 * - 批量获取上品帮佣金数据
 * - 批量获取OZON跟卖数据
 */

import type { ProductData } from './types';

export class AdditionalDataClient {
  /**
   * 批量获取佣金数据
   *
   * @param goods - 商品数组 [{ goods_id, category_name }]
   * @returns Map<SKU, 佣金数据>
   */
  async getCommissionsDataBatch(
    goods: Array<{ goods_id: string; category_name: string }>
  ): Promise<Map<string, Partial<ProductData>>> {
    if (goods.length === 0) {
      return new Map();
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_GOODS_COMMISSIONS_BATCH',
        data: { goods }
      });

      console.log('[佣金数据Client] 收到响应:', {
        success: response.success,
        dataLength: response.data?.length,
        error: response.error
      });

      if (!response.success) {
        console.error('[佣金数据Client] API调用失败:', response.error);
        throw new Error(response.error || '获取佣金数据失败');
      }

      // 转换为Map（key=SKU, value=佣金数据）
      const dataMap = new Map<string, Partial<ProductData>>();

      if (Array.isArray(response.data)) {
        console.log('[佣金数据Client] API返回数组，第一条原始数据:', response.data[0]);

        response.data.forEach((item: any, index: number) => {
          const sku = item.goods_id;
          if (sku) {
            const commissionData = {
              rfbs_commission_low: this.parseNumber(item.rfbs_small),
              rfbs_commission_mid: this.parseNumber(item.rfbs),
              rfbs_commission_high: this.parseNumber(item.rfbs_large),
              fbp_commission_low: this.parseNumber(item.fbp_small),
              fbp_commission_mid: this.parseNumber(item.fbp),
              fbp_commission_high: this.parseNumber(item.fbp_large),
            };

            if (index === 0) {
              console.log('[佣金数据Client] 第一条转换后:', commissionData);
            }

            dataMap.set(sku, commissionData);
          }
        });
      } else {
        console.warn('[佣金数据Client] response.data 不是数组:', typeof response.data, response.data);
      }

      return dataMap;
    } catch (error: any) {
      console.error('[佣金数据] 批量获取失败:', error);
      return new Map();
    }
  }

  /**
   * 批量获取跟卖数据
   *
   * @param productIds - SKU数组
   * @param onProgress - 进度回调
   * @returns Map<SKU, 跟卖数据>
   */
  async getFollowSellerDataBatch(
    productIds: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, Partial<ProductData>>> {
    if (productIds.length === 0) {
      return new Map();
    }

    try {
      console.log(`[跟卖数据] 开始批量获取 ${productIds.length} 个商品的跟卖数据...`);

      const response = await chrome.runtime.sendMessage({
        type: 'GET_FOLLOW_SELLER_DATA_BATCH',
        data: { productIds }
      });

      if (!response.success) {
        throw new Error(response.error || '获取跟卖数据失败');
      }

      // 转换为Map（key=SKU, value=跟卖数据）
      const dataMap = new Map<string, Partial<ProductData>>();

      if (Array.isArray(response.data)) {
        response.data.forEach((item: any) => {
          const sku = item.goods_id;
          if (sku) {
            const prices = item.gmArr || [];
            dataMap.set(sku, {
              follow_seller_count: item.gm || 0,
              follow_seller_min_price: prices.length > 0 ? prices[0] : undefined,  // 价格数组第一个元素是最低价
              follow_seller_skus: item.gmGoodsIds || [],
              follow_seller_prices: prices
            });
          }
        });
      }

      console.log(`[跟卖数据] 成功获取 ${dataMap.size}/${productIds.length} 个商品数据`);

      if (onProgress) {
        onProgress(productIds.length, productIds.length);
      }

      return dataMap;
    } catch (error: any) {
      console.error('[跟卖数据] 批量获取失败:', error);
      return new Map();
    }
  }

  /**
   * 单个获取跟卖数据
   *
   * @param productId - SKU
   * @returns 跟卖数据对象
   */
  async getFollowSellerDataSingle(productId: string): Promise<Partial<ProductData> | null> {
    if (!productId) {
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_FOLLOW_SELLER_DATA_SINGLE',
        data: { productId }
      });

      if (!response.success) {
        return null;
      }

      const item = response.data;
      if (!item || !item.goods_id) {
        return null;
      }

      const prices = item.gmArr || [];
      return {
        follow_seller_count: item.gm || 0,
        follow_seller_min_price: prices.length > 0 ? prices[0] : undefined,
        follow_seller_skus: item.gmGoodsIds || [],
        follow_seller_prices: prices
      };
    } catch (error: any) {
      console.error(`[跟卖数据] 获取失败 SKU=${productId}:`, error);
      return null;
    }
  }

  /**
   * 解析数字（null → undefined，有效数字 → number）
   */
  private parseNumber(value: number | null | undefined | string): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    }

    return typeof value === 'number' ? value : undefined;
  }
}

/**
 * 单例实例
 */
export const additionalDataClient = new AdditionalDataClient();
