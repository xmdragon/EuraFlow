import type { ProductData } from './types';

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
    }));
  }
}
