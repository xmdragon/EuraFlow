/**
 * OZON 商品详情页数据采集器
 *
 * 数据源：
 * 1. widgetStates API - title/price/images/category_id/brand
 * 2. Page2 API - description/attributes
 * 3. 上品帮注入DOM - dimensions/brand
 * 4. Modal API - variants（完整变体数据）
 */

export interface ProductDetailData {
  ozon_product_id?: string;
  sku?: string;
  title: string;
  description?: string;
  category_id?: number;
  price: number;
  original_price?: number;
  brand?: string;
  barcode?: string;
  images: string[];
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
  variants?: Array<{
    variant_id: string;
    specifications: string;
    spec_details?: Record<string, string>;
    image_url: string;
    price: number;
    original_price?: number;
    available: boolean;
    link?: string;
  }>;
  has_variants: boolean;
}

async function fetchProductDataFromOzonAPI(productUrl: string): Promise<any | null> {
  try {
    const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

    // ✅ 在 Content Script 中直接 fetch（显示在网络面板，不被识别为扩展爬虫）
    // 使用全局 OZON API 限流器和标准 headers（避免触发限流）
    const { OzonApiRateLimiter } = await import('../../shared/ozon-rate-limiter');
    const { getOzonStandardHeaders } = await import('../../shared/ozon-headers');
    const limiter = OzonApiRateLimiter.getInstance();

    const headers = await getOzonStandardHeaders({
      referer: window.location.href,
      includeContentType: false
    });

    const response = await limiter.execute(() =>
      fetch(apiUrl, {
        method: 'GET',
        headers,
        credentials: 'include',
      })
    );

    if (!response.ok) {
      console.error(`[EuraFlow] OZON API 请求失败: ${response.status}`);
      throw new Error(`API请求失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data.widgetStates) {
      console.error('[EuraFlow] OZON API 返回数据中没有 widgetStates');
      throw new Error('widgetStates 不存在');
    }

    // 返回完整的 API 响应（包含 layoutTrackingInfo 等字段）
    return data;
  } catch (error) {
    console.error('[EuraFlow] 调用 OZON API 失败:', error);
    throw error;
  }
}

/**
 * 通过 OZON Modal API 获取完整变体数据（上品帮方案）
 * 调用 /modal/aspectsNew?product_id={id} 获取完整的变体列表
 */
async function fetchFullVariantsFromModal(productId: string): Promise<any[] | null> {
  try {
    const modalUrl = `/modal/aspectsNew?product_id=${productId}`;
    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(modalUrl)}`;

    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 正在调用 OZON Modal API 获取完整变体: ${apiUrl}`);
    }

    // ✅ 在 Content Script 中直接 fetch（显示在网络面板）
    const { getOzonStandardHeaders } = await import('../../shared/ozon-headers');
    const headers = await getOzonStandardHeaders({
      referer: window.location.href
    });

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers,
      credentials: 'include'
    });

    if (!response.ok) {
      console.warn(`[EuraFlow] Modal API 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);

    // 查找 webAspectsModal widget
    const modalKey = keys.find(k => k.includes('webAspectsModal'));
    if (!modalKey) {
      console.warn('[EuraFlow] Modal API 返回数据中没有 webAspectsModal');
      return null;
    }

    const modalData = JSON.parse(widgetStates[modalKey]);
    const aspects = modalData?.aspects;

    if (!aspects || !Array.isArray(aspects)) {
      return null;
    }

    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 从 Modal API 获取到 ${aspects.length} 个 aspect`);
    }

    return aspects;
  } catch (error) {
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
    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 调用 OZON API 获取尺寸和重量, SKU: ${productSku}`);
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
      console.warn('[EuraFlow] OZON API 调用失败:', response.error);
      return null;
    }

    const dimensions = response.data?.dimensions;
    if (!dimensions) {
      if (window.EURAFLOW_DEBUG) {
        console.log('[EuraFlow] OZON API 返回的数据中没有 dimensions');
      }
      return null;
    }

    // 转换数据格式（从字符串转为数字）
    const result = {
      weight: dimensions.weight ? parseFloat(dimensions.weight) : undefined,
      height: dimensions.height ? parseFloat(dimensions.height) : undefined,
      width: dimensions.width ? parseFloat(dimensions.width) : undefined,
      length: dimensions.depth ? parseFloat(dimensions.depth) : undefined,  // OZON API 使用 depth
    };

    if (window.EURAFLOW_DEBUG) {
      console.log('[EuraFlow] 从 OZON API 获取到 dimensions:', result);
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
      if (window.EURAFLOW_DEBUG) {
        console.log('[EuraFlow] 从上品帮注入的 DOM 中提取到数据:', result);
      }
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
        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] 检测到上品帮注入的 DOM（尝试 ${attempts} 次）`);
        }
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        if (window.EURAFLOW_DEBUG) {
          console.log('[EuraFlow] 超时：未检测到上品帮注入的 DOM');
        }
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
        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] 尺寸数据已更新（尝试 ${attempts} 次，耗时 ${attempts * 100}ms）:`, data);
        }
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        if (window.EURAFLOW_DEBUG) {
          console.log('[EuraFlow] 超时：尺寸数据仍为"-"（等待10秒后超时），可能真的没有数据');
        }
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
} | null> {
  try {
    // 构造 Page2 API URL
    const page2Url = `/product/${productSlug}/?layout_container=pdpPage2column&layout_page_index=2`;
    const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(page2Url)}`;

    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 正在调用 OZON Page2 API 获取特征和描述: ${apiUrl}`);
    }

    // ✅ 在 Content Script 中直接 fetch（显示在网络面板）
    const { getOzonStandardHeaders } = await import('../../shared/ozon-headers');
    const headers = await getOzonStandardHeaders({
      referer: window.location.href
    });

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers,
      credentials: 'include'
    });

    if (!response.ok) {
      console.warn(`[EuraFlow] Page2 API 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);

    const extracted: {
      description?: string;
      attributes?: Array<{ attribute_id: number; value: string; dictionary_value_id?: number }>;
    } = {};

    // 1. 提取 webDescription
    const descriptionKey = keys.find(k => k.includes('webDescription') && k.includes('pdpPage2column'));
    if (descriptionKey) {
      const descriptionData = JSON.parse(widgetStates[descriptionKey]);
      if (descriptionData?.richAnnotation) {
        const desc = descriptionData.richAnnotation;
        extracted.description = desc;
        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] 从 Page2 API 提取到描述: ${desc.substring(0, 80)}...`);
        }
      }
    }

    // 2. 提取 webCharacteristics
    const characteristicsKey = keys.find(k => k.includes('webCharacteristics') && k.includes('pdpPage2column'));
    if (characteristicsKey) {
      const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
      if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
        const attributes: Array<{ attribute_id: number; value: string; dictionary_value_id?: number }> = [];

        // 遍历所有特征组
        for (const group of characteristicsData.characteristics) {
          if (group.short && Array.isArray(group.short)) {
            for (const attr of group.short) {
              // 提取特征值
              if (attr.values && Array.isArray(attr.values) && attr.values.length > 0) {
                const value = attr.values.map((v: any) => v.text).join(', ');

                // 简单的 attribute_id 生成（基于 key 的哈希）
                const attributeId = Math.abs(hashCode(attr.key));

                attributes.push({
                  attribute_id: attributeId,
                  value: value,
                });
              }
            }
          }
        }

        extracted.attributes = attributes;

        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] 从 Page2 API 提取到 ${attributes.length} 个特征`);
        }
      }
    }

    return Object.keys(extracted).length > 0 ? extracted : null;
  } catch (error) {
    console.error('[EuraFlow] 调用 Page2 API 失败:', error);
    return null;
  }
}

/**
 * 简单的字符串哈希函数（用于生成 attribute_id）
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
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
    const priceKey = keys.find(k => k.includes('webPrice'));
    const priceData = priceKey ? JSON.parse(widgetStates[priceKey]) : null;
    // 移除空格、逗号（欧洲格式），替换为点
    const cleanPrice = (str: string) => str.replace(/\s/g, '').replace(/,/g, '.');
    const price = parseFloat(cleanPrice(priceData?.price || priceData?.cardPrice || '0'));
    const original_price = parseFloat(cleanPrice(priceData?.originalPrice || '0'));

    // 3. 提取图片和视频
    const galleryKey = keys.find(k => k.includes('webGallery'));
    const galleryData = galleryKey ? JSON.parse(widgetStates[galleryKey]) : null;
    const images: string[] = [];
    const videos: string[] = [];
    if (galleryData?.images && Array.isArray(galleryData.images)) {
      galleryData.images.forEach((img: any) => {
        if (img.src) images.push(img.src);
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

    // 4. 提取商品ID
    const urlMatch = window.location.pathname.match(/product\/.*-(\d+)/);
    const ozon_product_id = urlMatch ? urlMatch[1] : undefined;

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

    // 7. 提取品牌（webProductHeading 或 webCharacteristics）
    let brand: string | undefined = headingData?.brand || undefined;
    if (!brand) {
      const characteristicsKey = keys.find(k => k.includes('webCharacteristics'));
      if (characteristicsKey) {
        const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
        if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
          const brandChar = characteristicsData.characteristics.find(
            (char: any) => char.title === 'Бренд' || char.key === 'brand'
          );
          if (brandChar?.values && brandChar.values.length > 0) {
            brand = brandChar.values[0].text || brandChar.values[0].value;
          }
        }
      }
    }

    // 8. 提取类目特征（webCharacteristics）
    const attributes: ProductDetailData['attributes'] = [];
    const characteristicsKey = keys.find(k => k.includes('webCharacteristics'));
    if (characteristicsKey) {
      const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
      if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
        characteristicsData.characteristics.forEach((char: any) => {
          // 跳过已经提取的字段（品牌）
          if (['Бренд'].includes(char.title)) {
            return;
          }

          if (char.values && char.values.length > 0) {
            const value = char.values.map((v: any) => v.text || v.value).join(', ');
            attributes.push({
              attribute_id: char.id || 0,
              value,
              dictionary_value_id: char.values[0]?.id || undefined,
            });
          }
        });
      }
    }

    // 调试日志
    if (window.EURAFLOW_DEBUG) {
      console.log('[EuraFlow] 提取的完整商品数据:', {
        ozon_product_id,
        title,
        price,
        original_price,
        images: images.length,
        videos: videos.length,
        category_id,
        brand,
        attributes: attributes.length,
      });
    }

    return {
      ozon_product_id,
      title,
      price,
      original_price: original_price > price ? original_price : undefined,
      images,
      videos: videos.length > 0 ? videos : undefined,
      category_id,
      brand,
      attributes: attributes.length > 0 ? attributes : undefined,
    };
  } catch (error) {
    console.error('[EuraFlow] 解析 widgetStates 失败:', error);
    return null;
  }
}

/**
 * 第一阶段：从 webAspects 提取变体列表
 */
function extractVariantsStage1(widgetStates: any): any[] {
  try {
    const keys = Object.keys(widgetStates);
    const aspectsKey = keys.find(k => k.includes('webAspects'));

    if (!aspectsKey) {
      return [];
    }

    const aspectsData = JSON.parse(widgetStates[aspectsKey]);
    const aspects = aspectsData?.aspects;

    if (!aspects || !Array.isArray(aspects)) {
      return [];
    }

    // 扁平化提取所有变体
    const allVariants = aspects
      .map(aspect => aspect.variants || [])
      .flat(3);

    // 过滤"Уцененные"并清理链接
    const filteredVariants = allVariants
      .filter((variant: any) => {
        const searchableText = variant.data?.searchableText || '';
        return searchableText !== 'Уцененные';
      })
      .map((variant: any) => ({
        ...variant,
        link: variant.link ? variant.link.split('?')[0] : '',
      }));

    return filteredVariants;
  } catch (error) {
    console.error('[EuraFlow] 第一阶段变体提取失败:', error);
    return [];
  }
}

/**
 * 合并并去重变体数据
 */
function mergeAndDeduplicateVariants(stage1Variants: any[], stage2Variants: any[]): Array<any> {
  const variantMap = new Map<string, any>();

  // 合并两阶段的变体
  const allVariants = [...stage1Variants, ...stage2Variants];

  allVariants.forEach((variant: any, index: number) => {
    const sku = variant.sku?.toString() || `variant_${index}`;

    // 跳过已存在的 SKU
    if (variantMap.has(sku)) {
      return;
    }

    // 提取规格信息
    const specifications = variant.data?.searchableText || variant.data?.title || '';

    // 清理链接
    let link = variant.link || '';
    if (link) {
      link = link.split('?')[0];
    }

    // 提取价格（与webPrice格式相同，直接解析即可）
    let priceStr = variant.data?.price || '';
    let price = 0;
    if (typeof priceStr === 'string') {
      price = parseFloat(priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
    } else {
      price = parseFloat(priceStr) || 0;
    }

    let originalPriceStr = variant.data?.originalPrice || '';
    let original_price = undefined;
    if (originalPriceStr) {
      if (typeof originalPriceStr === 'string') {
        original_price = parseFloat(originalPriceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || undefined;
      } else {
        original_price = parseFloat(originalPriceStr) || undefined;
      }
    }

    // 提取图片（优先级：data.coverImage > coverImage > image > imageUrl > data.image）
    let imageUrl = variant.data?.coverImage || variant.coverImage || variant.image || variant.imageUrl || variant.data?.image || '';

    // 调试：输出原始变体数据中的图片字段
    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 变体 [${sku}] 图片提取:`, {
        'variant.data?.coverImage': variant.data?.coverImage,
        'variant.coverImage': variant.coverImage,
        'variant.image': variant.image,
        'variant.imageUrl': variant.imageUrl,
        'variant.data?.image': variant.data?.image,
        '最终图片URL': imageUrl
      });
    }

    // 调试：输出原始变体数据中的所有 title 相关字段
    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 变体 [${sku}] title字段提取:`, {
        'variant.data?.title': variant.data?.title,
        'variant.data?.searchableText': variant.data?.searchableText,
        '原始variant对象': variant
      });
    }

    // 直接使用 variant.data?.title，不做降级（避免掩盖问题）
    const variantName = variant.data?.title || '';

    const variantData = {
      variant_id: sku,
      name: variantName,  // 使用变体的 data.title
      specifications,
      spec_details: undefined,
      image_url: imageUrl,
      link,
      price,
      original_price,
      available: variant.active !== false,
    };

    variantMap.set(sku, variantData);

    // 输出每个变体的完整数据（仅调试模式）
    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 变体 [${sku}] 最终数据（完整）:`, variantData);
    }
  });

  return Array.from(variantMap.values());
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

    // 调用 Page2 API 获取完整特征和描述
    if (productSlug) {
      if (window.EURAFLOW_DEBUG) {
        console.log(`[EuraFlow] 尝试使用 Page2 API 获取完整特征和描述（slug=${productSlug}）`);
      }

      const page2Data = await fetchCharacteristicsAndDescription(productSlug);
      if (page2Data) {
        // 合并 Page2 数据到基础数据
        if (page2Data.description) {
          baseData.description = page2Data.description;
        }
        if (page2Data.attributes && page2Data.attributes.length > 0) {
          baseData.attributes = page2Data.attributes;
        }

        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] Page2 API 成功合并数据`);
        }
      }
    }

    // ========== 获取尺寸和重量数据 ==========
    // 优先使用 OZON Seller API，降级到上品帮 DOM

    // 提取商品 SKU
    const productSku = baseData.ozon_product_id;

    // 方案 1：尝试通过 OZON Seller API 获取尺寸
    if (productSku) {
      if (window.EURAFLOW_DEBUG) {
        console.log('[EuraFlow] 尝试通过 OZON Seller API 获取尺寸和重量...');
      }

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

          if (window.EURAFLOW_DEBUG) {
            console.log('[EuraFlow] ✅ 成功从 OZON Seller API 获取 dimensions:', baseData.dimensions);
          }
        } else {
          if (window.EURAFLOW_DEBUG) {
            console.log('[EuraFlow] OZON Seller API 返回的尺寸数据不完整，尝试降级方案...');
          }
        }
      }
    }

    // 方案 2（降级）：如果 OZON API 失败，尝试从上品帮 DOM 提取
    if (!baseData.dimensions) {
      if (window.EURAFLOW_DEBUG) {
        console.log('[EuraFlow] 降级到上品帮 DOM 提取方案...');
      }

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
            if (window.EURAFLOW_DEBUG) {
              console.log('[EuraFlow] 尺寸数据为"-"，开始二次轮询（100ms × 100次，最多等待10秒）...');
            }

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

            if (window.EURAFLOW_DEBUG) {
              console.log('[EuraFlow] 二次轮询后尺寸数据仍为"-"，确认无数据');
            }
          } else {
            baseData.dimensions = {
              weight: injectedData.weight,
              height: injectedData.height,
              width: injectedData.width,
              length: injectedData.length,
            };

            if (window.EURAFLOW_DEBUG) {
              console.log('[EuraFlow] 成功从上品帮 DOM 中提取 dimensions:', baseData.dimensions);
            }
          }
        }

        // 合并 brand 数据（上品帮数据优先）
        if (injectedData && injectedData.brand) {
          baseData.brand = injectedData.brand;

          if (window.EURAFLOW_DEBUG) {
            console.log('[EuraFlow] 成功从上品帮 DOM 中提取 brand:', baseData.brand);
          }
        }

        // 合并 description 数据（如果存在）
        if (injectedData && injectedData.description) {
          baseData.description = injectedData.description;

          if (window.EURAFLOW_DEBUG) {
            console.log('[EuraFlow] 成功从上品帮 DOM 中提取 description');
          }
        }
      }
    } else {
      if (window.EURAFLOW_DEBUG) {
        console.log('[EuraFlow] 上品帮未注入 DOM，跳过上品帮数据提取');
      }
    }
    }

    // ========== 尺寸数据获取完成 ==========

    // 调试：输出提取到的基础商品数据
    if (window.EURAFLOW_DEBUG) {
      console.log('[EuraFlow] ========== 基础商品数据（从 widgetStates + Page2 提取）==========');
      console.log('[EuraFlow] category_id:', baseData.category_id);
      console.log('[EuraFlow] brand:', baseData.brand);
      console.log('[EuraFlow] description:', baseData.description ? `${baseData.description.substring(0, 80)}...` : undefined);
      console.log('[EuraFlow] dimensions:', baseData.dimensions);
      console.log('[EuraFlow] attributes:', baseData.attributes);
      console.log('[EuraFlow] videos:', baseData.videos?.length || 0);
    }

    // 提取商品ID（用于 Modal API）
    const productId = baseData.ozon_product_id;

    // 第一阶段：提取当前页面的变体列表
    const stage1Variants = extractVariantsStage1(apiResponse.widgetStates);

    if (stage1Variants.length === 0) {
      return {
        ...baseData,
        has_variants: false,
        variants: undefined,
      };
    }

    let stage2Variants: any[] = [];

    // 优先使用 Modal API 获取完整变体（上品帮方案）
    if (productId) {
      if (window.EURAFLOW_DEBUG) {
        console.log(`[EuraFlow] 尝试使用 Modal API 获取完整变体（product_id=${productId}）`);
      }

      const modalAspects = await fetchFullVariantsFromModal(productId);
      if (modalAspects && modalAspects.length > 0) {
        // 从 Modal API 提取所有变体（遍历所有 aspects）
        let allVariantLinks: any[] = [];

        for (const aspect of modalAspects) {
          const variants = (aspect?.variants || [])
            .flat(3)
            .filter((variant: any) => {
              const searchableText = variant.data?.searchableText || '';
              return searchableText !== 'Уцененные';
            })
            .map((variant: any) => ({
              ...variant,
              link: variant.link ? variant.link.split('?')[0] : '',
            }));

          allVariantLinks.push(...variants);
        }

        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] Modal API 返回 ${modalAspects.length} 个 aspect，共提取 ${allVariantLinks.length} 个变体链接`);
        }

        // ⚠️ 串行访问每个变体的详情页（避免批量并发触发限流）
        // 原方案：Promise.all 并发 50 个请求 → 极度异常 → 被限流
        // 新方案：串行执行 + Service Worker 统一限流 → 自然请求模式
        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] 开始串行采集 ${allVariantLinks.length} 个变体详情页...`);
        }

        let processedCount = 0;
        for (const variant of allVariantLinks) {
          try {
            processedCount++;
            const fullUrl = `https://www.ozon.ru${variant.link}`;

            if (window.EURAFLOW_DEBUG) {
              console.log(`[EuraFlow] 正在采集变体 ${processedCount}/${allVariantLinks.length}: ${fullUrl.substring(0, 80)}...`);
            }

            const apiResponse = await fetchProductDataFromOzonAPI(fullUrl);
            if (apiResponse && apiResponse.widgetStates) {
              // 从详情页的 aspects 中提取变体数据
              const detailAspects = extractVariantsStage1(apiResponse.widgetStates);
              stage2Variants.push(...detailAspects);
            }
          } catch (error) {
            // 单个变体失败不影响整体
            if (window.EURAFLOW_DEBUG) {
              console.warn(`[EuraFlow] 变体 ${processedCount} 采集失败:`, error);
            }
          }
        }

        if (window.EURAFLOW_DEBUG) {
          console.log(`[EuraFlow] 串行采集完成，共提取 ${stage2Variants.length} 个变体`);
        }
      } else {
        console.warn('[EuraFlow] Modal API 未返回变体');
      }
    }

    // 合并去重（每个变体使用自己的 data.title）
    const finalVariants = mergeAndDeduplicateVariants(stage1Variants, stage2Variants);

    if (window.EURAFLOW_DEBUG) {
      console.log(`[EuraFlow] 最终提取到 ${finalVariants.length} 个变体`);
    }

    return {
      ...baseData,
      has_variants: finalVariants.length > 0,
      variants: finalVariants,
    };
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
      price: 0,
      images: [],
      has_variants: false,
    };
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
