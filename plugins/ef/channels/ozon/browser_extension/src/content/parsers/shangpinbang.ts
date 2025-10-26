import type { PageDataParser, ProductData } from './base';
import { cleanNumber, normalizeBrand } from './base';

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
    // 必须从 <a href*="/product/"> 标签内提取标题,避免匹配到价格区域
    const linkElement = element.querySelector('a[href*="/product/"]');
    if (!linkElement) {
      console.debug('[ShangpinbangParser] 未找到商品链接', { element });
      return undefined;
    }

    // 优先使用更精确的选择器路径（匹配OZON最新页面结构）
    let titleElement = linkElement.querySelector('div[class*="bq03"] span.tsBody500Medium');

    // 备用方案1：直接查找 tsBody500Medium
    if (!titleElement) {
      titleElement = linkElement.querySelector('span.tsBody500Medium');
    }

    // 备用方案2：查找任何包含商品名的div（排除价格区域）
    if (!titleElement) {
      const allSpans = linkElement.querySelectorAll('span[class*="tsBody"]');
      // 选择最长的文本（通常是商品名称，价格文本较短）
      let longest: Element | null = null;
      let maxLength = 0;
      allSpans.forEach(span => {
        const text = span.textContent?.trim() || '';
        // 排除纯数字（价格）和过短的文本
        if (text.length > maxLength && text.length > 10 && !/^\d+(\.\d+)?$/.test(text)) {
          longest = span;
          maxLength = text.length;
        }
      });
      titleElement = longest;
    }

    const title = titleElement?.textContent?.trim();

    console.debug('[ShangpinbangParser] 提取标题:', {
      found: !!titleElement,
      title,
      selector: titleElement?.className
    });

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
      // OZON当前价格标准类名: tsHeadline500Medium (不带删除线)
      const priceElement = element.querySelector('span.tsHeadline500Medium:not([class*="strikethrough"]), span.c35_3_11-a1.tsHeadline500Medium');
      if (!priceElement) return undefined;

      const priceText = priceElement.textContent?.trim();
      if (!priceText) return undefined;

      // 移除货币符号和空格
      const cleanedPrice = priceText.replace(/[₽¥\s]/g, '');
      return cleanNumber(cleanedPrice);
    }

    // 原价: 查找带删除线的价格 (tsBodyControl400Small + c35_3_11-b)
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
   * 从上品帮注入的DOM中提取数据（新结构化格式）
   */
  private extractBangData(element: HTMLElement): Partial<ProductData> {
    const bangElement = element.querySelector('.ozon-bang-item, [class*="ozon-bang"]');
    if (!bangElement) {
      return {};
    }

    // 提取所有 li 元素中的数据
    const listItems = bangElement.querySelectorAll<HTMLElement>('li .text-class');
    if (!listItems || listItems.length === 0) {
      return {};
    }

    const bangData: Partial<ProductData> = {};

    listItems.forEach(item => {
      const labelElement = item.querySelector('span');
      const valueElement = item.querySelector('b');

      if (!labelElement || !valueElement) {
        return;
      }

      const label = labelElement.textContent?.trim() || '';
      const value = valueElement.textContent?.trim() || '';

      // 允许空字符串value（佣金字段需要解析子元素）
      if (!label) {
        return;
      }

      // 跳过"无数据"和"-"值（但允许空字符串）
      if (value === '无数据' || value === '-') {
        return;
      }

      // 传递 valueElement 以便解析嵌套结构
      this.parseFieldByLabel(label, value, valueElement, bangData);
    });

    return bangData;
  }

  /**
   * 根据标签名解析字段值
   */
  private parseFieldByLabel(label: string, value: string, valueElement: HTMLElement, data: Partial<ProductData>): void {
    // 移除标签中的冒号和空格
    const cleanLabel = label.replace(/[：:]/g, '').trim();

    switch (cleanLabel) {
      // 基础信息
      case '类目':
        data.category_path = value;
        break;
      case '品牌':
        data.brand = value;
        break;
      case 'SKU':
        data.product_id = value;
        break;

      // rFBS佣金（三个档位）
      case 'rFBS佣金':
        const [rfbsHigh, rfbsMid, rfbsLow] = this.parseCommissionValues(valueElement);
        data.rfbs_commission_high = rfbsHigh;
        data.rfbs_commission_mid = rfbsMid;
        data.rfbs_commission_low = rfbsLow;
        break;

      // FBP佣金（三个档位）
      case 'FBP佣金':
        const [fbpHigh, fbpMid, fbpLow] = this.parseCommissionValues(valueElement);
        data.fbp_commission_high = fbpHigh;
        data.fbp_commission_mid = fbpMid;
        data.fbp_commission_low = fbpLow;
        break;

      // 销售数据
      case '月销量':
        data.monthly_sales_volume = this.parseNumber(value);
        break;
      case '月销售额':
        data.monthly_sales_revenue = this.parsePrice(value);
        break;
      case '日销量':
        data.daily_sales_volume = this.parseNumber(value);
        break;
      case '日销售额':
        data.daily_sales_revenue = this.parsePrice(value);
        break;
      case '月销售动态':
      case '销售动态':
        data.sales_dynamic_percent = this.parsePercent(value);
        break;

      // 营销分析字段（新增）
      case '商品卡片浏览量':
        data.card_views = this.parseNumber(value);
        break;
      case '商品卡片加购率':
        data.card_add_to_cart_rate = this.parsePercent(value);
        break;
      case '搜索和目录浏览量':
        data.search_views = this.parseNumber(value);
        break;
      case '搜索和目录加购率':
        data.search_add_to_cart_rate = this.parsePercent(value);
        break;
      case '点击率':
        data.click_through_rate = this.parsePercent(value);
        break;
      case '参与促销天数':
        data.promo_days = this.parseDays(value);
        break;
      case '参与促销的折扣':
        data.promo_discount_percent = this.parsePercent(value);
        break;
      case '促销活动的转化率':
        data.promo_conversion_rate = this.parsePercent(value);
        break;
      case '付费推广天数':
        data.paid_promo_days = this.parseDays(value);
        break;
      case '成交率':
        data.conversion_rate = this.parsePercent(value);
        break;
      case '退货取消率':
        data.return_cancel_rate = this.parsePercent(value);
        break;

      // 价格
      case '平均价格':
        data.avg_price = this.parsePrice(value);
        break;

      // 广告
      case '广告份额':
      case '广告费用份额':
        data.ad_cost_share = this.parsePercent(value);
        break;

      // 物流信息
      case '包装重量':
        data.package_weight = this.parseNumber(value);
        break;
      case '长宽高(mm)':
        this.parseDimensions(value, data);
        break;
      case '发货模式':
        data.seller_mode = value;
        data.seller_type = value; // 同时设置 seller_type 保持兼容
        break;

      // 跟卖信息
      case '跟卖者':
        data.competitor_count = this.parseCompetitorCount(value);
        break;
      case '跟卖最低价':
        data.competitor_min_price = this.parsePrice(value);
        break;

      // 日期
      case '上架时间':
        this.parseListingDate(value, data);
        break;
    }
  }

  /**
   * 解析数字（支持空格、逗号分隔）
   */
  private parseNumber(value: string): number | undefined {
    const cleaned = value.replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 解析价格（支持"万"单位）
   */
  private parsePrice(value: string): number | undefined {
    // 移除货币符号
    const cleaned = value.replace(/[₽￥\s]/g, '');

    // 检查是否包含"万"
    const hasWan = value.includes('万');
    const numStr = cleaned.replace(/万/g, '');

    const num = parseFloat(numStr);
    if (isNaN(num)) return undefined;

    return hasWan ? num * 10000 : num;
  }

  /**
   * 解析百分比
   */
  private parsePercent(value: string): number | undefined {
    const cleaned = value.replace(/[%\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 解析天数（从"8天"中提取数字）
   */
  private parseDays(value: string): number | undefined {
    const match = value.match(/(\d+)/);
    if (!match) return undefined;
    return parseInt(match[1]);
  }

  /**
   * 解析尺寸（从"420* 365 * 370"中提取三个数字）
   */
  private parseDimensions(value: string, data: Partial<ProductData>): void {
    const parts = value.split('*').map(p => p.trim());
    if (parts.length >= 3) {
      data.package_length = this.parseNumber(parts[0]);
      data.package_width = this.parseNumber(parts[1]);
      data.package_height = this.parseNumber(parts[2]);
    }
  }

  /**
   * 解析跟卖者数量（从"等8个卖家"中提取数字）
   */
  private parseCompetitorCount(value: string): number | undefined {
    const match = value.match(/等(\d+)个/);
    if (!match) return undefined;
    return parseInt(match[1]);
  }

  /**
   * 解析上架时间（从"2022-08-17 (1163天)"中提取日期和天数）
   */
  private parseListingDate(value: string, data: Partial<ProductData>): void {
    // 提取日期
    const dateMatch = value.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      try {
        data.listing_date = new Date(dateMatch[1]);
      } catch {
        // 忽略解析失败
      }
    }

    // 提取天数
    const daysMatch = value.match(/\((\d+)天\)/);
    if (daysMatch) {
      data.listing_days = parseInt(daysMatch[1]);
    }
  }

  /**
   * 解析佣金值（从三个ant-tag标签中提取）
   * @param valueElement 包含佣金数据的 <b> 元素
   * @returns [high, mid, low] 三个佣金百分比值
   */
  private parseCommissionValues(valueElement: HTMLElement): [number | undefined, number | undefined, number | undefined] {
    // 查找所有 ant-tag 标签
    const tags = valueElement.querySelectorAll<HTMLElement>('.ant-tag');

    if (tags.length < 3) {
      return [undefined, undefined, undefined];
    }

    // 按顺序提取: lime(>5000₽), orange(1501~5000₽), magenta(≤1500₽)
    const high = this.parsePercent(tags[0].textContent || '');
    const mid = this.parsePercent(tags[1].textContent || '');
    const low = this.parsePercent(tags[2].textContent || '');

    return [high, mid, low];
  }
}
