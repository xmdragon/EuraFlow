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

  /**
   * 等待单个商品卡片的数据完整注入（特别是跟卖数据）
   * 参考用户脚本的智能等待逻辑
   */
  async waitForCardData(cardElement: HTMLElement, maxWait = 2000): Promise<boolean> {
    const interval = 200;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // 使用正确的选择器（与collector.ts保持一致）
      const bangElement = cardElement.querySelector('.ozon-bang-item[data-ozon-bang="true"]') as HTMLElement;

      if (bangElement) {
        const bangText = bangElement.textContent || '';
        const bangHtml = bangElement.innerHTML || '';

        // 数据完整性检查条件（对齐用户脚本）
        // 1. 内容充足（> 50字符）
        const hasContent = bangText.trim().length > 50;

        // 2. 检查跟卖数据（支持多种格式）
        // 跟卖最低价：xxx ¥
        const hasMinPrice = /跟卖最低价[：:]\s*[\d\s,．]+\s*[¥₽]/.test(bangText);
        // 跟卖最低价：无跟卖
        const hasNoCompetitorPrice = /跟卖最低价[：:]\s*无跟卖/.test(bangText);
        // 跟卖者：无跟卖
        const hasNoCompetitorSeller = /跟卖者[：:]\s*.*无跟卖/.test(bangText);
        // 等X个卖家（HTML格式）
        const hasSellerCount = />(\d+)<\/span>\s*个卖家/.test(bangHtml) || /等\d+个卖家/.test(bangText);

        // 任何一种跟卖数据格式都算有效
        const hasCompetitorData = hasMinPrice || hasNoCompetitorPrice || hasNoCompetitorSeller || hasSellerCount;

        // 3. 检查佣金数据（新格式：支持多个佣金段）
        const hasRFBSCommission = /rFBS佣金[：:]/.test(bangText) && /%/.test(bangText);
        const hasFBPCommission = /FBP佣金[：:]/.test(bangText) && /%/.test(bangText);

        // 4. 检查包装重量（上品帮最后加载的字段，必须等待加载完成）
        const hasPackageWeight = /包装重量[：:]\s*(?!-)(?!无数据)[\d\s,．]+/.test(bangText);

        // 数据就绪条件：内容充足 + 跟卖数据 + 佣金数据 + 包装重量已加载
        if (hasContent && hasCompetitorData && (hasRFBSCommission || hasFBPCommission) && hasPackageWeight) {
          return true;
        }
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    // 超时后返回false，但不抛出错误（允许部分数据采集）
    return false;
  }

  async parseProductCard(cardElement: HTMLElement): Promise<Partial<ProductData>> {
    // 尝试等待数据完整注入（但不阻塞采集）
    await this.waitForCardData(cardElement);

    // 提取OZON原生数据（总是可以提取的）
    const ozonData = this.extractOzonData(cardElement);

    // 提取上品帮注入的数据
    const bangData = this.extractBangData(cardElement);

    // 只有在真正没有提取到跟卖数据时才跳过
    // competitor_count 或 competitor_min_price 为 0 表示"无跟卖"，也是有效数据
    // 只有都是 undefined 才表示数据缺失

    // 合并数据
    return {
      ...ozonData,
      ...bangData,
      // 标准化品牌名
      brand_normalized: normalizeBrand(bangData.brand || ozonData.brand)
    };
  }

  /**
   * 立即提取商品卡片数据（不等待上品帮数据加载）
   *
   * 用于两阶段采集：
   * 1. 快速采集阶段：立即提取已有数据
   * 2. 轮询增强阶段：补充未加载的关键数据
   */
  async parseProductCardImmediate(cardElement: HTMLElement): Promise<Partial<ProductData>> {
    // 提取OZON原生数据（总是可用，从链接/标题/价格中提取）
    const ozonData = this.extractOzonData(cardElement);

    // 提取上品帮当前已有数据（不等待，有就提取，没有就undefined）
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
   * 实际结构（新版）: <a href="/product/..."> <div class="it1_24"> <span class="tsBody500Medium">标题</span> </div> </a>
   * 实际结构（旧版）: <div class="si2_24"> <a> <span> </span> </a> </div>
   */
  private extractProductTitle(element: HTMLElement, lang: 'ru' | 'cn'): string {
    let titleElement = null;

    // 策略1: 新版结构 - a > div > span（2024年11月之后）
    titleElement = element.querySelector('a[href*="/product/"] div span.tsBody500Medium');

    // 策略2: 旧版结构 - div > a > span（2024年11月之前）
    if (!titleElement) {
      titleElement = element.querySelector('div[class*="si"] a[href*="/product/"] span.tsBody500Medium');
    }

    // 策略3: 只匹配关键类名（最宽松）
    if (!titleElement) {
      titleElement = element.querySelector('a[href*="/product/"] span.tsBody500Medium');
    }

    const title = titleElement?.textContent?.trim();

    if (!title) {
      // 中文返回空字符串，俄文返回空字符串（如果找不到标题）
      return '';
    }

    // 暂时只提供俄文标题（中文翻译需要额外处理，返回空字符串）
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

    if (!deliveryText) return 0;

    // 提取数字（例如："2-3天" -> 3）
    const match = deliveryText.match(/(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }

    return 0;
  }

  /**
   * 从上品帮注入的DOM中提取数据（新结构化格式）
   */
  private extractBangData(element: HTMLElement): Partial<ProductData> {
    const bangElement = element.querySelector('.ozon-bang-item, [class*="ozon-bang"]') as HTMLElement;
    if (!bangElement) {
      return {};
    }

    // 【优化】先获取SKU（用于DEBUG日志）
    // 优先从 data-sku 属性获取（阶段1采集时已添加），否则从URL提取
    const sku = element.getAttribute('data-sku') || this.extractSKU(element);

    // 方式1：结构化提取（现有方式）
    const structuredData = this.extractStructuredBangData(bangElement, sku);

    // 方式2：文本匹配提取（新增，作为补充）
    const textData = this.extractTextBangData(bangElement);

    // 【DEBUG】检查 structuredData 中的 package_weight
    if ((window as any).EURAFLOW_DEBUG && sku) {
      console.log(`[DEBUG extractBangData] SKU=${sku} structuredData.package_weight =`, structuredData.package_weight);
      console.log(`[DEBUG extractBangData] SKU=${sku} textData =`, textData);
    }

    // 合并两种方式的结果，textData 优先（因为它能处理HTML标签格式）
    const merged = { ...structuredData, ...textData };

    // 【DEBUG】检查合并后的 package_weight
    if ((window as any).EURAFLOW_DEBUG && sku) {
      console.log(`[DEBUG extractBangData] SKU=${sku} merged.package_weight =`, merged.package_weight);
    }

    return merged;
  }

  /**
   * 结构化提取（原有方式）
   * @param bangElement 上品帮数据元素
   * @param sku 商品SKU（用于DEBUG日志）
   */
  private extractStructuredBangData(bangElement: HTMLElement, sku?: string): Partial<ProductData> {
    // 提取所有 li 元素中的数据
    const listItems = bangElement.querySelectorAll<HTMLElement>('li .text-class');
    if (!listItems || listItems.length === 0) {
      return {};
    }

    const bangData: Partial<ProductData> = {};

    // 【DEBUG】打印找到的总字段数
    if ((window as any).EURAFLOW_DEBUG) {
      console.log(`[DEBUG extractStructuredBangData] SKU=${sku || '未知'} 找到 ${listItems.length} 个字段`);
    }

    listItems.forEach((item, index) => {
      // 【修复】必须选择标签span（直接子元素），避免误选 <b> 里的嵌套span
      // 结构: <div class="text-class"><span>标签：</span><b>值</b></div>
      // 或: <div class="text-class"><span><span>标签：</span></span><b>值</b></div>
      const labelSpan = item.querySelector('span');
      const labelElement = labelSpan?.querySelector('span') || labelSpan;
      const valueElement = item.querySelector('b');

      if (!labelElement || !valueElement) {
        if ((window as any).EURAFLOW_DEBUG) {
          console.log(`[DEBUG] SKU=${sku || '未知'} 第${index}项：labelElement=${!!labelElement}, valueElement=${!!valueElement}`);
        }
        return;
      }

      const label = labelElement.textContent?.trim() || '';
      const value = valueElement.textContent?.trim() || '';

      // 允许空字符串value（佣金字段需要解析子元素）
      if (!label) {
        return;
      }

      // 【DEBUG增强】仅在第1次遍历时打印所有字段标签（避免重复）
      if ((window as any).EURAFLOW_DEBUG && index === 0) {
        const allLabels = Array.from(listItems).map((li, i) => {
          // 【修复】使用与实际解析相同的选择器逻辑
          const labelSpan = li.querySelector('span');
          const lbl = labelSpan?.querySelector('span') || labelSpan;
          return `${i}: ${lbl?.textContent?.trim() || '(空)'}`;
        }).join(', ');
        console.log(`[DEBUG] SKU=${sku || '未知'} 所有字段: ${allLabels}`);
      }

      // 【增强DEBUG】输出关键字段的详细信息（但避免重复打印）
      if ((window as any).EURAFLOW_DEBUG && (label.includes('佣金') || label.includes('包装重量'))) {
        console.log(`[DEBUG extractStructuredBangData] SKU=${sku || '未知'} 第${index}项 标签="${label}" 值="${value}"`);
        console.log(`  valueElement: tagName=${valueElement.tagName}, class="${valueElement.className}"`);
        console.log(`  valueElement.innerHTML 前200字符:`, valueElement.innerHTML.substring(0, 200));
      }

      // 【修复】需要处理"无数据"的字段：佣金、包装重量
      const needsNoDataHandling = label.includes('rFBS佣金') ||
                                   label.includes('FBP佣金') ||
                                   label.includes('包装重量');

      // 跳过"-"值（加载中），但需要处理的字段例外
      // "无数据"不跳过，需要传递给 parseFieldByLabel 处理
      if (!needsNoDataHandling && value === '-') {
        return;
      }

      // 传递 valueElement 以便解析嵌套结构，传递 SKU 用于DEBUG
      this.parseFieldByLabel(label, value, valueElement, bangData, sku);
    });

    return bangData;
  }

  /**
   * 文本匹配提取（新增，参考用户脚本）
   */
  private extractTextBangData(bangElement: HTMLElement): Partial<ProductData> {
    const bangText = bangElement.textContent || '';
    const bangHtml = bangElement.innerHTML || '';
    const data: Partial<ProductData> = {};

    // 检查"跟卖者：无跟卖"的情况
    if (/跟卖者[：:]\s*无跟卖/.test(bangText)) {
      data.competitor_count = 0;
      data.competitor_min_price = 0;
    } else {
      // 跟卖者数量（支持两种格式）
      // 格式1: "等1个卖家"
      // 格式2: HTML标签格式 "<span style='color:red'>1</span>个卖家"
      const sellerCountMatch = bangText.match(/等(\d+)个卖家/) ||
                             bangHtml.match(/>(\d+)<\/span>\s*个卖家/);
      if (sellerCountMatch) {
        data.competitor_count = parseInt(sellerCountMatch[1]);
      }
    }

    // 跟卖最低价（只在没有设置过的情况下处理）
    if (data.competitor_min_price === undefined) {
      if (/跟卖最低价[：:]\s*无跟卖/.test(bangText)) {
        data.competitor_min_price = 0;
      } else {
        const priceMatch = bangText.match(/跟卖最低价[：:]\s*([\d\s,]+)/);
        if (priceMatch) {
          const cleanPrice = priceMatch[1].replace(/[\s,]/g, '');
          data.competitor_min_price = parseFloat(cleanPrice);
        }
      }
    }

    return data;
  }

  /**
   * 根据标签名解析字段值
   * @param label 字段标签
   * @param value 字段值
   * @param valueElement 值元素（用于解析嵌套结构）
   * @param data 数据对象
   * @param sku 商品SKU（用于DEBUG日志）
   */
  private parseFieldByLabel(label: string, value: string, valueElement: HTMLElement, data: Partial<ProductData>, sku?: string): void {
    // 移除标签中的冒号和空格
    const cleanLabel = label.replace(/[：:]/g, '').trim();

    switch (cleanLabel) {
      // 基础信息
      case '类目':
        data.category_path = value;
        // 后端会自动拆分一级和二级类目，无需在前端处理
        break;
      case '品牌':
        data.brand = value;
        break;
      case 'SKU':
        data.product_id = value;
        break;

      // rFBS佣金（三个档位）
      case 'rFBS佣金':
        // 【修正】正确区分数据状态：
        // 1. "-" = 加载中（上品帮还在渲染），保持 undefined 让轮询继续
        // 2. "无数据" = 已加载完成，上品帮确认无数据，设为 "-" 表示完整状态
        // 3. 有实际值 = 已加载完成，有佣金数据
        if (value === '-') {
          // 加载中，不设置任何值（保持 undefined），让阶段2轮询继续
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} rFBS佣金: 加载中（保持undefined）`);
          }
        } else if (value === '无数据' || value.trim() === '') {
          // 【修正】已加载完成，确认无数据，设为 0（后端只接受 int 或 None）
          data.rfbs_commission_high = 0;
          data.rfbs_commission_mid = 0;
          data.rfbs_commission_low = 0;
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} rFBS佣金: 确认无数据（设为0）`);
          }
        } else {
          // 有数据，解析三个档位（high, mid, low）
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} 开始解析 rFBS佣金`);
            console.log('  valueElement.innerHTML 前200字符:', valueElement.innerHTML.substring(0, 200));
          }
          const [rfbsHigh, rfbsMid, rfbsLow] = this.parseCommissionValues(valueElement);
          data.rfbs_commission_high = rfbsHigh;
          data.rfbs_commission_mid = rfbsMid;
          data.rfbs_commission_low = rfbsLow;
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`  解析结果: high=${rfbsHigh}%, mid=${rfbsMid}%, low=${rfbsLow}%`);
          }
        }
        break;

      // FBP佣金（三个档位）
      case 'FBP佣金':
        // 【修正】正确区分数据状态（与rFBS佣金相同）
        if (value === '-') {
          // 加载中，不设置任何值（保持 undefined），让阶段2轮询继续
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} FBP佣金: 加载中（保持undefined）`);
          }
        } else if (value === '无数据' || value.trim() === '') {
          // 【修正】已加载完成，确认无数据，设为 0（后端只接受 int 或 None）
          data.fbp_commission_high = 0;
          data.fbp_commission_mid = 0;
          data.fbp_commission_low = 0;
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} FBP佣金: 确认无数据（设为0）`);
          }
        } else {
          // 有数据，解析三个档位（high, mid, low）
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} 开始解析 FBP佣金`);
            console.log('  valueElement.innerHTML 前200字符:', valueElement.innerHTML.substring(0, 200));
          }
          const [fbpHigh, fbpMid, fbpLow] = this.parseCommissionValues(valueElement);
          data.fbp_commission_high = fbpHigh;
          data.fbp_commission_mid = fbpMid;
          data.fbp_commission_low = fbpLow;
          if ((window as any).EURAFLOW_DEBUG) {
            console.log('  解析结果:', { fbpHigh, fbpMid, fbpLow });
          }
        }
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
        // 【修正】区分加载中和无数据：
        // - 页面显示"-" → 保持undefined（继续轮询）
        // - 页面显示"无数据" → 设为0（后端只接受 int 或 None）
        // - 有实际值 → 解析数字
        if (value === '-') {
          // 加载中，不设置（保持undefined）
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} 包装重量: 加载中（保持undefined）`);
          }
        } else if (value === '无数据' || value.trim() === '') {
          // 已加载完成，确认无数据，设为0
          data.package_weight = 0;
          if ((window as any).EURAFLOW_DEBUG) {
            console.log(`[DEBUG] SKU=${sku || '未知'} 包装重量: 确认无数据（设为0）`);
          }
        } else {
          // 有实际值，解析数字
          data.package_weight = this.parseNumber(value);
          if ((window as any).EURAFLOW_DEBUG && data.package_weight !== undefined) {
            console.log(`[DEBUG] SKU=${sku || '未知'} 包装重量: ${data.package_weight}g`);
          }
        }
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
        // 处理"无跟卖"的情况
        if (value === '无跟卖' || value === '无') {
          data.competitor_min_price = 0;
        } else {
          data.competitor_min_price = this.parsePrice(value);
        }
        break;

      // 日期
      case '上架时间':
        if ((window as any).EURAFLOW_DEBUG) {
          console.log(`[DEBUG] SKU=${sku || '未知'} 上架时间 原始值: "${value}"`);
        }
        this.parseListingDate(value, data);
        if ((window as any).EURAFLOW_DEBUG && data.listing_date) {
          console.log(`[DEBUG] SKU=${sku || '未知'} 上架时间 解析结果: ${data.listing_date}, ${data.listing_days}天`);
        }
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
    // 处理"无跟卖"的情况
    if (value === '无跟卖' || value === '无') {
      return 0;
    }

    const match = value.match(/等(\d+)个/);
    if (!match) return undefined;
    return parseInt(match[1]);
  }

  /**
   * 解析上架时间（从"2025-05-20 (162天)"或"非热销,无数据"中提取日期和天数）
   */
  private parseListingDate(value: string, data: Partial<ProductData>): void {
    // 处理"非热销,无数据"的情况
    if (value.includes('非热销') || value.includes('无数据')) {
      // 明确标记为null，表示无上架时间数据
      data.listing_date = null as any;
      data.listing_days = null as any;
      return;
    }

    // 提取日期（格式：2025-05-20）
    const dateMatch = value.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      try {
        data.listing_date = new Date(dateMatch[1]);
      } catch {
        // 忽略解析失败
      }
    }
  }

  /**
   * 解析佣金值（从三个ant-tag标签中提取）
   * @param valueElement 包含佣金数据的 <b> 元素
   * @returns [high, mid, low] 三个佣金百分比值
   */
  private parseCommissionValues(valueElement: HTMLElement): [number | undefined, number | undefined, number | undefined] {
    // 查找所有 ant-tag 标签（支持多种选择器）
    let tags = valueElement.querySelectorAll<HTMLElement>('.ant-tag');

    // 如果没找到，尝试其他选择器
    if (tags.length === 0) {
      tags = valueElement.querySelectorAll<HTMLElement>('[class*="ant-tag"]');
    }

    // 调试日志
    if ((window as any).EURAFLOW_DEBUG) {
      console.log('[DEBUG parseCommissionValues] Found tags:', tags.length);
      tags.forEach((tag, i) => {
        console.log(`  Tag ${i}:`, tag.textContent?.trim(), tag.className);
      });
    }

    if (tags.length < 3) {
      if ((window as any).EURAFLOW_DEBUG) {
        console.log('[DEBUG parseCommissionValues] Not enough tags, expected 3, got:', tags.length);
      }
      return [undefined, undefined, undefined];
    }

    // 按顺序提取: lime(≤1500₽)=low, orange(1501~5000₽)=mid, magenta(>5000₽)=high
    const low = this.parsePercent(tags[0].textContent || '');   // lime 绿色
    const mid = this.parsePercent(tags[1].textContent || '');   // orange 橙色
    const high = this.parsePercent(tags[2].textContent || '');  // magenta 红色

    if ((window as any).EURAFLOW_DEBUG) {
      console.log('[DEBUG parseCommissionValues] Parsed values:', { high, mid, low });
    }

    return [high, mid, low];
  }
}
