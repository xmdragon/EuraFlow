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

  return {
    ozon_product_id,
    title,
    price,
    old_price: old_price && old_price > price ? old_price : undefined,
    brand,
    description,
    images,
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
