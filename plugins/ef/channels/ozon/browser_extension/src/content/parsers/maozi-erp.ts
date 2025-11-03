import type { PageDataParser, ProductData } from './base';
import { cleanNumber, normalizeBrand } from './base';

/**
 * 毛子ERP数据解析器
 *
 * 从毛子ERP注入的DOM和OZON原生页面中提取商品数据
 */
export class MaoziErpParser implements PageDataParser {
  readonly toolName = 'maozi-erp';
  readonly displayName = '毛子ERP';

  isInjected(): boolean {
    // 检测毛子ERP的特征DOM
    return !!document.querySelector('[data-mz-widget]');
  }

  async waitForInjection(): Promise<void> {
    // 等待毛子ERP完成数据注入（最多3秒，每200ms检查一次）
    const maxWait = 3000;
    const interval = 200;

    for (let i = 0; i < maxWait / interval; i++) {
      if (this.isInjected()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  async parseProductCard(cardElement: HTMLElement): Promise<Partial<ProductData>> {
    // 1. 提取OZON原生数据（商品标题、价格、评分等）
    const ozonData = this.extractOzonData(cardElement);

    // 2. 提取毛子ERP注入的数据
    const mzWidget = cardElement.querySelector('[data-mz-widget]');
    if (!mzWidget) {
      return ozonData;
    }

    const mzData = this.extractMzData(mzWidget);

    // 3. 合并数据（毛子ERP数据优先级更高）
    return {
      ...ozonData,
      ...mzData,
      // 标准化品牌名
      brand_normalized: normalizeBrand(mzData.brand || ozonData.brand)
    };
  }

  /**
   * 立即提取商品卡片数据（不等待数据加载）
   *
   * 毛子ERP数据是同步注入的，没有异步加载延迟，
   * 因此直接复用 parseProductCard 的逻辑
   */
  async parseProductCardImmediate(cardElement: HTMLElement): Promise<Partial<ProductData>> {
    return this.parseProductCard(cardElement);
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

    const urlParts = link.href.split('/product/');
    if (urlParts.length <= 1) {
      return undefined;
    }

    const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
    const lastDashIndex = pathPart.lastIndexOf('-');
    if (lastDashIndex === -1) {
      return undefined;
    }

    const potentialSKU = pathPart.substring(lastDashIndex + 1);
    if (/^\d{6,}$/.test(potentialSKU)) {
      return potentialSKU;
    }

    return undefined;
  }

  /**
   * 提取商品标题
   */
  private extractProductTitle(element: HTMLElement, lang: 'ru' | 'cn'): string {
    const titleElement = element.querySelector('div.si2_24 a[href*="/product/"] span.tsBody500Medium');
    const title = titleElement?.textContent?.trim();

    if (!title) {
      return '';
    }

    return lang === 'ru' ? title : '';
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
    const img = element.querySelector<HTMLImageElement>('img:not([data-mz-widget])');
    return img?.src;
  }

  /**
   * 提取价格
   */
  private extractPrice(element: HTMLElement, type: 'current' | 'original'): number | undefined {
    if (type === 'current') {
      const priceElement = element.querySelector('span.tsHeadline500Medium:not([class*="strikethrough"]), span.c35_3_11-a1.tsHeadline500Medium');
      if (!priceElement) return undefined;

      const priceText = priceElement.textContent?.trim();
      if (!priceText) return undefined;

      const cleanedPrice = priceText.replace(/[₽¥\s]/g, '');
      return cleanNumber(cleanedPrice);
    }

    const originalPriceElement = element.querySelector('span.tsBodyControl400Small.c35_3_11-b, span.c35_3_11-a1.c35_3_11-b');
    if (!originalPriceElement) return undefined;

    const priceText = originalPriceElement.textContent?.trim();
    if (!priceText) return undefined;

    const cleanedPrice = priceText.replace(/[₽¥\s]/g, '');
    return cleanNumber(cleanedPrice);
  }

  /**
   * 提取评分
   */
  private extractRating(element: HTMLElement): number | undefined {
    const ratingSpans = element.querySelectorAll<HTMLSpanElement>('span[style*="--textPremium"]');

    for (const span of ratingSpans) {
      const text = span.textContent?.trim();
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
    const reviewSpans = element.querySelectorAll<HTMLSpanElement>('span[style*="--textSecondary"]');

    for (const span of reviewSpans) {
      const text = span.textContent?.trim();
      if (!text) continue;

      const numbersOnly = text.replace(/[^\d]/g, '');
      if (!numbersOnly || numbersOnly.length === 0) continue;

      const reviewCount = parseInt(numbersOnly);

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

    if (!deliveryText) return 0;

    const match = deliveryText.match(/(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }

    return 0;
  }

  /**
   * 从毛子ERP注入的DOM中提取数据
   */
  private extractMzData(mzWidget: Element): Partial<ProductData> {
    const data: Partial<ProductData> = {};

    // SKU
    data.product_id = this.extractText(mzWidget, 'SKU');

    // 类目
    data.category_path = this.extractText(mzWidget, '类目');

    // 品牌（优先级高）
    const brand = this.extractText(mzWidget, '品牌');
    if (brand) {
      data.brand = brand;
      data.brand_normalized = normalizeBrand(brand);
    }

    // 佣金（三档完整，注意顺序：tag[0]=high, tag[1]=mid, tag[2]=low）
    data.rfbs_commission_high = this.extractCommission(mzWidget, 'rFBS佣金', 0);
    data.rfbs_commission_mid = this.extractCommission(mzWidget, 'rFBS佣金', 1);
    data.rfbs_commission_low = this.extractCommission(mzWidget, 'rFBS佣金', 2);
    data.fbp_commission_high = this.extractCommission(mzWidget, 'FBP佣金', 0);
    data.fbp_commission_mid = this.extractCommission(mzWidget, 'FBP佣金', 1);
    data.fbp_commission_low = this.extractCommission(mzWidget, 'FBP佣金', 2);

    // 销量数据
    data.monthly_sales_volume = this.extractNumber(mzWidget, '月销量');
    data.monthly_sales_revenue = this.extractRubles(mzWidget, '月销售额');
    data.daily_sales_volume = this.extractNumber(mzWidget, '日销量');
    data.daily_sales_revenue = this.extractRubles(mzWidget, '日销售额');
    data.sales_dynamic_percent = this.extractPercent(mzWidget, '月周转动态');

    // 物流数据（优先级高）
    data.package_weight = this.extractWeight(mzWidget, '重 量');
    data.package_length = this.extractDimension(mzWidget, '长 宽 高', 0);
    data.package_width = this.extractDimension(mzWidget, '长 宽 高', 1);
    data.package_height = this.extractDimension(mzWidget, '长 宽 高', 2);

    // 其他数据
    data.ad_cost_share = this.extractPercent(mzWidget, '广告费占比');
    data.seller_type = this.extractText(mzWidget, '发货模式'); // "FBS" 或 "FBO"
    data.product_created_date = this.extractDate(mzWidget, '上架时间');

    // 竞争对手数据
    data.competitor_count = this.extractCompetitorCount(mzWidget, '跟卖列表');
    data.competitor_min_price = this.extractCompetitorPrice(mzWidget, '跟卖最低价');

    // 营销分析字段
    data.card_views = this.extractNumber(mzWidget, '商品卡浏览量');
    data.card_add_to_cart_rate = this.extractPercent(mzWidget, '商品卡加购率');
    data.search_views = this.extractNumber(mzWidget, '搜索目录浏览量');
    data.search_add_to_cart_rate = this.extractPercent(mzWidget, '搜索目录加购率');
    data.click_through_rate = this.extractPercent(mzWidget, '商品点击率');
    data.promo_days = this.extractNumber(mzWidget, '参与促销天数');
    data.promo_discount_percent = this.extractPercent(mzWidget, '参与促销的折扣');
    data.paid_promo_days = this.extractNumber(mzWidget, '付费推广天数');
    data.return_cancel_rate = this.extractPercent(mzWidget, '退货取消率');

    // 转化率相关（毛子ERP可能有多个转化率，需要选择合适的）
    const promotionConversion = this.extractPercent(mzWidget, '促销活动的转化率');
    const displayConversion = this.extractPercent(mzWidget, '展示转化率');
    // 优先使用促销转化率
    data.conversion_rate = promotionConversion || displayConversion;

    return data;
  }

  /**
   * 提取文本字段
   */
  private extractText(widget: Element, label: string): string | undefined {
    const divs = Array.from(widget.querySelectorAll('div'));

    // 查找包含标签的div（必须是直接子span，避免匹配到父容器）
    const targetDiv = divs.find(div => {
      const children = Array.from(div.children);
      const spans = children.filter(child => child.tagName === 'SPAN');
      if (spans.length < 2) return false;

      const firstSpan = spans[0];
      return firstSpan?.textContent?.includes(`${label}：`);
    });

    if (!targetDiv) return undefined;

    // 获取第二个直接子span的文本
    const children = Array.from(targetDiv.children);
    const spans = children.filter(child => child.tagName === 'SPAN');
    const valueSpan = spans[1] as HTMLElement;
    const text = valueSpan?.textContent?.trim();

    // 过滤无效值
    if (!text || text === '--' || text === '无' || text === 'null') {
      return undefined;
    }

    return text;
  }

  /**
   * 提取佣金（从Tag中）
   */
  private extractCommission(widget: Element, label: string, index: number): number | undefined {
    const divs = Array.from(widget.querySelectorAll('div'));
    const targetDiv = divs.find(div => div.textContent?.includes(`${label}：`));

    if (!targetDiv) return undefined;

    const tags = targetDiv.querySelectorAll('.ant-tag');
    const tagText = tags[index]?.textContent?.trim(); // "12%"

    if (!tagText) return undefined;

    const num = parseFloat(tagText.replace('%', ''));
    return isNaN(num) ? undefined : num;
  }

  /**
   * 提取数字
   */
  private extractNumber(widget: Element, label: string): number | undefined {
    const text = this.extractText(widget, label);
    if (!text) return undefined;

    const num = parseFloat(text);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 提取卢布金额
   */
  private extractRubles(widget: Element, label: string): number | undefined {
    const text = this.extractText(widget, label); // "₽22.74万 ≈ ¥2.03万" 或 "₽1715.6 ≈ ¥150.63"
    if (!text) return undefined;

    // 提取卢布金额（支持"万"单位）
    const match = text.match(/₽([\d.]+)(万)?/);
    if (!match) return undefined;

    let num = parseFloat(match[1]);
    if (isNaN(num)) return undefined;

    // 如果有"万"单位，乘以10000
    if (match[2] === '万') {
      num = num * 10000;
    }

    return num;
  }

  /**
   * 提取百分比
   */
  private extractPercent(widget: Element, label: string): number | undefined {
    const text = this.extractText(widget, label);
    if (!text) return undefined;

    const match = text.match(/([\d.]+)%/);
    if (!match) return undefined;

    const num = parseFloat(match[1]);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 提取重量
   */
  private extractWeight(widget: Element, label: string): number | undefined {
    const text = this.extractText(widget, label); // "560g"
    if (!text) return undefined;

    const match = text.match(/(\d+)g/);
    if (!match) return undefined;

    return parseInt(match[1]);
  }

  /**
   * 提取尺寸
   */
  private extractDimension(widget: Element, label: string, index: number): number | undefined {
    const text = this.extractText(widget, label); // "390 x 285 x 62mm"
    if (!text) return undefined;

    const parts = text.split('x').map(s => s.trim().replace('mm', ''));
    if (!parts[index]) return undefined;

    const num = parseInt(parts[index]);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 提取日期
   */
  private extractDate(widget: Element, label: string): Date | undefined {
    const text = this.extractText(widget, label); // "2024-04-18(548天)"
    if (!text) return undefined;

    const match = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (!match) return undefined;

    try {
      return new Date(match[1]);
    } catch {
      return undefined;
    }
  }

  /**
   * 提取跟卖数量
   */
  private extractCompetitorCount(widget: Element, label: string): number | undefined {
    const text = this.extractText(widget, label);

    // "无"表示0个跟卖
    if (text === '无') {
      return 0;
    }

    const num = parseInt(text || '');
    return isNaN(num) ? undefined : num;
  }

  /**
   * 提取跟卖价格
   */
  private extractCompetitorPrice(widget: Element, label: string): number | undefined {
    const text = this.extractText(widget, label);

    // "无"表示null
    if (text === '无') {
      return undefined;
    }

    const match = text?.match(/₽([\d.]+)/);
    if (!match) return undefined;

    const num = parseFloat(match[1]);
    return isNaN(num) ? undefined : num;
  }
}
