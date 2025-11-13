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

// ========== 核心采集函数 ==========

/**
 * 提取商品数据（主函数）
 * 优先级：window.__NUXT__ > window.dataLayer > DOM解析
 */
export async function extractProductData(): Promise<ProductDetailData> {
  console.log('[EuraFlow] 开始采集商品数据...');

  // 方案1: 尝试从 window.__NUXT__ 提取
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
    // - state.product (商品详情)
    // - data (服务端渲染数据)

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
      return null;
    }

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
 * 从 __NUXT__ 数据中提取变体信息
 * 参考上品帮的提取逻辑：从 widgetStates.webAspects 提取 aspects 数组
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

        console.log('[EuraFlow] 从 widgetStates.webAspects 提取到 aspects:', aspects);
      }
    }

    // 降级：尝试直接从 productData 提取
    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      aspects = productData.aspects || productData.variants || productData.skus || productData.items || productData.options;
    }

    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      console.log('[EuraFlow] 未找到变体数据');
      return { has_variants: false };
    }

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
        spec_details: undefined, // 可以后续从 aspects 的结构中提取
        image_url: imageUrl,
        link: link,
        price: price,
        old_price: undefined, // OZON 的 aspects 中可能不包含 oldPrice
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
    console.error('[EuraFlow] 提取变体数据失败:', error);
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
