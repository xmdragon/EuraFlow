import type { PageDataParser, ProductData } from './base';
import { normalizeBrand } from './base';

/**
 * 毛子ERP数据解析器
 *
 * 从毛子ERP注入的DOM中提取商品数据
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
    // 查找商品卡片内的毛子ERP容器
    const mzWidget = cardElement.querySelector('[data-mz-widget]');
    if (!mzWidget) {
      return {};
    }

    const data: Partial<ProductData> = {};

    // SKU
    data.product_id = this.extractText(mzWidget, 'SKU');

    // 品牌（优先级高）
    const brand = this.extractText(mzWidget, '品牌');
    if (brand) {
      data.brand = brand;
      data.brand_normalized = normalizeBrand(brand);
    }

    // 佣金（三档完整）
    data.rfbs_commission_low = this.extractCommission(mzWidget, 'rFBS佣金', 0);
    data.rfbs_commission_mid = this.extractCommission(mzWidget, 'rFBS佣金', 1);
    data.rfbs_commission_high = this.extractCommission(mzWidget, 'rFBS佣金', 2);
    data.fbp_commission_low = this.extractCommission(mzWidget, 'FBP佣金', 0);
    data.fbp_commission_mid = this.extractCommission(mzWidget, 'FBP佣金', 1);
    data.fbp_commission_high = this.extractCommission(mzWidget, 'FBP佣金', 2);

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
    const targetDiv = divs.find(div => {
      const text = div.textContent || '';
      return text.includes(`${label}：`);
    });

    if (!targetDiv) return undefined;

    const span = targetDiv.querySelector('span:nth-of-type(2)');
    const text = span?.textContent?.trim();

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
    const text = this.extractText(widget, label); // "₽1715.6 ≈ ¥150.63"
    if (!text) return undefined;

    // 提取卢布金额
    const match = text.match(/₽([\d.]+)/);
    if (!match) return undefined;

    const num = parseFloat(match[1]);
    return isNaN(num) ? undefined : num;
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
