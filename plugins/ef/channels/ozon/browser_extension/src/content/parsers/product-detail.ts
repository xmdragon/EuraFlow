/**
 * OZON 商品详情页数据采集器
 *
 * 用于从商品详情页提取完整的商品数据，支持"一键跟卖"功能
 */

// ========== 类型定义 ==========
export interface ProductDetailData {
  // 基础信息
  ozon_product_id?: string; // OZON商品ID
  sku?: string; // OZON SKU
  title: string; // 商品标题
  description?: string; // 商品描述
  category_id?: number; // 类目ID

  // 价格
  price: number; // 当前价格
  old_price?: number; // 原价

  // 品牌和条形码
  brand?: string; // 品牌
  barcode?: string; // 条形码

  // 图片
  images: string[]; // 图片URL列表

  // 尺寸和重量
  dimensions?: {
    weight: number; // 重量（克）
    height: number; // 高度（毫米）
    width: number; // 宽度（毫米）
    length: number; // 长度（毫米）
  };

  // 类目特征
  attributes?: Array<{
    attribute_id: number;
    value: string;
    dictionary_value_id?: number;
  }>;

  // 商品变体（用于一键跟卖）
  variants?: Array<{
    variant_id: string;           // 变体ID
    specifications: string;       // 规格描述："白色,M"
    spec_details?: Record<string, string>; // 规格详情：{ color: "白色", size: "M" }
    image_url: string;           // 变体图片
    price: number;               // 原价格（分）
    old_price?: number;          // 原划线价（分）
    available: boolean;          // 是否可用
  }>;
  has_variants: boolean;         // 是否有变体
}

// ========== OZON 原生数据结构（window对象扩展）==========
declare global {
  interface Window {
    __NUXT__?: any;
    dataLayer?: any[];
  }
}

// ========== 辅助函数 ==========

/**
 * 通过 OZON API 获取商品数据（参考上品帮方案）
 * 更可靠，不依赖页面加载时机
 */
