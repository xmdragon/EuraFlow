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

      if (!response.success) {
        throw new Error(response.error || '获取佣金数据失败');
      }

      // 转换为Map（key=SKU, value=佣金数据）
      const dataMap = new Map<string, Partial<ProductData>>();

      if (Array.isArray(response.data)) {
        response.data.forEach((item: any) => {
          const sku = item.goods_id;
          if (sku) {
            dataMap.set(sku, {
              rfbs_commission_low: this.parseNumber(item.rfbs_small),
              rfbs_commission_mid: this.parseNumber(item.rfbs),
              rfbs_commission_high: this.parseNumber(item.rfbs_large),
              fbp_commission_low: this.parseNumber(item.fbp_small),
              fbp_commission_mid: this.parseNumber(item.fbp),
              fbp_commission_high: this.parseNumber(item.fbp_large),
            });
          }
        });
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
            dataMap.set(sku, {
              follow_seller_count: item.gm || 0,
              follow_seller_skus: item.gmGoodsIds || [],
              follow_seller_prices: item.gmArr || []
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
