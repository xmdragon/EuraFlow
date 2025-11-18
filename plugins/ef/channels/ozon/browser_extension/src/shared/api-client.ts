import type {
  ProductData,
  Shop,
  Warehouse,
  Watermark,
  QuickPublishRequest,
  QuickPublishResponse,
  QuickPublishBatchRequest,
  QuickPublishBatchResponse,
  TaskStatus,
} from './types';

export class ApiClient {
  constructor(
    private apiUrl: string,
    private apiKey: string
  ) {}

  async uploadProducts(products: ProductData[]): Promise<{
    success: boolean;
    total: number;
    success_count?: number;
    failed_count?: number;
    errors?: any[];
  }> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPLOAD_PRODUCTS',
        data: {
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          products: this.convertProductsToApiFormat(products)
        }
      });

      if (!response.success) {
        throw new Error(response.error || '上传失败');
      }

      return response.data;
    } catch (error: any) {
      console.error('[ApiClient] Upload failed:', error);
      throw error;
    }
  }

  // 优化：单次请求减少网络往返，从原来的 3+N 次请求优化到 1 次
  async getConfig(): Promise<{
    shops: Array<Shop & { warehouses: Warehouse[] }>;
    watermarks: Watermark[];
  }> {
    try {
      const response = await this.sendRequest('GET_CONFIG', {});
      return response;
    } catch (error: any) {
      console.error('[ApiClient] Get config failed:', error);
      throw error;
    }
  }

  async quickPublish(data: QuickPublishRequest): Promise<QuickPublishResponse> {
    try {
      const response = await this.sendRequest('QUICK_PUBLISH', { data });
      return response;
    } catch (error: any) {
      console.error('[ApiClient] Quick publish failed:', error);
      throw error;
    }
  }

  async quickPublishBatch(data: QuickPublishBatchRequest): Promise<QuickPublishBatchResponse> {
    try {
      const response = await this.sendRequest('QUICK_PUBLISH_BATCH', { data });
      return response;
    } catch (error: any) {
      console.error('[ApiClient] Batch quick publish failed:', error);
      throw error;
    }
  }

  async getTaskStatus(taskId: string, shopId?: number): Promise<TaskStatus> {
    try {
      const response = await this.sendRequest('GET_TASK_STATUS', { taskId, shopId });
      return response;
    } catch (error: any) {
      console.error('[ApiClient] Get task status failed:', error);
      throw error;
    }
  }

  private async sendRequest(type: string, payload: any): Promise<any> {
    const response = await chrome.runtime.sendMessage({
      type,
      data: {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        ...payload
      }
    });

    if (!response.success) {
      throw new Error(response.error || '请求失败');
    }

    return response.data;
  }

  private convertProductsToApiFormat(products: ProductData[]): any[] {
    return products.map(product => ({
      product_id: product.product_id,
      product_name_ru: product.product_name_ru,
      product_name_cn: product.product_name_cn,
      brand: product.brand,

      // 价格字段：转换成"分"（乘以100）
      current_price: product.current_price != null ? Math.round(product.current_price * 100) : undefined,
      original_price: product.original_price != null ? Math.round(product.original_price * 100) : undefined,

      ozon_link: product.ozon_link,
      image_url: product.image_url,
      category_link: product.category_link,

      rfbs_commission_low: product.rfbs_commission_low,
      rfbs_commission_mid: product.rfbs_commission_mid,
      rfbs_commission_high: product.rfbs_commission_high,
      fbp_commission_low: product.fbp_commission_low,
      fbp_commission_mid: product.fbp_commission_mid,
      fbp_commission_high: product.fbp_commission_high,

      monthly_sales_volume: product.monthly_sales_volume,
      monthly_sales_revenue: product.monthly_sales_revenue != null ? Math.round(product.monthly_sales_revenue * 100) : undefined,
      daily_sales_volume: product.daily_sales_volume,
      daily_sales_revenue: product.daily_sales_revenue != null ? Math.round(product.daily_sales_revenue * 100) : undefined,
      sales_dynamic_percent: product.sales_dynamic_percent,
      conversion_rate: product.conversion_rate,

      // 映射到后端数据库字段名
      package_weight: product.weight,
      package_length: product.depth,  // depth → package_length
      package_width: product.width,
      package_height: product.height,

      rating: product.rating,
      review_count: product.review_count,

      seller_type: product.seller_type,
      delivery_days: product.delivery_days,
      availability_percent: product.availability_percent,
      ad_cost_share: product.ad_cost_share,
      product_created_date: product.product_created_date?.toISOString(),

      competitor_count: product.competitor_count,
      competitor_min_price: product.competitor_min_price != null ? Math.round(product.competitor_min_price * 100) : undefined,

      // 跟卖数据字段（OZON API）
      follow_seller_count: product.follow_seller_count,
      follow_seller_min_price: product.follow_seller_min_price != null ? Math.round(product.follow_seller_min_price * 100) : undefined,

      // 营销分析字段（上品帮）
      card_views: product.card_views,
      card_add_to_cart_rate: product.card_add_to_cart_rate,
      search_views: product.search_views,
      search_add_to_cart_rate: product.search_add_to_cart_rate,
      click_through_rate: product.click_through_rate,
      promo_days: product.promo_days,
      promo_discount_percent: product.promo_discount_percent,
      promo_conversion_rate: product.promo_conversion_rate,
      paid_promo_days: product.paid_promo_days,
      return_cancel_rate: product.return_cancel_rate,

      // 基础字段（上品帮）
      category_path: product.category_path,
      avg_price: product.avg_price != null ? Math.round(product.avg_price * 100) : undefined,
      listing_date: product.listing_date?.toISOString(),
      listing_days: product.listing_days,
      seller_mode: product.seller_mode,
    }));
  }
}