async function fetchProductDataFromOzonAPI(productUrl: string): Promise<any | null> {
  try {
    console.log('[EuraFlow] 尝试通过 OZON API 获取商品数据...');
    const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include', // 包含 cookies
    });

    if (!response.ok) {
      console.warn(`[EuraFlow] OZON API 请求失败: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const widgetStates = data.widgetStates;

    if (!widgetStates) {
      console.warn('[EuraFlow] OZON API 返回数据中没有 widgetStates');
      return null;
    }

    console.log('[EuraFlow] 成功从 OZON API 获取 widgetStates');
    return widgetStates;
  } catch (error) {
    console.error('[EuraFlow] 调用 OZON API 失败:', error);
    return null;
  }
}

/**
 * 从 widgetStates 解析完整商品数据（参考上品帮逻辑）
 */
function parseFromWidgetStates(widgetStates: any): ProductDetailData | null {
  try {
    const keys = Object.keys(widgetStates);

    // 1. 提取标题（从 webProductHeading）
    const headingKey = keys.find(k => k.includes('webProductHeading'));
    const headingData = headingKey ? JSON.parse(widgetStates[headingKey]) : null;
    const title = headingData?.title || '';

    // 2. 提取价格（从 webPrice）
    const priceKey = keys.find(k => k.includes('webPrice'));
    const priceData = priceKey ? JSON.parse(widgetStates[priceKey]) : null;
    const price = parseFloat(priceData?.price?.replace(/\s/g, '') || priceData?.cardPrice?.replace(/\s/g, '') || '0');
    const old_price = parseFloat(priceData?.cardPrice?.replace(/\s/g, '') || '0');

    // 3. 提取图片（从 webGallery）
    const galleryKey = keys.find(k => k.includes('webGallery'));
    const galleryData = galleryKey ? JSON.parse(widgetStates[galleryKey]) : null;
    const images: string[] = [];
    if (galleryData?.images && Array.isArray(galleryData.images)) {
      galleryData.images.forEach((img: any) => {
        if (img.src) images.push(img.src);
      });
    }

    // 4. 提取商品ID（从URL）
    const urlMatch = window.location.pathname.match(/product\/.*-(\d+)/);
    const ozon_product_id = urlMatch ? urlMatch[1] : undefined;

    // 5. 提取变体数据（从 webAspects）
    const aspectsKey = keys.find(k => k.includes('webAspects'));
    let variants: any[] | undefined = undefined;
    if (aspectsKey) {
      const aspectsData = JSON.parse(widgetStates[aspectsKey]);
      const aspects = aspectsData?.aspects;
      if (aspects && Array.isArray(aspects)) {
        const variantInfo = extractVariantsFromAspects(aspects);
        variants = variantInfo.variants;
      }
    }

    console.log('[EuraFlow] 从 widgetStates 提取数据成功:', {
      title,
      price,
      images: images.length,
      variants_count: variants?.length || 0
    });

    return {
      ozon_product_id,
      title,
      price,
      old_price: old_price > price ? old_price : undefined,
      images,
      has_variants: !!variants && variants.length > 0,
      variants,
    };
  } catch (error) {
    console.error('[EuraFlow] 从 widgetStates 解析失败:', error);
    return null;
  }
}

/**
 * 从 aspects 数组提取变体信息（独立函数，专门处理aspects）
 */
function extractVariantsFromAspects(aspects: any[]): { has_variants: boolean; variants?: any[] } {
  try {
    console.log('[EuraFlow] aspects 数组长度:', aspects.length);

    // 扁平化提取所有维度的变体（参考上品帮：flat(3)）
    const allVariants = aspects
      .map(aspect => aspect.variants || [])
      .flat(3);

    console.log('[EuraFlow] 扁平化后变体总数:', allVariants.length);

    // 过滤掉"Уцененные"（打折商品）
    const filteredVariants = allVariants.filter((variant: any) => {
      const searchableText = variant.data?.searchableText || '';
      return searchableText !== 'Уцененные';
    });

    console.log('[EuraFlow] 过滤后变体总数:', filteredVariants.length);

    if (filteredVariants.length === 0) {
      return { has_variants: false };
    }

    // 提取变体数据并去重
    const variantMap = new Map();

    filteredVariants.forEach((variant: any, index: number) => {
      const sku = variant.sku?.toString() || `variant_${index}`;

      // 跳过已存在的 SKU
      if (variantMap.has(sku)) {
        return;
      }

      // 提取规格信息（从 data.searchableText）
      const specifications = variant.data?.searchableText || variant.data?.title || '';

      // 清理链接（去掉查询参数）
      let link = variant.link || '';
      if (link) {
        link = link.split('?')[0];
      }

      // 提取价格（从 data.price 或 data 对象）
      let priceStr = variant.data?.price || '';
      let price = 0;
      if (typeof priceStr === 'string') {
        price = parseFloat(priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
      } else {
        price = parseFloat(priceStr) || 0;
      }

      // 提取图片
      let imageUrl = variant.image || variant.imageUrl || variant.data?.image || '';

      variantMap.set(sku, {
        variant_id: sku,
        specifications: specifications,
        spec_details: undefined,
        image_url: imageUrl,
        link: link,
        price: price,
        old_price: undefined,
        available: variant.active !== false,
      });
    });

    const variants = Array.from(variantMap.values());
    console.log('[EuraFlow] 最终去重后变体数:', variants.length);

    return {
      has_variants: variants.length > 0,
      variants: variants,
    };
  } catch (error) {
    console.error('[EuraFlow] 提取 aspects 变体数据失败:', error);
    return { has_variants: false };
  }
}

// ========== 核心采集函数 ==========

/**
 * 等待 window.__NUXT__.widgetStates 加载
 * @param maxWaitMs 最大等待时间（毫秒）
 * @param intervalMs 检查间隔（毫秒）
 */
async function waitForWidgetStates(maxWaitMs: number = 5000, intervalMs: number = 50): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (window.__NUXT__?.widgetStates) {
      console.log(`[EuraFlow] widgetStates 已加载（耗时 ${Date.now() - startTime}ms）`);
      return true;
    }
    // 等待一段时间后重试
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.log('[EuraFlow] widgetStates 等待超时（5秒）');
  return false;
}

/**
 * 提取商品数据（主函数）
 * 优先级：window.__NUXT__.widgetStates > window.__NUXT__ > window.dataLayer > DOM解析
 */
export async function extractProductData(): Promise<ProductDetailData> {
  console.log('[EuraFlow] 开始采集商品数据...');

  // 方案1（首选）：通过 OZON API 获取数据
  const productUrl = window.location.href;
  const apiWidgetStates = await fetchProductDataFromOzonAPI(productUrl);
  if (apiWidgetStates) {
    console.log('[EuraFlow] 尝试从 OZON API 返回的 widgetStates 解析...');
    const apiResult = parseFromWidgetStates(apiWidgetStates);
    if (apiResult) {
      console.log('[EuraFlow] ✅ 从 OZON API 成功提取数据');
      return apiResult;
    }
  }

  console.log('[EuraFlow] OZON API 方案失败，降级到页面解析...');

  // 方案2（降级）：等待并从 window.__NUXT__ 提取
  await waitForWidgetStates();

  // 调试：输出 window.__NUXT__ 的keys
  console.log('[EuraFlow] window.__NUXT__ 存在:', !!window.__NUXT__);
  if (window.__NUXT__) {
    console.log('[EuraFlow] window.__NUXT__ 的keys:', Object.keys(window.__NUXT__));
    // 检查是否有 widgetStates
    if ((window.__NUXT__ as any).widgetStates) {
      const widgetStates = (window.__NUXT__ as any).widgetStates;
      console.log('[EuraFlow] widgetStates 的keys (前10个):', Object.keys(widgetStates).slice(0, 10));
      // 查找包含 webAspects 的key
      const aspectsKey = Object.keys(widgetStates).find(key => key.includes('webAspects'));
      console.log('[EuraFlow] webAspects key:', aspectsKey);

      // 查找包含 webProductHeading 的key
      const headingKey = Object.keys(widgetStates).find(key => key.includes('webProductHeading'));
      console.log('[EuraFlow] webProductHeading key:', headingKey);

      // 查找包含 webPrice 的key
      const priceKey = Object.keys(widgetStates).find(key => key.includes('webPrice'));
      console.log('[EuraFlow] webPrice key:', priceKey);
    }
  }

  const nuxtData = window.__NUXT__;
  if (nuxtData) {
    console.log('[EuraFlow] 检测到 window.__NUXT__，尝试解析...');
    const result = parseNuxtData(nuxtData);
    if (result) {
      console.log('[EuraFlow] 从 __NUXT__ 成功提取数据');
      return result;
    }
  }

  // 方案2: 尝试从 window.dataLayer 提取
  const dataLayer = window.dataLayer;
  if (dataLayer && Array.isArray(dataLayer)) {
    console.log('[EuraFlow] 检测到 window.dataLayer，尝试解析...');
    const result = parseDataLayer(dataLayer);
    if (result) {
      console.log('[EuraFlow] 从 dataLayer 成功提取数据');
      return result;
    }
  }

  // 方案3: 降级到 DOM 解析
  console.log('[EuraFlow] 降级到 DOM 解析模式...');
  return parseDom();
}

/**
 * 从 window.__NUXT__ 解析数据
 */
function parseNuxtData(nuxtData: any): ProductDetailData | null {
  try {
    // OZON 的 __NUXT__ 结构可能包含：
    // - widgetStates (最重要，包含商品详情和变体)
    // - state.product (商品详情)
    // - data (服务端渲染数据)

    // 优先从 widgetStates 提取
    if (nuxtData.widgetStates) {
      console.log('[EuraFlow] 尝试从 widgetStates 提取商品数据...');
      const widgetResult = parseFromWidgetStates(nuxtData.widgetStates);
      if (widgetResult) {
        return widgetResult;
      }
    }

    // 降级：从 productData 提取
    let productData = nuxtData?.state?.product || nuxtData?.data?.[0]?.product;

    if (!productData) {
      // 尝试在深层结构中查找
      for (const key in nuxtData) {
        if (nuxtData[key]?.product) {
          productData = nuxtData[key].product;
          break;
        }
      }
    }

    if (!productData) {
      console.log('[EuraFlow] 未找到 productData');
      return null;
    }

    console.log('[EuraFlow] 从 productData 提取数据...');

    // 提取字段
    const title = productData.name || productData.title || '';
    const price = parseFloat(productData.price?.price || productData.price || 0);
    const old_price = parseFloat(productData.price?.oldPrice || productData.oldPrice || 0);

    const images: string[] = [];
    if (productData.images && Array.isArray(productData.images)) {
      productData.images.forEach((img: any) => {
        const url = typeof img === 'string' ? img : img.url || img.src;
        if (url) images.push(url);
      });
    }

    // 尝试提取变体信息
    const variantInfo = extractVariantsFromNuxt(productData);

    return {
      ozon_product_id: productData.id?.toString() || productData.productId?.toString(),
      sku: productData.sku?.toString() || productData.offerId?.toString(),
      title,
      description: productData.description || productData.richDescription,
      category_id: parseInt(productData.categoryId || productData.category?.id || '0'),
      price: price || 0,
      old_price: old_price > price ? old_price : undefined,
      brand: productData.brand?.name || productData.brand,
      barcode: productData.barcode,
      images,
      dimensions: productData.dimensions ? {
        weight: parseInt(productData.dimensions.weight || '0'),
        height: parseInt(productData.dimensions.height || '0'),
        width: parseInt(productData.dimensions.width || '0'),
        length: parseInt(productData.dimensions.length || productData.dimensions.depth || '0'),
      } : undefined,
      attributes: productData.attributes || productData.specs,
      has_variants: variantInfo.has_variants,
      variants: variantInfo.variants,
    };
  } catch (error) {
    console.error('[EuraFlow] 解析 __NUXT__ 数据失败:', error);
    return null;
  }
}

/**
 * 从 window.dataLayer 解析数据（Google Analytics 数据层）
 */
function parseDataLayer(dataLayer: any[]): ProductDetailData | null {
  try {
    // 查找包含 ecommerce.detail 的对象
    const productEvent = dataLayer.find((item: any) =>
      item.ecommerce?.detail || item.ecommerce?.impressions
    );

    if (!productEvent?.ecommerce?.detail) {
      return null;
    }

    const productData = productEvent.ecommerce.detail.products?.[0];
    if (!productData) {
      return null;
    }

    return {
      ozon_product_id: productData.id?.toString(),
      sku: productData.sku?.toString(),
      title: productData.name || '',
      price: parseFloat(productData.price || '0'),
      brand: productData.brand,
      category_id: parseInt(productData.category || '0'),
      images: [], // dataLayer 通常不包含图片
      has_variants: false, // dataLayer 不包含变体信息
    };
  } catch (error) {
    console.error('[EuraFlow] 解析 dataLayer 数据失败:', error);
    return null;
  }
}

/**
 * 从 DOM 解析数据（降级方案）
 */
function parseDom(): ProductDetailData {
  console.log('[EuraFlow] 使用 DOM 解析提取基础数据...');

  // 提取标题
  const titleElement =
    document.querySelector('h1[data-widget="webProductHeading"]') ||
    document.querySelector('h1');
  const title = titleElement?.textContent?.trim() || '';

  // 提取价格（从真实售价计算器的价格区域）
  const greenPriceElement = document.querySelector('[data-widget="webPrice"] .tsHeadline600Large');
  const blackPriceElement = document.querySelector('[data-widget="webPrice"] .tsHeadline500Medium') ||
                           document.querySelector('[data-widget="webPrice"] .tsHeadline600Large');

  let price = 0;
  let old_price: number | undefined;

  if (greenPriceElement && blackPriceElement) {
    // 有绿标价（折扣价）
    const greenText = greenPriceElement.textContent || '';
    const blackText = blackPriceElement.textContent || '';
    price = parseFloat(greenText.replace(/[^\d.]/g, '')) || 0;
    old_price = parseFloat(blackText.replace(/[^\d.]/g, '')) || 0;
  } else if (blackPriceElement) {
    // 只有黑标价（常规价格）
    const blackText = blackPriceElement.textContent || '';
    price = parseFloat(blackText.replace(/[^\d.]/g, '')) || 0;
  }

  // 提取图片（从图片画廊）
  const images: string[] = [];
  const galleryImages = document.querySelectorAll('[data-widget="webGallery"] img');
  galleryImages.forEach((img) => {
    let src = img.getAttribute('src');
    // 如果是缩略图，尝试获取高清版本
    if (src) {
      // OZON 图片URL通常包含 wc250, wc500 等尺寸参数，替换为原图
      src = src.replace(/\/wc\d+\//, '/');
      if (!images.includes(src)) {
        images.push(src);
      }
    }
  });

  // 提取商品ID（从URL）
  const urlMatch = window.location.pathname.match(/product\/.*-(\d+)/);
  const ozon_product_id = urlMatch ? urlMatch[1] : undefined;

  // 提取品牌（从特征表格）
  let brand: string | undefined;
  const brandRow = Array.from(document.querySelectorAll('[data-widget="webCharacteristics"] dt'))
    .find(dt => dt.textContent?.includes('Бренд') || dt.textContent?.includes('品牌'));
  if (brandRow) {
    const brandValue = brandRow.nextElementSibling;
    brand = brandValue?.textContent?.trim();
  }

  // 提取描述（从描述区域）
  const descriptionElement = document.querySelector('[data-widget="webDescription"]');
  const description = descriptionElement?.textContent?.trim();

  // 尝试从 DOM 提取变体信息（降级方案）
  const variantInfo = extractVariantsFromDOM();

  return {
    ozon_product_id,
    title,
    price,
    old_price: old_price && old_price > price ? old_price : undefined,
    brand,
    description,
    images,
    has_variants: variantInfo.has_variants,
    variants: variantInfo.variants,
  };
}

/**
 * 获取商品URL（用于后端爬虫备用）
 */
export function getCurrentProductUrl(): string {
  return window.location.href;
}

/**
 * 检查是否在商品详情页
 */
export function isProductDetailPage(): boolean {
  return window.location.pathname.includes('/product/');
}

// ========== 变体数据提取辅助函数 ==========

/**
 * 从 __NUXT__ 数据中提取变体信息（降级方案）
 * 优先从 widgetStates 提取，否则从 productData 提取
 */
function extractVariantsFromNuxt(productData: any): { has_variants: boolean; variants?: any[] } {
  try {
    // 尝试从 widgetStates 提取（优先）
    const widgetStates = productData.widgetStates || window.__NUXT__?.widgetStates;
    let aspects: any[] | null = null;

    if (widgetStates) {
      // 查找包含 "webAspects" 的键
      const aspectsKey = Object.keys(widgetStates).find(key => key.includes('webAspects'));
      if (aspectsKey) {
        const aspectsData = widgetStates[aspectsKey];
        // aspectsData 可能是字符串（需要 JSON.parse）或对象
        aspects = typeof aspectsData === 'string'
          ? JSON.parse(aspectsData).aspects
          : aspectsData?.aspects;

        console.log('[EuraFlow] extractVariantsFromNuxt: 从 widgetStates.webAspects 提取到 aspects');
      }
    }

    // 降级：尝试直接从 productData 提取
    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      aspects = productData.aspects || productData.variants || productData.skus || productData.items || productData.options;
    }

    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      console.log('[EuraFlow] extractVariantsFromNuxt: 未找到变体数据');
      return { has_variants: false };
    }

    // 使用统一的 aspects 提取函数
    return extractVariantsFromAspects(aspects);
  } catch (error) {
    console.error('[EuraFlow] extractVariantsFromNuxt 失败:', error);
    return { has_variants: false };
  }
}

/**
 * 从 DOM 解析变体选择器（降级方案）
 */
function extractVariantsFromDOM(): { has_variants: boolean; variants?: any[] } {
  try {
    // 查找 OZON 的变体选择器容器
    const variantSelectors = [
      '[data-widget="webProductVariants"]',
      '[data-widget="webColor"]',
      '[data-widget="webSize"]',
      '.widget-variants',
      '.product-options',
    ];

    let variantContainer: Element | null = null;
    for (const selector of variantSelectors) {
      variantContainer = document.querySelector(selector);
      if (variantContainer) break;
    }

    if (!variantContainer) {
      return { has_variants: false };
    }

    // 提取选项组（颜色、尺码等）
    const optionGroups = variantContainer.querySelectorAll('[data-option], .option-group');
    if (optionGroups.length === 0) {
      return { has_variants: false };
    }

    // 简化处理：将所有选项组合为变体列表
    const variants: any[] = [];
    optionGroups.forEach((group, groupIndex) => {
      const options = group.querySelectorAll('button, [data-value]');
      options.forEach((option, optionIndex) => {
        const button = option as HTMLElement;
        const value = button.getAttribute('data-value') || button.textContent?.trim() || '';
        const imageUrl = button.getAttribute('data-image') || '';
        const isAvailable = !button.classList.contains('disabled') && !button.hasAttribute('disabled');

        variants.push({
          variant_id: `dom_${groupIndex}_${optionIndex}`,
          specifications: value,
          spec_details: undefined,
          image_url: imageUrl,
          price: 0, // DOM 无法获取价格，需要用户手动输入
          old_price: undefined,
          available: isAvailable,
        });
      });
    });

    return {
      has_variants: variants.length > 0,
      variants: variants,
    };
  } catch (error) {
    console.error('[EuraFlow] DOM 变体解析失败:', error);
    return { has_variants: false };
  }
}
