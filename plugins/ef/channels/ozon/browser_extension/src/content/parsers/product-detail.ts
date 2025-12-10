/**
 * OZON 商品详情页数据采集器
 *
 * 数据源：
 * 1. widgetStates API - title/price/images/category_id/brand
 * 2. Page2 API - description/attributes
 * 3. 上品帮注入DOM - dimensions/brand
 * 4. Modal API - variants（完整变体数据）
 */

import { getOzonStandardHeaders, generateShortHash } from '../../shared/ozon-headers';
import { calculateRealPriceCore } from '../price-calculator/calculator';

// 移除 wc 缩略图参数，获取高清图
const toHdImageUrl = (url: string): string => url ? url.replace(/\/wc\d+\//, '/') : '';

// 标记页面注入脚本是否已加载
let pageScriptInjected = false;

/**
 * 确保页面注入脚本已加载
 */
function ensurePageScriptLoaded(): Promise<void> {
  return new Promise((resolve) => {
    if (pageScriptInjected || (window as any).__EURAFLOW_PAGE_SCRIPT_LOADED__) {
      pageScriptInjected = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('assets/page-injected.js');
    script.onload = () => {
      pageScriptInjected = true;
      resolve();
    };
    script.onerror = () => {
      console.error('[EuraFlow] 页面注入脚本加载失败');
      resolve();  // 即使失败也继续
    };
    document.head.appendChild(script);
  });
}

/**
 * 通过页面上下文执行 fetch 请求（避免 Content Script 的 403 反爬虫检测）
 */
async function fetchViaPageContext(url: string, timeout = 10000): Promise<any | null> {
  // 确保页面脚本已加载
  await ensurePageScriptLoaded();

  return new Promise((resolve) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timeoutId = setTimeout(() => {
      window.removeEventListener('euraflow_page_response', responseHandler);
      console.warn('[EuraFlow] 页面上下文请求超时');
      resolve(null);
    }, timeout);

    const responseHandler = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.requestId !== requestId) return;

      clearTimeout(timeoutId);
      window.removeEventListener('euraflow_page_response', responseHandler);

      if (customEvent.detail.success) {
        resolve(customEvent.detail.data);
      } else {
        // 静默处理：商品不存在或已下架是正常情况
        resolve(null);
      }
    };

    window.addEventListener('euraflow_page_response', responseHandler);

    // 发送请求到页面上下文
    window.dispatchEvent(new CustomEvent('euraflow_page_request', {
      detail: { requestId, type: 'fetch', url }
    }));
  });
}

export interface ProductDetailData {
  ozon_product_id?: string;
  sku?: string;
  title: string;
  description?: string;
  category_id?: number;
  cardPrice: number;    // 绿色价格（Ozon卡价格）
  price: number;        // 黑色价格（普通价格）
  original_price?: number;  // 划线价
  realPrice?: number;   // 真实售价（由 display.ts 计算后传入）
  images: { url: string; is_primary?: boolean }[];
  videos?: string[];
  dimensions?: {
    weight: number;
    height: number;
    width: number;
    length: number;
  };
  attributes?: Array<{
    attribute_id: number;
    value: string;
    dictionary_value_id?: number;
  }>;
  typeNameRu?: string;  // 商品类型俄文名称（Тип 属性值）
  variants?: Array<{
    variant_id: string;
    specifications: string;
    spec_details?: Record<string, string>;
    image_url: string;
    images?: { url: string; is_primary?: boolean }[];  // 变体的附加图片
    price: number;
    original_price?: number;
    available: boolean;
    link?: string;
  }>;
  has_variants: boolean;
}

async function fetchProductDataFromOzonAPI(productUrl: string): Promise<any | null> {
  try {
    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

    if (__DEBUG__) {
      console.log('[API] fetchProductDataFromOzonAPI 请求:', { url: apiUrl, productUrl });
    }

    // ✅ 通过页面上下文执行请求（避免 403 反爬虫检测）
    const data = await fetchViaPageContext(apiUrl);
    if (!data) {
      console.error(`[EuraFlow] OZON API 请求失败（页面上下文）`);
      throw new Error(`API请求失败（页面上下文）`);
    }

    if (!data.widgetStates) {
      console.error('[EuraFlow] OZON API 返回数据中没有 widgetStates');
      throw new Error('widgetStates 不存在');
    }

    if (__DEBUG__) {
      console.log('[API] fetchProductDataFromOzonAPI 返回:', data);
    }

    // 返回完整的 API 响应（包含 layoutTrackingInfo 等字段）
    return data;
  } catch (error: any) {
    // CAPTCHA_PENDING 错误直接抛出，让上层处理
    if (error.message?.startsWith('CAPTCHA_PENDING')) {
      console.error('[EuraFlow] 🚫 触发反爬虫拦截');
      throw error;
    }
    console.error('[EuraFlow] 调用 OZON API 失败:', error);
    throw error;
  }
}

/**
 * 通过 OZON Modal API 获取完整变体数据（上品帮方案）
 * 调用 /modal/aspectsNew?product_id={id} 获取 webAspectsModal（包含所有颜色×尺码组合）
 *
 * ✅ 通过页面上下文执行请求（避免 403 反爬虫检测）
 */
