import type {
  ProductData,
  Shop,
  Warehouse,
  Watermark,
  QuickPublishRequest,
  QuickPublishResponse,
  TaskStatus,
} from './types';

/**
 * EuraFlow API 客户端
 *
 * 通过后台服务工作线程发送请求（绕过CSP限制）
 */
export class ApiClient {
  constructor(
    private apiUrl: string,
    private apiKey: string
  ) {}

  /**
   * 批量上传商品数据
   */
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

  /**
   * 获取店铺列表
   */
  async getShops(): Promise<Shop[]> {
    try {
      const response = await this.sendRequest('GET_SHOPS', {});
      return response.data || [];
    } catch (error: any) {
      console.error('[ApiClient] Get shops failed:', error);
      throw error;
    }
  }

  /**
   * 获取指定店铺的仓库列表
   */
  async getWarehouses(shopId: number): Promise<Warehouse[]> {
    try {
      const response = await this.sendRequest('GET_WAREHOUSES', { shopId });
      return response.data || [];
    } catch (error: any) {
      console.error('[ApiClient] Get warehouses failed:', error);
      throw error;
    }
  }

  /**
   * 获取水印配置列表
   */
  async getWatermarks(): Promise<Watermark[]> {
    try {
      const response = await this.sendRequest('GET_WATERMARKS', {});
      return response || [];
    } catch (error: any) {
      console.error('[ApiClient] Get watermarks failed:', error);
      throw error;
    }
  }

  /**
   * 快速上架商品
   */
  async quickPublish(data: QuickPublishRequest): Promise<QuickPublishResponse> {
    try {
      const response = await this.sendRequest('QUICK_PUBLISH', { data });
      return response;
    } catch (error: any) {
      console.error('[ApiClient] Quick publish failed:', error);
      throw error;
    }
  }

  /**
   * 查询上架任务状态
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    try {
      const response = await this.sendRequest('GET_TASK_STATUS', { taskId });
      return response;
    } catch (error: any) {
      console.error('[ApiClient] Get task status failed:', error);
      throw error;
    }
  }

  /**
   * 通过 Service Worker 发送 API 请求（绕过 CORS 限制）
   */
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

  /**
   * 转换商品数据为API格式
   */
  private convertProductsToApiFormat(products: ProductData[]): any[] {
    return products.map(product => ({
      product_id: product.product_id,
      product_name_ru: product.product_name_ru,
      product_name_cn: product.product_name_cn,
      brand: product.brand,
      current_price: product.current_price,
      original_price: product.original_price,
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
      monthly_sales_revenue: product.monthly_sales_revenue,
      daily_sales_volume: product.daily_sales_volume,
      daily_sales_revenue: product.daily_sales_revenue,
      sales_dynamic_percent: product.sales_dynamic_percent,
      conversion_rate: product.conversion_rate,

      package_weight: product.package_weight,
      package_volume: product.package_volume,
      package_length: product.package_length,
      package_width: product.package_width,
      package_height: product.package_height,

      rating: product.rating,
      review_count: product.review_count,

      seller_type: product.seller_type,
      delivery_days: product.delivery_days,
      availability_percent: product.availability_percent,
      ad_cost_share: product.ad_cost_share,
      product_created_date: product.product_created_date?.toISOString(),

      competitor_count: product.competitor_count,
      competitor_min_price: product.competitor_min_price,

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
      avg_price: product.avg_price,
      listing_date: product.listing_date?.toISOString(),
      listing_days: product.listing_days,
      seller_mode: product.seller_mode,
    }));
  }
}
