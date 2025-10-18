import type { PageDataParser, ProductData } from './base';
import { cleanNumber, cleanPercent, normalizeBrand } from './base';

/**
 * 上品帮数据解析器
 *
 * 从OZON页面和上品帮注入的DOM中提取商品数据
 */
export class ShangpinbangParser implements PageDataParser {
  readonly toolName = 'shangpinbang';
  readonly displayName = '上品帮';

  isInjected(): boolean {
    // 检测上品帮特征元素
    return !!document.querySelector('.ozon-bang-item, [class*="ozon-bang"]');
  }

  async waitForInjection(): Promise<void> {
    // 等待上品帮完成数据注入（最多2秒，每200ms检查一次）
    const maxWait = 2000;
    const interval = 200;

    for (let i = 0; i < maxWait / interval; i++) {
      if (this.isInjected()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  async parseProductCard(cardElement: HTMLElement): Promise<Partial<ProductData>> {
    // 提取OZON原生数据
    const ozonData = this.extractOzonData(cardElement);

    // 提取上品帮注入的数据
    const bangData = this.extractBangData(cardElement);

    // 合并数据
    return {
      ...ozonData,
      ...bangData,
      // 标准化品牌名
      brand_normalized: normalizeBrand(bangData.brand || ozonData.brand)
    };
  }

  /**
   * 从OZON页面提取原生数据
   */
  private extractOzonData(element: HTMLElement): Partial<ProductData> {
    return {
      product_id: this.extractSKU(element),
      product_name_ru: this.extractProductTitle(element, 'ru'),
      product_name_cn: this.extractProductTitle(element, 'cn'),
      ozon_link: this.extractLink(element),
      image_url: this.extractImage(element),
      category_link: window.location.href,
      current_price: this.extractPrice(element, 'current'),
      original_price: this.extractPrice(element, 'original'),
      rating: this.extractRating(element),
      review_count: this.extractReviewCount(element),
      delivery_days: this.extractDeliveryDays(element),
    };
  }

  /**
   * 提取SKU（纯数字，OZON全站唯一标识）
   */
  private extractSKU(element: HTMLElement): string | undefined {
    const link = element.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    if (!link || !link.href) {
      return undefined;
    }

    // 从URL末尾提取SKU（格式：/product/name-SKU/或/product/name-SKU?params）
    const urlParts = link.href.split('/product/');
    if (urlParts.length <= 1) {
      return undefined;
    }

    // 提取路径部分，去除查询参数
    const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');

    // 提取最后的数字SKU（通常在最后一个连字符后）
    const lastDashIndex = pathPart.lastIndexOf('-');
    if (lastDashIndex === -1) {
      return undefined;
    }

    const potentialSKU = pathPart.substring(lastDashIndex + 1);

    // 验证是否为纯数字且长度合理（通常6位以上）
    if (/^\d{6,}$/.test(potentialSKU)) {
      return potentialSKU;
    }

    return undefined;
  }

  /**
   * 提取商品标题
   */
  private extractProductTitle(element: HTMLElement, lang: 'ru' | 'cn'): string | undefined {
    // OZON商品标题通常在span.tsBody500Medium或类似类中
    const titleElement = element.querySelector('span.tsBody500Medium, span[class*="tsBody"]');
    const title = titleElement?.textContent?.trim();

    if (!title) return undefined;

    // 暂时只提供俄文标题（中文翻译需要额外处理）
    return lang === 'ru' ? title : undefined;
  }

  /**
   * 提取商品链接
   */
  private extractLink(element: HTMLElement): string | undefined {
    const link = element.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    return link?.href;
  }

  /**
   * 提取商品图片
   */
  private extractImage(element: HTMLElement): string | undefined {
    // 排除上品帮注入的图片
    const img = element.querySelector<HTMLImageElement>('img:not(.ozon-bang-img)');
    return img?.src;
  }

  /**
   * 提取价格
   */
  private extractPrice(element: HTMLElement, type: 'current' | 'original'): number | undefined {
    if (type === 'current') {
      // 当前价格通常在 [class*="price"] span 中
      const priceElement = element.querySelector('[class*="price"] span');
      const priceText = priceElement?.textContent?.trim();
      if (!priceText) return undefined;

      // 移除货币符号和空格
      const cleanedPrice = priceText.replace(/[₽\s]/g, '');
      return cleanNumber(cleanedPrice);
    }

    // 原价提取逻辑（通常有删除线）
    const originalPriceElement = element.querySelector('[class*="strikethrough"], [class*="old-price"]');
    if (!originalPriceElement) return undefined;

    const priceText = originalPriceElement.textContent?.trim();
    if (!priceText) return undefined;

    const cleanedPrice = priceText.replace(/[₽\s]/g, '');
    return cleanNumber(cleanedPrice);
  }

  /**
   * 提取评分
   */
  private extractRating(element: HTMLElement): number | undefined {
    // 查找包含 color: var(--textPremium) 样式的span
    const ratingSpans = element.querySelectorAll<HTMLSpanElement>('span[style*="--textPremium"]');

    for (const span of ratingSpans) {
      const text = span.textContent?.trim();
      // 匹配评分格式 (如: 4.3, 5.0)
      if (text && /^\d+(\.\d+)?$/.test(text)) {
        return cleanNumber(text);
      }
    }

    return undefined;
  }

  /**
   * 提取评价次数
   */
  private extractReviewCount(element: HTMLElement): number | undefined {
    // 查找包含 color: var(--textSecondary) 样式的span
    const reviewSpans = element.querySelectorAll<HTMLSpanElement>('span[style*="--textSecondary"]');

    for (const span of reviewSpans) {
      const text = span.textContent?.trim();
      if (!text) continue;

      // 提取纯数字（支持空格/逗号分隔，如 "9 860" 或 "9,860"）
      const numbersOnly = text.replace(/[^\d]/g, '');
      if (!numbersOnly || numbersOnly.length === 0) continue;

      const reviewCount = parseInt(numbersOnly);

      // 验证：合理范围（1 到 10,000,000）且不包含小数点（排除评分）
      if (reviewCount >= 1 && reviewCount <= 10000000 && !text.includes('.')) {
        return reviewCount;
      }
    }

    return undefined;
  }

  /**
   * 提取配送天数
   */
  private extractDeliveryDays(element: HTMLElement): number | undefined {
    const delivery = element.querySelector('[class*="delivery"], [class*="shipping"]');
    const deliveryText = delivery?.textContent?.trim();

    if (!deliveryText) return undefined;

    // 提取数字（例如："2-3天" -> 3）
    const match = deliveryText.match(/(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }

    return undefined;
  }

  /**
   * 从上品帮注入的DOM中提取数据
   */
  private extractBangData(element: HTMLElement): Partial<ProductData> {
    const bangElement = element.querySelector('.ozon-bang-item, [class*="ozon-bang"]');
    if (!bangElement) {
      return {};
    }

    const bangText = bangElement.textContent || '';

    // 检查是否有实际内容
    if (!bangText.trim() || bangText.length < 10) {
      return {};
    }

    const bangData: Partial<ProductData> = {};

    // 提取品牌
    const firstLine = bangText.split(/[rF]/)[0].trim();
    if (firstLine && !firstLine.includes('：') && !firstLine.includes('%') && firstLine.length < 50) {
      bangData.brand = firstLine;
    } else {
      const brandMatch = bangText.match(/品牌[：:]\s*([^r\n]+?)(?:rFBS|FBP|$)/);
      if (brandMatch) {
        bangData.brand = brandMatch[1].trim();
      }
    }

    // 提取佣金率
    bangData.rfbs_commission_mid = this.extractCommissionFromText(bangText, 'rFBS', '1501~5000');
    bangData.rfbs_commission_low = this.extractCommissionFromText(bangText, 'rFBS', '<=1500');
    bangData.rfbs_commission_high = this.extractCommissionFromText(bangText, 'rFBS', '>5000');
    bangData.fbp_commission_mid = this.extractCommissionFromText(bangText, 'FBP', '1501~5000');
    bangData.fbp_commission_low = this.extractCommissionFromText(bangText, 'FBP', '<=1500');
    bangData.fbp_commission_high = this.extractCommissionFromText(bangText, 'FBP', '>5000');

    // 提取销售数据
    const monthSalesMatch = bangText.match(/月销量[：:]\s*(\d+(?:\.\d+)?)\s*件/);
    if (monthSalesMatch) {
      bangData.monthly_sales_volume = cleanNumber(monthSalesMatch[1]);
    }

    const monthRevenueMatch = bangText.match(/月销售额[：:]\s*([\d.]+)\s*万?\s*[₽￥]/);
    if (monthRevenueMatch) {
      let value = parseFloat(monthRevenueMatch[1]);
      // 如果包含"万"，需要转换
      if (bangText.match(/万\s*[₽￥]/)) {
        value = value * 10000;
      }
      bangData.monthly_sales_revenue = value;
    }

    const daySalesMatch = bangText.match(/日销量[：:]\s*(\d+(?:\.\d+)?)\s*件/);
    if (daySalesMatch) {
      bangData.daily_sales_volume = cleanNumber(daySalesMatch[1]);
    }

    const dayRevenueMatch = bangText.match(/日销售额[：:]\s*([\d.]+)\s*[₽￥]/);
    if (dayRevenueMatch) {
      bangData.daily_sales_revenue = cleanNumber(dayRevenueMatch[1]);
    }

    // 提取其他数据
    bangData.sales_dynamic_percent = this.extractPercentFromText(bangText, '销售动态');
    bangData.conversion_rate = this.extractPercentFromText(bangText, '成交率');
    bangData.availability_percent = this.extractPercentFromText(bangText, '商品可用性');
    bangData.ad_cost_share = this.extractPercentFromText(bangText, '广告费用份额');

    // 提取物流数据
    bangData.package_weight = this.extractNumberFromText(bangText, '包装重量', 'g');
    bangData.package_volume = this.extractNumberFromText(bangText, '商品体积', '升');
    bangData.package_length = this.extractNumberFromText(bangText, '包装长', 'mm');
    bangData.package_width = this.extractNumberFromText(bangText, '包装宽', 'mm');
    bangData.package_height = this.extractNumberFromText(bangText, '包装高', 'mm');

    // 提取卖家类型
    const sellerMatch = bangText.match(/卖家类型[：:]\s*([^\n]+)/);
    if (sellerMatch) {
      bangData.seller_type = sellerMatch[1].trim();
    }

    // 提取跟卖者数量
    const competitorMatch = bangText.match(/跟卖者数量[：:]\s*(\d+)/);
    if (competitorMatch) {
      bangData.competitor_count = cleanNumber(competitorMatch[1]);
    }

    // 提取跟卖最低价
    const competitorPriceMatch = bangText.match(/最低跟卖价[：:]\s*([\d.]+)\s*[₽￥]/);
    if (competitorPriceMatch) {
      bangData.competitor_min_price = cleanNumber(competitorPriceMatch[1]);
    }

    // 提取商品创建日期
    const dateMatch = bangText.match(/商品创建日期[：:]\s*(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      try {
        bangData.product_created_date = new Date(dateMatch[1]);
      } catch {
        // 日期解析失败，忽略
      }
    }

    return bangData;
  }

  /**
   * 从文本中提取佣金率
   */
  private extractCommissionFromText(text: string, type: 'rFBS' | 'FBP', range: string): number | undefined {
    // 支持₽和￥，支持中文全角括号（）和半角括号()
    const pattern = new RegExp(`${type}佣金[（(]${range}[₽￥][）)][：:]\\s*(\\d+(?:\\.\\d+)?)\\s*%`);
    const match = text.match(pattern);

    if (match) {
      return cleanPercent(match[1]);
    }

    return undefined;
  }

  /**
   * 从文本中提取百分比
   */
  private extractPercentFromText(text: string, label: string): number | undefined {
    const pattern = new RegExp(`${label}[：(（]?\\s*(\\d+(?:\\.\\d+)?)\\s*%`);
    const match = text.match(pattern);

    if (match) {
      return cleanPercent(match[1]);
    }

    return undefined;
  }

  /**
   * 从文本中提取数字（带单位）
   */
  private extractNumberFromText(text: string, label: string, unit: string): number | undefined {
    const pattern = new RegExp(`${label}[：(（]?\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`);
    const match = text.match(pattern);

    if (match) {
      return cleanNumber(match[1]);
    }

    return undefined;
  }
}