async function fetchFullVariantsFromModal(productId: string): Promise<any[] | null> {
  try {
    const modalUrl = `/modal/aspectsNew?product_id=${productId}`;
    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(modalUrl)}`;

    if (__DEBUG__) {
      console.log('[API] fetchFullVariantsFromModal 请求:', { url: apiUrl, productId });
    }

    // ✅ 通过页面上下文执行请求（避免 403 反爬虫检测）
    const data = await fetchViaPageContext(apiUrl);
    if (!data) {
      console.warn(`[EuraFlow] Modal API 请求失败（页面上下文）`);
      return null;
    }

    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);

    // 查找 webAspectsModal widget
    const modalKey = keys.find(k => k.includes('webAspectsModal'));
    if (!modalKey) {
      if (__DEBUG__) {
        console.log('[API] fetchFullVariantsFromModal 返回: 无 webAspectsModal');
      }
      return null;
    }

    const modalData = JSON.parse(widgetStates[modalKey]);
    const aspects = modalData?.aspects;

    if (__DEBUG__) {
      console.log('[API] fetchFullVariantsFromModal 返回:', { aspects });
    }

    return aspects && Array.isArray(aspects) ? aspects : null;
  } catch (error: any) {
    if (error.message?.startsWith('CAPTCHA_PENDING')) {
      console.error('[EuraFlow] 🚫 触发反爬虫拦截');
      throw error;
    }
    console.error('[EuraFlow] 调用 Modal API 失败:', error);
    return null;
  }
}

/**
 * 通过 OZON Seller API 获取商品详情（包含尺寸和重量）
 */
async function fetchDimensionsFromOzonAPI(productSku: string): Promise<{
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
} | null> {
  try {
    if (__DEBUG__) {
      console.log('[API] fetchDimensionsFromOzonAPI 请求:', {
        api: 'search-variant-model',
        productSku
      });
    }

    // 在 content script 中直接读取 document.cookie（可访问页面 Cookie）
    const cookieString = document.cookie;

    const response = await chrome.runtime.sendMessage({
      type: 'GET_OZON_PRODUCT_DETAIL',
      data: {
        productSku: productSku,
        cookieString: cookieString  // 传递 Cookie 字符串给 service worker
      }
    });

    if (!response.success) {
      console.warn('[EuraFlow] [尺寸 API] Seller API 无法获取尺寸（非自有商品正常）:', response.error);
      return null;
    }

    const dimensions = response.data?.dimensions;
    if (!dimensions) {
      return null;
    }

    // 转换数据格式（从字符串转为数字）
    const result = {
      weight: dimensions.weight ? parseFloat(dimensions.weight) : undefined,
      height: dimensions.height ? parseFloat(dimensions.height) : undefined,
      width: dimensions.width ? parseFloat(dimensions.width) : undefined,
      length: dimensions.length ? parseFloat(dimensions.length) : undefined,
    };

    if (__DEBUG__) {
      console.log('[API] fetchDimensionsFromOzonAPI 返回:', result);
    }

    return result;
  } catch (error) {
    console.error('[EuraFlow] 调用 OZON API 获取尺寸失败:', error);
    return null;
  }
}

/**
 * 从上品帮注入的 DOM 中提取数据（作为降级方案）
 * 上品帮会在页面上注入包含这些信息的元素
 */
function extractDataFromInjectedDOM(): {
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
  brand?: string;
  description?: string;
} | null {
  try {
    const result: {
      weight?: number;
      height?: number;
      width?: number;
      length?: number;
      brand?: string;
      description?: string;
    } = {};

    // 查找所有包含 "text-class" 的 div（上品帮的数据容器）
    const textElements = document.querySelectorAll('div.text-class');

    for (const element of textElements) {
      const span = element.querySelector('span');
      const b = element.querySelector('b');

      if (!span || !b) continue;

      const label = span.textContent?.trim() || '';
      const value = b.textContent?.trim() || '';

      // 提取包装重量（格式：130 g）
      if (label.includes('包装重量')) {
        const weightMatch = value.match(/(\d+(?:\.\d+)?)\s*g/i);
        if (weightMatch) {
          result.weight = parseFloat(weightMatch[1]);
        }
      }

      // 提取长宽高（格式：250* 130 * 30 或 250*130*30）
      if (label.includes('长宽高')) {
        // 真正没数据的情况
        if (value === '非热销,无数据') {
          result.length = undefined;
          result.width = undefined;
          result.height = undefined;
        }
        // 数据还在加载中（需要二次轮询）
        else if (value === '-' || value === '') {
          // 返回特殊值 -1 表示需要等待
          result.length = -1;
          result.width = -1;
          result.height = -1;
        }
        // 有实际数据
        else {
          // 匹配格式：数字 * 数字 * 数字（允许空格）
          const dimensionsMatch = value.match(/(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
          if (dimensionsMatch) {
            result.length = parseFloat(dimensionsMatch[1]);
            result.width = parseFloat(dimensionsMatch[2]);
            result.height = parseFloat(dimensionsMatch[3]);
          }
        }
      }

      // 提取品牌（格式：без бренда 或其他品牌名）
      if (label.includes('品牌')) {
        if (value) {
          // 标准化品牌：将 "без бренда"、空字符串、"非热销,无数据" 转换为 "NO_BRAND"
          if (value === 'без бренда' || value === '' || value === '非热销,无数据') {
            result.brand = 'NO_BRAND';
          } else {
            result.brand = value;
          }
        }
      }
    }

    // 如果提取到了数据，返回结果
    if (Object.keys(result).length > 0) {
      return result;
    }

    return null;
  } catch (error) {
    console.error('[EuraFlow] 从 DOM 提取数据失败:', error);
    return null;
  }
}

/**
 * 等待上品帮注入 DOM 数据
 * 使用 50ms 间隔检测，最多等待 5 秒
 */
async function waitForInjectedDOM(): Promise<boolean> {
  const maxAttempts = 100; // 5000ms / 50ms = 100次
  let attempts = 0;

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      attempts++;

      // 检查是否存在上品帮注入的 DOM 元素
      const textElements = document.querySelectorAll('div.text-class');
      const hasInjectedData = textElements.length > 0;

      if (hasInjectedData) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 50);
  });
}

/**
 * 等待上品帮二次注入尺寸数据（从"-"变为实际值）
 * 使用 100ms 间隔检测，最多等待 10 秒（100次）
 * 对于多变体商品（如80个变体），上品帮需要更长时间加载数据
 */
async function waitForDimensionsData(): Promise<boolean> {
  const maxAttempts = 100; // 10000ms / 100ms = 100次（从有上品帮DOM开始最多等待10秒）
  let attempts = 0;

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      attempts++;

      // 重新提取数据
      const data = extractDataFromInjectedDOM();

      // 检查尺寸数据是否已更新（不再是 -1）
      if (data && data.length !== undefined && data.length !== -1) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * 通过 OZON Page2 API 获取完整特征和描述
 * 调用 /product/{slug}/?layout_container=pdpPage2column&layout_page_index=2
 */
async function fetchCharacteristicsAndDescription(productSlug: string): Promise<{
  description?: string;
  attributes?: Array<{ attribute_id: number; value: string; dictionary_value_id?: number }>;
  typeNameRu?: string;
} | null> {
  try {
    // 获取 requestId 用于构建 URL 参数
    const { requestId } = await getOzonStandardHeaders({
      referer: window.location.href
    });

    // 从当前 URL 提取 at 参数（如果有）
    const urlParams = new URLSearchParams(window.location.search);
    const atParam = urlParams.get('at') || '';

    // 生成 sh 参数（随机短字符串）
    const sh = generateShortHash(10);

    // 构造 Page2 API URL（添加 sh 和 start_page_id 参数）
    let page2Url = `/product/${productSlug}/?layout_container=pdpPage2column&layout_page_index=2`;
    page2Url += `&sh=${sh}&start_page_id=${requestId}`;
    if (atParam) {
      page2Url = `/product/${productSlug}/?at=${atParam}&layout_container=pdpPage2column&layout_page_index=2&sh=${sh}&start_page_id=${requestId}`;
    }

    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(page2Url)}`;

    if (__DEBUG__) {
      console.log('[API] fetchCharacteristicsAndDescription 请求:', { productSlug, apiUrl });
    }

    // ✅ 通过页面上下文执行请求（避免 403 反爬虫检测）
    const data = await fetchViaPageContext(apiUrl);
    if (!data) {
      console.warn(`[EuraFlow] Page2 API 请求失败（页面上下文）`);
      return null;
    }
    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);

    const extracted: {
      description?: string;
      attributes?: Array<{ attribute_id: number; value: string; dictionary_value_id?: number }>;
      typeNameRu?: string;
    } = {};

    // 1. 提取 webDescription（可能有多个 key，需要尝试所有匹配的 key）
    const descriptionKeys = keys.filter(k => k.includes('webDescription') && k.includes('pdpPage2column'));
    for (const descriptionKey of descriptionKeys) {
      const descriptionData = JSON.parse(widgetStates[descriptionKey]);
      // 尝试多个可能的描述字段（OZON 不同版本 API 字段名可能不同）
      const desc = descriptionData?.richAnnotation
        || descriptionData?.annotation
        || descriptionData?.annotationShort
        || descriptionData?.content
        || descriptionData?.description
        || descriptionData?.text;
      if (desc) {
        extracted.description = desc;
        break;  // 找到后停止
      }
    }

    // 2. 提取 webCharacteristics
    const characteristicsKey = keys.find(k => k.includes('webCharacteristics') && k.includes('pdpPage2column'));
    if (characteristicsKey) {
      const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
      if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
        const attributes: Array<{ attribute_id: number; value: string; dictionary_value_id?: number; key?: string; name?: string }> = [];

        // 遍历所有特征组
        for (const group of characteristicsData.characteristics) {
          if (group.short && Array.isArray(group.short)) {
            for (const attr of group.short) {
              // 提取特征值
              if (attr.values && Array.isArray(attr.values) && attr.values.length > 0) {
                const value = attr.values.map((v: any) => v.text).join(', ');

                // 保存原始 key 和 name，后端将根据 name 查找真实的 attribute_id
                // attribute_id 设为 0，表示需要后端解析
                attributes.push({
                  attribute_id: 0,  // 占位，后端根据 name 查找真实 ID
                  key: attr.key,    // 如 "Type", "Color", "Length"
                  name: attr.name,  // 如 "类型", "颜色", "长度，厘米"
                  value: value,
                });

                // 提取 Type（类型）属性值用于类目查询
                if (attr.key === 'Type') {
                  extracted.typeNameRu = value;
                }
              }
            }
          }
        }

        extracted.attributes = attributes;
      }
    }

    const result = Object.keys(extracted).length > 0 ? extracted : null;
    if (__DEBUG__) {
      console.log('[API] fetchCharacteristicsAndDescription 返回:', {
        hasDescription: !!result?.description,
        descriptionLength: result?.description?.length || 0,
        attributesCount: result?.attributes?.length || 0,
        attributes: result?.attributes,  // 输出完整的属性数组
        typeNameRu: result?.typeNameRu
      });
    }
    return result;
  } catch (error: any) {
    // CAPTCHA_PENDING 错误直接抛出，让上层处理
    if (error.message?.startsWith('CAPTCHA_PENDING')) {
      console.error('[EuraFlow] 🚫 触发反爬虫拦截');
      throw error;
    }
    // Page2 API 失败不影响主流程，静默处理
    console.warn('[EuraFlow] [Page2 API] 获取特征失败（可忽略）:', error.message);
    return null;
  }
}

