import type { ProductData, SpbSalesData } from './types';

export class ShangpinbangAPIClient {
  async getSalesDataBatch(productIds: string[]): Promise<Map<string, Partial<ProductData>>> {
    if (productIds.length === 0) {
      return new Map();
    }

    if (productIds.length > 50) {
      throw new Error('单批次最多支持50个SKU，请分批调用');
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SPB_SALES_DATA_BATCH',
        data: { productIds }
      });

      if (!response.success) {
        throw new Error(response.error || '获取上品帮数据失败');
      }

      const dataMap = new Map<string, Partial<ProductData>>();

      if (Array.isArray(response.data)) {
        response.data.forEach((item: SpbSalesData) => {
          const sku = item.goodsId || item.sku;
          if (sku) {
            dataMap.set(sku, this.transformSpbData(item));
          }
        });
      }

      return dataMap;
    } catch (error: any) {
      console.error('[上品帮API] 批量获取失败:', error);
      throw new Error(`上品帮API错误: ${error.message}`);
    }
  }

  async getSalesDataInBatches(
    productIds: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<Map<string, Partial<ProductData>>> {
    const BATCH_SIZE = 50;
    const allData = new Map<string, Partial<ProductData>>();
    const totalBatches = Math.ceil(productIds.length / BATCH_SIZE);

    for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
      const batch = productIds.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

      console.log(`[上品帮API] 批次 ${batchIndex}/${totalBatches}，SKU数量: ${batch.length}`);

      try {
        const batchData = await this.getSalesDataBatch(batch);
        batchData.forEach((data, sku) => allData.set(sku, data));

        // 进度回调
        if (onProgress) {
          onProgress(i + batch.length, productIds.length);
        }

        // 批次间延迟（避免限流）
        if (i + BATCH_SIZE < productIds.length) {
          await this.sleep(100);
        }
      } catch (error: any) {
        console.error(`[上品帮API] 批次 ${batchIndex} 失败:`, error.message);
        // 继续处理下一批（容错）
      }
    }

    console.log(`[上品帮API] 总计获取 ${allData.size}/${productIds.length} 个商品数据`);
    return allData;
  }

  /**
   * 数据格式转换：SpbSalesData → ProductData
   */
  private transformSpbData(spbData: SpbSalesData): Partial<ProductData> {
    const result: Partial<ProductData> = {
      // 品牌和类目
      brand: spbData.brand || undefined,
      category_path: spbData.category || undefined,
      ...(spbData.category && this.splitCategory(spbData.category)),

      // 佣金（6个字段）
      rfbs_commission_low: this.parseNumber(spbData.rfbsCommissionLow),
      rfbs_commission_mid: this.parseNumber(spbData.rfbsCommissionMid),
      rfbs_commission_high: this.parseNumber(spbData.rfbsCommissionHigh),
      fbp_commission_low: this.parseNumber(spbData.fbpCommissionLow),
      fbp_commission_mid: this.parseNumber(spbData.fbpCommissionMid),
      fbp_commission_high: this.parseNumber(spbData.fbpCommissionHigh),

      // 销量数据
      monthly_sales_volume: this.parseNumber(spbData.monthlySales),
      monthly_sales_revenue: this.parseNumber(spbData.monthlySalesAmount),
      daily_sales_volume: this.parseNumber(spbData.dailySales),
      daily_sales_revenue: this.parseNumber(spbData.dailySalesAmount),
      sales_dynamic_percent: this.parseNumber(spbData.salesDynamic),
      conversion_rate: this.parseNumber(spbData.transactionRate),

      // 物流信息（直接使用上品帮API字段名）
      weight: this.parseNumber(spbData.weight),
      depth: this.parseNumber(spbData.depth),
      width: this.parseNumber(spbData.width),
      height: this.parseNumber(spbData.height),

      // 竞争对手数据
      competitor_count: this.parseNumber(spbData.competitorCount),
      competitor_min_price: this.parseNumber(spbData.competitorMinPrice),

      // 营销分析字段
      card_views: this.parseNumber(spbData.cardViews),
      card_add_to_cart_rate: this.parseNumber(spbData.cardAddToCartRate),
      search_views: this.parseNumber(spbData.searchViews),
      search_add_to_cart_rate: this.parseNumber(spbData.searchAddToCartRate),
      click_through_rate: this.parseNumber(spbData.clickThroughRate),
      promo_days: this.parseNumber(spbData.promoDays),
      promo_discount_percent: this.parseNumber(spbData.promoDiscount),
      promo_conversion_rate: this.parseNumber(spbData.promoConversion),
      paid_promo_days: this.parseNumber(spbData.paidPromoDays),
      return_cancel_rate: this.parseNumber(spbData.returnCancelRate),

      // 其他字段
      avg_price: this.parseNumber(spbData.avgPrice),
      listing_date: this.parseDate(spbData.listingDate),
      listing_days: this.parseNumber(spbData.listingDays),
      seller_mode: spbData.sellerMode || undefined,
      ad_cost_share: this.parseNumber(spbData.adShare),
    };

    // 调试：输出原始数据中的关键字段
    if (window.EURAFLOW_DEBUG) {
      console.log('[SPB转换] 原始数据字段:', {
        weight: spbData.weight,
        depth: spbData.depth,
        width: spbData.width,
        height: spbData.height,
        rfbsCommissionMid: spbData.rfbsCommissionMid,
        fbpCommissionMid: spbData.fbpCommissionMid,
        monthlySales: spbData.monthlySales
      });
      console.log('[SPB转换] 转换后:', {
        weight: result.weight,
        depth: result.depth,
        width: result.width,
        height: result.height,
        rfbs_commission_mid: result.rfbs_commission_mid,
        fbp_commission_mid: result.fbp_commission_mid,
        monthly_sales_volume: result.monthly_sales_volume
      });
    }

    return result;
  }

  /**
   * 拆分类目路径
   */
  private splitCategory(categoryPath: string): Partial<ProductData> {
    if (!categoryPath || categoryPath.includes('非热销') || categoryPath.includes('无数据')) {
      return {};
    }

    const parts = categoryPath.split('>').map(p => p.trim());
    return {
      category_level_1: parts[0] || undefined,
      category_level_2: parts[1] || undefined,
    };
  }

  /**
   * 解析数字（null/0/"无数据" → undefined，有效数字 → number）
   */
  private parseNumber(value: number | null | undefined | string): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      // 处理 "无数据"、"-" 等字符串
      if (value.includes('无') || value.includes('-') || value.trim() === '') {
        return undefined;
      }
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    }

    return typeof value === 'number' ? value : undefined;
  }

  /**
   * 解析日期
   */
  private parseDate(dateStr: string | null | undefined): Date | undefined {
    if (!dateStr || typeof dateStr !== 'string') {
      return undefined;
    }

    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 单例实例
 */
export const spbApiClient = new ShangpinbangAPIClient();
