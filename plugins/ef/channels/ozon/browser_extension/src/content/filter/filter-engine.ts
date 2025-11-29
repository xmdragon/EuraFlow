import type { ProductData, FilterConfig } from '../../shared/types';

/**
 * 过滤结果
 */
export interface FilterResult {
  passed: boolean;
  failedReason?: string;
  stage: 'price' | 'spb' | 'followSeller' | 'passed';
}

/**
 * 采集过滤引擎
 *
 * 支持三阶段渐进式过滤：
 * 1. 价格过滤（DOM数据）
 * 2. 上品帮数据过滤（月销、重量、上架时间、发货模式）
 * 3. 跟卖数据过滤（OZON API）
 *
 * 无数据处理策略：当商品缺少过滤字段数据时，视为不满足条件，过滤掉
 */
export class FilterEngine {
  constructor(private config: FilterConfig) {}

  /**
   * 更新过滤配置
   */
  updateConfig(config: FilterConfig): void {
    this.config = config;
  }

  /**
   * 获取当前配置
   */
  getConfig(): FilterConfig {
    return { ...this.config };
  }

  /**
   * 阶段1：价格过滤（DOM数据）
   * 在获取API数据前执行，避免不必要的API请求
   */
  filterByPrice(product: ProductData): FilterResult {
    const price = product.current_price;

    // 如果设置了价格过滤但商品无价格数据，过滤掉
    if ((this.config.priceMin !== undefined || this.config.priceMax !== undefined) &&
        (price === undefined || price === null)) {
      return {
        passed: false,
        failedReason: '无价格数据',
        stage: 'price'
      };
    }

    // 最低价过滤
    if (this.config.priceMin !== undefined && price !== undefined && price < this.config.priceMin) {
      return {
        passed: false,
        failedReason: `价格 ${price}¥ < 最低价 ${this.config.priceMin}¥`,
        stage: 'price'
      };
    }

    // 最高价过滤
    if (this.config.priceMax !== undefined && price !== undefined && price > this.config.priceMax) {
      return {
        passed: false,
        failedReason: `价格 ${price}¥ > 最高价 ${this.config.priceMax}¥`,
        stage: 'price'
      };
    }

    return { passed: true, stage: 'price' };
  }

  /**
   * 阶段2：上品帮数据过滤
   * 在获取跟卖数据前执行
   */
  filterBySpbData(product: ProductData): FilterResult {
    // 月销量过滤
    if (this.config.monthlySalesMin !== undefined) {
      const sales = product.monthly_sales_volume;
      // 无数据时不通过过滤
      if (sales === undefined || sales === null) {
        return {
          passed: false,
          failedReason: `月销量无数据，要求 >= ${this.config.monthlySalesMin}`,
          stage: 'spb'
        };
      }
      if (sales < this.config.monthlySalesMin) {
        return {
          passed: false,
          failedReason: `月销量 ${sales} < ${this.config.monthlySalesMin}`,
          stage: 'spb'
        };
      }
    }

    // 重量过滤
    if (this.config.weightMax !== undefined) {
      const weight = product.weight;
      // 无数据时不通过过滤
      if (weight === undefined || weight === null) {
        return {
          passed: false,
          failedReason: `重量无数据，要求 <= ${this.config.weightMax}g`,
          stage: 'spb'
        };
      }
      if (weight > this.config.weightMax) {
        return {
          passed: false,
          failedReason: `重量 ${weight}g > ${this.config.weightMax}g`,
          stage: 'spb'
        };
      }
    }

    // 上架时间过滤
    if (this.config.listingDateAfter) {
      const listingDate = product.listing_date;
      // 无数据时不通过过滤
      if (!listingDate) {
        return {
          passed: false,
          failedReason: `上架时间无数据，要求晚于 ${this.config.listingDateAfter}`,
          stage: 'spb'
        };
      }
      const filterDate = new Date(this.config.listingDateAfter);
      const productDate = new Date(listingDate);
      // 上架时间必须晚于指定日期
      if (productDate <= filterDate) {
        const dateStr = productDate.toISOString().split('T')[0];
        return {
          passed: false,
          failedReason: `上架时间 ${dateStr} <= ${this.config.listingDateAfter}`,
          stage: 'spb'
        };
      }
    }

    // 发货模式过滤
    if (this.config.sellerMode && this.config.sellerMode !== 'ALL') {
      const mode = product.seller_mode;
      // 无数据时不通过过滤
      if (!mode) {
        return {
          passed: false,
          failedReason: `发货模式无数据，要求 ${this.config.sellerMode}`,
          stage: 'spb'
        };
      }
      const normalizedMode = mode.toUpperCase();
      if (normalizedMode !== this.config.sellerMode) {
        return {
          passed: false,
          failedReason: `发货模式 ${mode} 不是 ${this.config.sellerMode}`,
          stage: 'spb'
        };
      }
    }

    return { passed: true, stage: 'spb' };
  }

  /**
   * 阶段3：跟卖数据过滤
   * 最后执行
   */
  filterByFollowSeller(product: ProductData): FilterResult {
    if (this.config.followSellerMax !== undefined) {
      const count = product.competitor_count;
      // 无数据时不通过过滤
      if (count === undefined || count === null) {
        return {
          passed: false,
          failedReason: `跟卖数量无数据，要求 <= ${this.config.followSellerMax}`,
          stage: 'followSeller'
        };
      }
      if (count > this.config.followSellerMax) {
        return {
          passed: false,
          failedReason: `跟卖数 ${count} > ${this.config.followSellerMax}`,
          stage: 'followSeller'
        };
      }
    }

    return { passed: true, stage: 'passed' };
  }

  /**
   * 检查是否有任何过滤条件生效
   */
  hasAnyFilter(): boolean {
    return (
      this.config.priceMin !== undefined ||
      this.config.priceMax !== undefined ||
      this.config.monthlySalesMin !== undefined ||
      this.config.weightMax !== undefined ||
      this.config.listingDateAfter !== undefined ||
      (this.config.sellerMode !== undefined && this.config.sellerMode !== 'ALL') ||
      this.config.followSellerMax !== undefined
    );
  }

  /**
   * 检查是否需要价格过滤
   */
  needsPriceFilter(): boolean {
    return this.config.priceMin !== undefined || this.config.priceMax !== undefined;
  }

  /**
   * 检查是否需要上品帮数据过滤
   */
  needsSpbFilter(): boolean {
    return (
      this.config.monthlySalesMin !== undefined ||
      this.config.weightMax !== undefined ||
      this.config.listingDateAfter !== undefined ||
      (this.config.sellerMode !== undefined && this.config.sellerMode !== 'ALL')
    );
  }

  /**
   * 检查是否需要跟卖数据过滤
   */
  needsFollowSellerFilter(): boolean {
    return this.config.followSellerMax !== undefined;
  }
}