/**
 * 从 OZON API 响应解析基础商品数据
 * @param apiResponse - 完整的 API 响应对象（包含 widgetStates 和 layoutTrackingInfo）
 */
function parseFromWidgetStates(apiResponse: any): Omit<ProductDetailData, 'variants' | 'has_variants'> | null {
  try {
    const widgetStates = apiResponse.widgetStates;
    const keys = Object.keys(widgetStates);

    // 1. 提取标题
    const headingKey = keys.find(k => k.includes('webProductHeading'));
    const headingData = headingKey ? JSON.parse(widgetStates[headingKey]) : null;
    const title = headingData?.title || '';

    // 2. 提取价格（webPrice 中的价格已经是人民币元，不需要转换）
    // priceData.cardPrice = 绿色价格（Ozon卡价格）
    // priceData.price = 黑色价格（普通价格）
    // priceData.originalPrice = 划线价（原价）
    // 注意：必须精确匹配 webPrice-，排除 webPriceDecreasedCompact 等其他 widget
    const priceKey = keys.find(k => /^webPrice-\d+-/.test(k));
    const priceData = priceKey ? JSON.parse(widgetStates[priceKey]) : null;
    // 移除空格、逗号（欧洲格式），替换为点
    const cleanPrice = (str: string) => str.replace(/\s/g, '').replace(/,/g, '.');
    // 绿色价格 = cardPrice
    const cardPrice = priceData?.cardPrice ? parseFloat(cleanPrice(priceData.cardPrice)) : 0;
    // 黑色价格 = price
    const price = priceData?.price ? parseFloat(cleanPrice(priceData.price)) : 0;
    // 划线价 = originalPrice
    const original_price = priceData?.originalPrice ? parseFloat(cleanPrice(priceData.originalPrice)) : 0;


    // 3. 提取图片和视频
    const galleryKey = keys.find(k => k.includes('webGallery'));
    const galleryData = galleryKey ? JSON.parse(widgetStates[galleryKey]) : null;
    const images: { url: string; is_primary?: boolean }[] = [];
    const videos: string[] = [];
    if (galleryData?.images && Array.isArray(galleryData.images)) {
      galleryData.images.forEach((img: any, index: number) => {
        if (img.src) {
          images.push({
            url: img.src,
            is_primary: index === 0  // 第一张图片标记为主图
          });
        }
      });
    }
    // 提取视频（webGallery 中的 videos 或 videoItems 字段）
    if (galleryData?.videos && Array.isArray(galleryData.videos)) {
      galleryData.videos.forEach((video: any) => {
        if (video.src || video.url) videos.push(video.src || video.url);
      });
    } else if (galleryData?.videoItems && Array.isArray(galleryData.videoItems)) {
      galleryData.videoItems.forEach((video: any) => {
        if (video.src || video.url) videos.push(video.src || video.url);
      });
    }

    // 4. 提取商品ID（同时作为 sku）
    const urlMatch = window.location.pathname.match(/product\/.*-(\d+)/);
    const ozon_product_id = urlMatch ? urlMatch[1] : undefined;
    const sku = ozon_product_id;  // OZON 商品的 sku 就是 ozon_product_id

    // 5. 提取类目ID（从 layoutTrackingInfo）
    let category_id: number | undefined = undefined;
    if (apiResponse.layoutTrackingInfo) {
      try {
        // layoutTrackingInfo 是一个 JSON 字符串，需要解析
        const layoutTracking = typeof apiResponse.layoutTrackingInfo === 'string'
          ? JSON.parse(apiResponse.layoutTrackingInfo)
          : apiResponse.layoutTrackingInfo;

        if (layoutTracking.categoryId) {
          category_id = parseInt(layoutTracking.categoryId);
        }
      } catch (error) {
        console.error('[EuraFlow] 解析 layoutTrackingInfo 失败:', error);
      }
    }

    // brand 和 category_path/level 不再从 OZON API 提取，使用上品帮数据

    return {
      ozon_product_id,
      sku,  // 添加 sku 字段（与 ozon_product_id 相同）
      title,
      cardPrice,  // 绿色价格
      price,      // 黑色价格
      original_price: original_price > 0 ? original_price : undefined,  // 划线价
      images,
      videos: videos.length > 0 ? videos : undefined,
      category_id,
    };
  } catch (error) {
    console.error('[EuraFlow] 解析 widgetStates 失败:', error);
    return null;
  }
}

export async function extractProductData(): Promise<ProductDetailData> {
  let baseData: any = null;  // 提升到外部，确保 catch 块能访问

  try {
    const productUrl = window.location.href;

    // 获取基础数据（完整的 API 响应，包含 widgetStates 和 layoutTrackingInfo）
    const apiResponse = await fetchProductDataFromOzonAPI(productUrl);
    baseData = parseFromWidgetStates(apiResponse);

    if (!baseData) {
      throw new Error('解析基础数据失败');
    }

    // 提取商品 slug（用于 Page2 API）
    const slugMatch = productUrl.match(/\/product\/([^\/\?]+)/);
    const productSlug = slugMatch ? slugMatch[1] : null;

    // 提取商品 SKU（提前，用于 Modal API）
    const productSku = baseData.ozon_product_id;

    // ========== 从 Modal API 获取完整变体数据（优先执行，让 UI 尽早显示）==========
    // 检查页面是否有变体
    const widgetStates = apiResponse?.widgetStates || {};
    const aspectsKey = Object.keys(widgetStates).find(k => k.includes('webAspects'));
    let modalAspects: any[] = [];
    let hasVariantsOnPage = false;

    if (aspectsKey) {
      const aspectsData = JSON.parse(widgetStates[aspectsKey]);
      modalAspects = aspectsData?.aspects || [];
      hasVariantsOnPage = modalAspects.length > 0;
    }

    // ✅ 优先调用 Modal API 获取完整变体（在 Page2 API 之前）
    if (productSku && hasVariantsOnPage) {
      const modalApiAspects = await fetchFullVariantsFromModal(productSku);
      if (modalApiAspects && modalApiAspects.length > 0) {
        modalAspects = modalApiAspects;
      }
    }

    // 调用 Page2 API 获取完整特征和描述（在 Modal API 之后）
    if (productSlug) {
      const page2Data = await fetchCharacteristicsAndDescription(productSlug);
      if (page2Data) {
        // 合并 Page2 数据到基础数据
        if (page2Data.description) {
          baseData.description = page2Data.description;
        }
        if (page2Data.attributes && page2Data.attributes.length > 0) {
          baseData.attributes = page2Data.attributes;
        }
        if (page2Data.typeNameRu) {
          baseData.typeNameRu = page2Data.typeNameRu;
        }
      }
    }

    // ========== 获取尺寸和重量数据 ==========
    // 优先级：1. 特征属性 > 2. OZON Seller API > 3. 上品帮 DOM

    // 方案 0（最高优先级）：从特征属性中提取尺寸
    // 特征中的长宽高单位是 cm，需要转换为 mm
    if (baseData.attributes && baseData.attributes.length > 0) {
      const dimensionsFromAttrs: { weight?: number; height?: number; width?: number; length?: number } = {};

      for (const attr of baseData.attributes) {
        const key = ((attr as any).key || '').toLowerCase();  // key 是英文标识符，更可靠
        const value = parseFloat(attr.value);

        if (isNaN(value)) continue;

        // 只用 key 匹配，不依赖多语言的 name
        if (key === 'length') {
          dimensionsFromAttrs.length = Math.round(value * 10);  // cm → mm
        } else if (key === 'width') {
          dimensionsFromAttrs.width = Math.round(value * 10);  // cm → mm
        } else if (key === 'height') {
          dimensionsFromAttrs.height = Math.round(value * 10);  // cm → mm
        } else if (key === 'weight') {
          dimensionsFromAttrs.weight = Math.round(value);  // 克
        }
      }

      // 如果从属性中提取到了完整的尺寸数据，使用它
      if (dimensionsFromAttrs.length && dimensionsFromAttrs.width && dimensionsFromAttrs.height && dimensionsFromAttrs.weight) {
        baseData.dimensions = {
          length: dimensionsFromAttrs.length,
          width: dimensionsFromAttrs.width,
          height: dimensionsFromAttrs.height,
          weight: dimensionsFromAttrs.weight,
        };
        if (__DEBUG__) {
          console.log('[EuraFlow] 从特征属性提取尺寸（cm→mm）:', baseData.dimensions);
        }
      }
    }

    // 方案 1（降级）：如果特征中没有尺寸，尝试通过 OZON Seller API 获取
    if (!baseData.dimensions && productSku) {
      const ozonDimensions = await fetchDimensionsFromOzonAPI(productSku);

      if (ozonDimensions) {
        // 检查是否所有字段都有效
        if (
          ozonDimensions.weight !== undefined &&
          ozonDimensions.height !== undefined &&
          ozonDimensions.width !== undefined &&
          ozonDimensions.length !== undefined
        ) {
          baseData.dimensions = {
            weight: ozonDimensions.weight,
            height: ozonDimensions.height,
            width: ozonDimensions.width,
            length: ozonDimensions.length,
          };
        }
      }
    }

    // 方案 2（降级）：如果 OZON API 失败，尝试从上品帮 DOM 提取
    if (!baseData.dimensions) {
      const hasInjectedDOM = await waitForInjectedDOM();

      if (hasInjectedDOM) {
        let injectedData = extractDataFromInjectedDOM();

        if (injectedData && Object.keys(injectedData).length > 0) {
          // 检查尺寸数据是否为"-"（-1），需要二次轮询
          if (
            injectedData.weight !== undefined &&
            injectedData.height !== undefined &&
            injectedData.width !== undefined &&
            injectedData.length !== undefined &&
            (injectedData.weight === -1 ||
             injectedData.height === -1 ||
             injectedData.width === -1 ||
             injectedData.length === -1)
          ) {
            // 等待尺寸数据更新
            await waitForDimensionsData();

            // 重新提取数据
            injectedData = extractDataFromInjectedDOM();
          }

        // 合并 dimensions 数据（如果所有必需字段都存在且有效）
        if (
          injectedData &&
          injectedData.weight !== undefined &&
          injectedData.height !== undefined &&
          injectedData.width !== undefined &&
          injectedData.length !== undefined
        ) {
          // 检查是否仍为 -1（真正没数据）或者是"非热销,无数据"（undefined）
          if (
            injectedData.weight === -1 ||
            injectedData.height === -1 ||
            injectedData.width === -1 ||
            injectedData.length === -1
          ) {
            // 二次轮询后仍为"-"，真正没有数据
            baseData.dimensions = undefined;
          } else {
            baseData.dimensions = {
              weight: injectedData.weight,
              height: injectedData.height,
              width: injectedData.width,
              length: injectedData.length,
            };
          }
        }

        // brand 数据直接使用上品帮的（不再从 OZON API 提取）
        if (injectedData && injectedData.brand) {
          baseData.brand = injectedData.brand;
        }

        // 合并 description 数据（如果存在）
        if (injectedData && injectedData.description) {
          baseData.description = injectedData.description;
        }
      }
    }
    }

    // ========== 处理变体数据 ==========
    // Modal API 已在前面调用（优先执行），此处直接使用 modalAspects
    let allVariants: any[] = [];

    if (modalAspects && modalAspects.length > 0) {

      // ✅ 先从当前页面的 webAspects 提取当前选中颜色的所有尺码
      const currentPageAspectsKey = Object.keys(widgetStates).find(k => k.includes('webAspects'));
      if (currentPageAspectsKey) {
        const currentPageAspectsData = JSON.parse(widgetStates[currentPageAspectsKey]);
        const currentPageAspects = currentPageAspectsData?.aspects || [];

        if (currentPageAspects.length > 0) {
          const lastAspect = currentPageAspects[currentPageAspects.length - 1];
          const currentVariants = lastAspect?.variants || [];

          currentVariants.forEach((variant: any) => {
            const { sku, link } = variant;
            const { title, price, cardPrice, originalPrice, searchableText, coverImage } = variant.data || {};

            if (searchableText === 'Уцененные') {
              return;
            }

            // 构建规格文本和规格详情
            const specs: string[] = [];
            const specDetails: Record<string, string> = {};
            currentPageAspects.forEach((aspect: any) => {
              const v = aspect.variants.find((v: any) => v.sku === sku) || aspect.variants.find((v: any) => v.active);
              if (v?.data?.searchableText) {
                specs.push(v.data.searchableText);
                if (aspect.title) {
                  specDetails[aspect.title] = v.data.searchableText;
                }
              }
            });
            const specText = specs.join(' / ');

            // 解析价格的通用函数
            const parsePrice = (p: any): number => {
              if (!p) return 0;
              if (typeof p === 'string') {
                return parseFloat(p.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
              }
              return parseFloat(p) || 0;
            };

            const priceNum = parsePrice(price);           // 黑色价格
            const cardPriceNum = parsePrice(cardPrice);   // 绿色价格
            const originalPriceNum = parsePrice(originalPrice) || undefined;
            // 计算真实售价
            const realPriceNum = calculateRealPriceCore(cardPriceNum, priceNum);

            // 构建变体图片数组：主图(coverImage高清版) + 附加图片
            const variantImgs: { url: string; is_primary: boolean }[] = [];
            const hdCoverImage = toHdImageUrl(coverImage || '');
            if (hdCoverImage) {
              variantImgs.push({ url: hdCoverImage, is_primary: true });
            }
            baseData.images.forEach((img: { url: string }) => {
              if (img.url !== hdCoverImage) {
                variantImgs.push({ url: img.url, is_primary: false });
              }
            });

            allVariants.push({
              variant_id: sku,
              name: title || '',
              specifications: specText,
              spec_details: Object.keys(specDetails).length > 0 ? specDetails : undefined,
              image_url: coverImage || '',
              images: variantImgs.length > 0 ? variantImgs : undefined,
              link: link ? link.split('?')[0] : '',
              price: priceNum,
              cardPrice: cardPriceNum,
              realPrice: realPriceNum,
              original_price: originalPriceNum,
              stock: undefined,
              sku: sku,
              available: true
            });
          });
        }
      }

      // ✅ 扁平化其他颜色的 variant 链接（排除当前页面的 SKU）
      const allVariantLinks: any[] = [];
      modalAspects.forEach((aspect: any) => {
        aspect.variants.forEach((variant: any) => {
          // 过滤瑕疵品和当前页面的 SKU
          if (variant.data?.searchableText !== 'Уцененные' && variant.sku !== productSku) {
            allVariantLinks.push({
              sku: variant.sku,
              link: variant.link ? variant.link.split('?')[0] : '',
              data: variant.data
            });
          }
        });
      });

      // ✅ 并行批量访问变体详情页（参考上品帮策略：每批30个并行，批间隔2秒）
      const BATCH_SIZE = 30;  // 每批并行请求数
      const BATCH_DELAY = 2000;  // 批次间隔（毫秒）

      /**
       * 处理单个变体链接，返回解析后的变体数组
       */
      const processVariantLink = async (variantLink: any): Promise<any[]> => {
        try {
          const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(variantLink.link)}`;

          // 通过页面上下文执行请求（避免 403 反爬虫检测）
          const data = await fetchViaPageContext(apiUrl);
          if (!data) {
            return [];
          }

          const variantWidgetStates = data.widgetStates || {};
          const variantAspectsKey = Object.keys(variantWidgetStates).find(k => k.includes('webAspects'));

          if (!variantAspectsKey) {
            return [];
          }

          const variantAspectsData = JSON.parse(variantWidgetStates[variantAspectsKey]);
          const variantAspects = variantAspectsData?.aspects || [];

          // 提取变体的图片列表
          const variantGalleryKey = Object.keys(variantWidgetStates).find(k => k.includes('webGallery'));
          const variantImages: { url: string; is_primary?: boolean }[] = [];
          if (variantGalleryKey) {
            const variantGalleryData = JSON.parse(variantWidgetStates[variantGalleryKey]);
            if (variantGalleryData?.images && Array.isArray(variantGalleryData.images)) {
              variantGalleryData.images.forEach((img: any, index: number) => {
                if (img.src) {
                  variantImages.push({
                    url: img.src,
                    is_primary: index === 0
                  });
                }
              });
            }
          }

          const result: any[] = [];

          // 从最后一个 aspect 提取变体
          if (variantAspects.length > 0) {
            const lastAspect = variantAspects[variantAspects.length - 1];
            const variants = lastAspect?.variants || [];

            variants.forEach((variant: any) => {
              const { sku, link } = variant;
              const { title, price, cardPrice, originalPrice, searchableText, coverImage } = variant.data || {};

              if (searchableText === 'Уцененные') {
                return;
              }

              // 构建规格文本和规格详情
              const specs: string[] = [];
              const specDetails: Record<string, string> = {};
              variantAspects.forEach((aspect: any) => {
                const v = aspect.variants.find((v: any) => v.sku === sku) || aspect.variants.find((v: any) => v.active);
                if (v?.data?.searchableText) {
                  specs.push(v.data.searchableText);
                  if (aspect.title) {
                    specDetails[aspect.title] = v.data.searchableText;
                  }
                }
              });
              const specText = specs.join(' / ');

              // 解析价格
              const parsePrice = (p: any): number => {
                if (!p) return 0;
                if (typeof p === 'string') {
                  return parseFloat(p.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
                }
                return parseFloat(p) || 0;
              };

              const priceNum = parsePrice(price);
              const cardPriceNum = parsePrice(cardPrice);
              const originalPriceNum = parsePrice(originalPrice) || undefined;
              const realPriceNum = calculateRealPriceCore(cardPriceNum, priceNum);

              // 构建变体图片数组：主图(coverImage高清版) + 附加图片
              const variantImgs: { url: string; is_primary: boolean }[] = [];
              const hdCoverImage = toHdImageUrl(coverImage || '');
              if (hdCoverImage) {
                variantImgs.push({ url: hdCoverImage, is_primary: true });
              }
              variantImages.forEach(img => {
                if (img.url !== hdCoverImage) {
                  variantImgs.push({ url: img.url, is_primary: false });
                }
              });

              result.push({
                variant_id: sku,
                name: title || '',
                specifications: specText,
                spec_details: Object.keys(specDetails).length > 0 ? specDetails : undefined,
                image_url: coverImage || '',
                images: variantImgs.length > 0 ? variantImgs : undefined,
                link: link ? link.split('?')[0] : '',
                price: priceNum,
                cardPrice: cardPriceNum,
                realPrice: realPriceNum,
                original_price: originalPriceNum,
                stock: undefined,
                sku: sku,
                available: true
              });
            });
          }

          return result;
        } catch (error: any) {
          return [];
        }
      };

      // 批量并行请求
      const totalBatches = Math.ceil(allVariantLinks.length / BATCH_SIZE);
      if (__DEBUG__) {
        console.log(`[EuraFlow] 变体链接总数: ${allVariantLinks.length}, 分 ${totalBatches} 批并行处理`);
      }

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, allVariantLinks.length);
        const batchLinks = allVariantLinks.slice(batchStart, batchEnd);

        if (__DEBUG__) {
          console.log(`[EuraFlow] 处理第 ${batchIndex + 1}/${totalBatches} 批 (${batchLinks.length} 个变体)`);
        }

        // 并行处理当前批次
        const batchPromises = batchLinks.map(link => processVariantLink(link));
        const batchResults = await Promise.all(batchPromises);

        // 合并结果
        batchResults.forEach(variants => {
          allVariants.push(...variants);
        });

        // 批次间延迟（最后一批不需要延迟）
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }

    }

    // 按 variant_id 去重
    const seenIds = new Set<string>();
    const finalVariants = allVariants.filter(v => {
      if (seenIds.has(v.variant_id)) return false;
      seenIds.add(v.variant_id);
      return true;
    });

    const finalData = {
      ...baseData,
      has_variants: finalVariants.length > 0,
      variants: finalVariants,
    };

    return finalData;
  } catch (error) {
    console.error('[EuraFlow] 商品数据采集失败:', error);

    // 如果 baseData 已成功提取（包含 dimensions 等关键数据），返回它
    if (baseData && baseData.ozon_product_id) {
      console.warn('[EuraFlow] 变体处理失败，但返回已提取的基础数据（包含 dimensions）');
      return {
        ...baseData,
        has_variants: false,
        variants: undefined,
      };
    }

    // 完全失败时才返回最小有效数据
    return {
      title: '',
      cardPrice: 0,
      price: 0,
      images: [],
      has_variants: false,
    };
  }
}

/**
 * 快速提取商品基础数据（仅调用一次 API，用于尽早显示按钮）
 * 返回价格、标题、图片、基础变体等信息
 * 变体数据来自 webAspects（当前页面可见的变体，不需要额外 API 请求）
 */
export async function extractProductDataFast(): Promise<{
  baseData: ProductDetailData | null;
  apiResponse: any;
  productSku: string | null;
  productSlug: string | null;
}> {
  try {
    const productUrl = window.location.href;

    // 获取基础数据（完整的 API 响应，包含 widgetStates 和 layoutTrackingInfo）
    const apiResponse = await fetchProductDataFromOzonAPI(productUrl);
    const baseData = parseFromWidgetStates(apiResponse);

    if (!baseData) {
      return { baseData: null, apiResponse: null, productSku: null, productSlug: null };
    }

    // 提取商品 slug（用于 Page2 API）
    const slugMatch = productUrl.match(/\/product\/([^\/\?]+)/);
    const productSlug = slugMatch ? slugMatch[1] : null;
    const productSku = baseData.ozon_product_id || null;

    // ========== 快速提取变体数据（从 webAspects，无需额外 API）==========
    const widgetStates = apiResponse?.widgetStates || {};
    const aspectsKey = Object.keys(widgetStates).find(k => k.includes('webAspects'));
    let variants: any[] | undefined;
    let hasVariants = false;

    if (aspectsKey) {
      const aspectsData = JSON.parse(widgetStates[aspectsKey]);
      const aspects = aspectsData?.aspects || [];

      if (aspects.length > 0) {
        hasVariants = true;
        variants = [];

        // 提取当前页面可见的变体（当前颜色的所有尺码）
        const lastAspect = aspects[aspects.length - 1];
        const currentVariants = lastAspect?.variants || [];

        for (const variant of currentVariants) {
          const variantSku = variant.sku;
          const variantLink = variant.link?.split('?')[0] || '';
          const isAvailable = variant.isAvailable !== false;

          // 构建规格描述
          const specParts: string[] = [];
          aspects.forEach((aspect: any) => {
            const selectedVariant = aspect.variants?.find((v: any) => v.isSelected);
            if (selectedVariant?.data?.searchableText) {
              specParts.push(selectedVariant.data.searchableText);
            }
          });
          // 替换最后一个规格为当前变体的规格
          if (variant.data?.searchableText) {
            specParts[specParts.length - 1] = variant.data.searchableText;
          }
          const specifications = specParts.join(' / ') || '默认';

          // 提取变体图片（从 variant.data.image）
          const variantImageUrl = variant.data?.image?.link || variant.data?.image?.src || '';

          // 使用主商品价格（变体价格需要额外请求，快速模式下使用统一价格）
          const variantPrice = baseData.price || 0;
          const variantCardPrice = baseData.cardPrice || 0;
          const realPrice = calculateRealPriceCore(variantCardPrice, variantPrice);

          variants.push({
            variant_id: variantSku,
            sku: variantSku,
            specifications,
            image_url: variantImageUrl,
            images: variantImageUrl ? [{ url: variantImageUrl, is_primary: true }] : undefined,
            price: variantPrice,
            cardPrice: variantCardPrice,
            realPrice,
            link: variantLink,
            available: isAvailable,
          });
        }

        // 如果是单品（没有变体列表但有 aspects），添加当前商品作为唯一变体
        if (variants.length === 0 && productSku) {
          variants.push({
            variant_id: productSku,
            sku: productSku,
            specifications: '单品',
            image_url: baseData.images?.[0]?.url || '',
            images: baseData.images,
            price: baseData.price || 0,
            cardPrice: baseData.cardPrice || 0,
            realPrice: calculateRealPriceCore(baseData.cardPrice || 0, baseData.price || 0),
            available: true,
          });
        }
      }
    }

    // 如果没有变体数据，创建单品变体
    if (!variants || variants.length === 0) {
      variants = [{
        variant_id: productSku || 'single',
        sku: productSku || 'single',
        specifications: '单品',
        image_url: baseData.images?.[0]?.url || '',
        images: baseData.images,
        price: baseData.price || 0,
        cardPrice: baseData.cardPrice || 0,
        realPrice: calculateRealPriceCore(baseData.cardPrice || 0, baseData.price || 0),
        available: true,
      }];
    }

    return {
      baseData: {
        ...baseData,
        has_variants: hasVariants,
        variants,
      },
      apiResponse,
      productSku,
      productSlug,
    };
  } catch (error) {
    console.error('[EuraFlow] 快速数据提取失败:', error);
    return { baseData: null, apiResponse: null, productSku: null, productSlug: null };
  }
}

/**
 * 异步加载完整商品数据（变体、描述、尺寸等）
 * 在按钮显示后后台执行，完成后通过回调更新数据
 */
export async function extractProductDataAsync(
  apiResponse: any,
  productSku: string,
  productSlug: string | null,
  baseData: ProductDetailData,
  onUpdate?: (data: ProductDetailData) => void
): Promise<ProductDetailData> {
  try {
    const widgetStates = apiResponse?.widgetStates || {};

    // ========== 1. 先获取 Page2 数据（描述、特征、尺寸优先）==========
    if (productSlug) {
      const page2Data = await fetchCharacteristicsAndDescription(productSlug);
      if (page2Data) {
        if (page2Data.description) {
          baseData.description = page2Data.description;
        }
        if (page2Data.attributes && page2Data.attributes.length > 0) {
          baseData.attributes = page2Data.attributes;
        }
        if (page2Data.typeNameRu) {
          baseData.typeNameRu = page2Data.typeNameRu;
        }
      }
    }

    // ========== 2. 从特征属性提取尺寸 ==========
    if (baseData.attributes && baseData.attributes.length > 0) {
      const dimensionsFromAttrs: { weight?: number; height?: number; width?: number; length?: number } = {};

      for (const attr of baseData.attributes) {
        const key = ((attr as any).key || '').toLowerCase();
        const value = parseFloat(attr.value);

        if (isNaN(value)) continue;

        if (key === 'length') {
          dimensionsFromAttrs.length = Math.round(value * 10);
        } else if (key === 'width') {
          dimensionsFromAttrs.width = Math.round(value * 10);
        } else if (key === 'height') {
          dimensionsFromAttrs.height = Math.round(value * 10);
        } else if (key === 'weight') {
          dimensionsFromAttrs.weight = Math.round(value);
        }
      }

      if (dimensionsFromAttrs.length && dimensionsFromAttrs.width && dimensionsFromAttrs.height && dimensionsFromAttrs.weight) {
        baseData.dimensions = {
          length: dimensionsFromAttrs.length,
          width: dimensionsFromAttrs.width,
          height: dimensionsFromAttrs.height,
          weight: dimensionsFromAttrs.weight,
        };
      }
    }

    // 尺寸提取完成后立即回调更新（让按钮尽早显示）
    if (baseData.dimensions && onUpdate) {
      onUpdate({ ...baseData });
    }

    // ========== 3. 如果没有尺寸，尝试其他来源 ==========
    if (!baseData.dimensions && productSku) {
      const ozonDimensions = await fetchDimensionsFromOzonAPI(productSku);
      if (ozonDimensions?.weight !== undefined && ozonDimensions?.height !== undefined &&
          ozonDimensions?.width !== undefined && ozonDimensions?.length !== undefined) {
        baseData.dimensions = {
          weight: ozonDimensions.weight,
          height: ozonDimensions.height,
          width: ozonDimensions.width,
          length: ozonDimensions.length,
        };
        if (onUpdate) {
          onUpdate({ ...baseData });
        }
      }
    }

    // ========== 4. 尝试从上品帮 DOM 提取尺寸（降级方案）==========
    if (!baseData.dimensions) {
      const hasInjectedDOM = await waitForInjectedDOM();
      if (hasInjectedDOM) {
        let injectedData = extractDataFromInjectedDOM();

        if (injectedData && Object.keys(injectedData).length > 0) {
          if (injectedData.weight !== undefined && injectedData.height !== undefined &&
              injectedData.width !== undefined && injectedData.length !== undefined &&
              (injectedData.weight === -1 || injectedData.height === -1 ||
               injectedData.width === -1 || injectedData.length === -1)) {
            await waitForDimensionsData();
            injectedData = extractDataFromInjectedDOM();
          }

          if (injectedData?.weight !== undefined && injectedData?.height !== undefined &&
              injectedData?.width !== undefined && injectedData?.length !== undefined) {
            if (injectedData.weight !== -1 && injectedData.height !== -1 &&
                injectedData.width !== -1 && injectedData.length !== -1) {
              baseData.dimensions = {
                weight: injectedData.weight,
                height: injectedData.height,
                width: injectedData.width,
                length: injectedData.length,
              };
              if (onUpdate) {
                onUpdate({ ...baseData });
              }
            }
          }

          if (injectedData?.brand) {
            (baseData as any).brand = injectedData.brand;
          }
          if (injectedData?.description && !baseData.description) {
            (baseData as any).description = injectedData.description;
          }
        }
      }
    }

    // ========== 5. 处理变体数据（最慢的部分，放最后）==========
    const aspectsKey = Object.keys(widgetStates).find(k => k.includes('webAspects'));
    let modalAspects: any[] = [];

    if (aspectsKey) {
      const aspectsData = JSON.parse(widgetStates[aspectsKey]);
      modalAspects = aspectsData?.aspects || [];
    }

    // 获取 Modal API 完整变体
    if (productSku && modalAspects.length > 0) {
      const modalApiAspects = await fetchFullVariantsFromModal(productSku);
      if (modalApiAspects && modalApiAspects.length > 0) {
        modalAspects = modalApiAspects;
      }
    }

    // 处理变体数据（复用原有逻辑，这里简化）
    if (modalAspects && modalAspects.length > 0) {
      baseData.has_variants = true;
      // 变体详情处理较复杂，调用原函数处理
      const fullData = await extractProductData();
      return fullData;
    }

    return baseData;
  } catch (error) {
    console.error('[EuraFlow] 异步数据加载失败:', error);
    return baseData;
  }
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

/**
 * 通过页面上下文获取跟卖数据
 * 调用 OZON 的 otherOffersFromSellers API
 */
export async function fetchFollowSellerData(productId: string): Promise<{
  count: number;
  skus: string[];
  prices: number[];
  sellers: any[];  // 完整的卖家列表（用于悬浮窗口显示）
} | null> {
  try {
    const modalUrl = `/modal/otherOffersFromSellers?product_id=${productId}&page_changed=true`;
    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(modalUrl)}`;

    if (__DEBUG__) {
      console.log('[API] fetchFollowSellerData 请求:', { productId, apiUrl });
    }

    // 通过页面上下文执行请求（避免 403 反爬虫检测）
    const data = await fetchViaPageContext(apiUrl);
    if (!data) {
      if (__DEBUG__) {
        console.log('[API] fetchFollowSellerData 返回: null（请求失败）');
      }
      return null;
    }

    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);

    // 查找 webSellerList widget（跟卖者列表）
    const modalKey = keys.find(k => k.includes('webSellerList'));
    if (!modalKey) {
      return { count: 0, skus: [], prices: [], sellers: [] };
    }

    const modalData = JSON.parse(widgetStates[modalKey]);
    const sellers = modalData?.sellers || [];

    const skus: string[] = [];
    const prices: number[] = [];

    for (const seller of sellers) {
      if (seller.sku) {
        skus.push(seller.sku);
      }
      // 提取价格（从 price.cardPrice.price 或 price.price）
      const priceStr = seller.price?.cardPrice?.price || seller.price?.price || '';
      if (priceStr) {
        // 价格格式如 "61,23 ¥"
        const priceNum = parseFloat(priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
        if (!isNaN(priceNum) && priceNum > 0) {
          prices.push(priceNum);
        }
      }
    }

    const result = {
      count: sellers.length,
      skus,
      prices,
      sellers  // 返回完整的卖家列表
    };

    if (__DEBUG__) {
      console.log('[API] fetchFollowSellerData 返回:', result);
    }

    return result;
  } catch (error: any) {
    console.error('[EuraFlow] 获取跟卖数据失败:', error.message);
    return null;
  }
}
