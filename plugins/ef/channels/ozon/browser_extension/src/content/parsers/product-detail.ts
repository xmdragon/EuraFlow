/**
 * OZON 商品详情页数据采集器
 *
 * 用于从商品详情页提取完整的商品数据，支持"一键跟卖"功能
 *
 * ========== 数据源说明 ==========
 *
 * 1. 基础字段（来自 widgetStates API）
 *    - title: webProductHeading
 *    - price / original_price: webPrice
 *    - images / videos: webGallery
 *    - ozon_product_id: URL 路径提取
 *    - category_id: breadCrumbs
 *    - brand: webProductHeading（优先）或 webCharacteristics（被上品帮 DOM 覆盖）
 *    - attributes: Page2 API 的 webCharacteristics（最完整）
 *
 * 2. description（来自 Page2 API）
 *    - 数据源：Page2 API 的 webDescription.richAnnotation
 *    - 调用方式：/product/{slug}/?layout_container=pdpPage2column&layout_page_index=2
 *    - 优先级：Page2 API > 上品帮 DOM（如果存在）
 *
 * 3. dimensions & brand（来自上品帮注入的 DOM）
 *    - 数据源：上品帮扩展注入的 div.text-class 元素
 *    - 等待策略：50ms 间隔轮询，最多等待 5 秒
 *    - dimensions 字段：weight, height, width, length（来自"长宽高(mm)"和"包装重量"）
 *    - brand 字段：来自"品牌"字段，"без бренда"、"非热销,无数据"、空字符串 转换为 "NO_BRAND"
 *    - 特殊处理：如果 dimensions 为"无数据"，则不合并（保持 undefined），阻止弹窗打开
 *
 * 4. variants（来自 Modal API）
 *    - 数据源：Modal API 的 webAspectsModal
 *    - 调用方式：/modal/aspectsNew?product_id={id}
 *    - 优势：一次请求获取所有变体的完整数据（图片、价格、规格、库存）
 *    - 降级方案：如果 Modal API 失败，仅使用 stage1 的变体列表
 *
 * ========== 废弃的提取逻辑（已移除）==========
 *
 * - widgetStates 中的 description 提取（成功率 < 5%）
 * - widgetStates 中的 dimensions 提取（成功率 0%）
 * - 批量详情页方案（fetchVariantDetailsInBatches）（太慢且不稳定）
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
  price: number; // 当前价格（绿色价格）
  original_price?: number; // 原价（黑色价格）

  // 品牌和条形码
  brand?: string; // 品牌
  barcode?: string; // 条形码

  // 图片和视频
  images: string[]; // 图片URL列表
  videos?: string[]; // 视频URL列表

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
    price: number;               // 绿色价格（Ozon Card价格）
    original_price?: number;     // 黑色价格（原价）
    available: boolean;          // 是否可用
    link?: string;               // 变体链接
  }>;
  has_variants: boolean;         // 是否有变体
}

// ========== 核心函数 ==========

/**
 * 通过 OZON API 获取商品数据
 */
async function fetchProductDataFromOzonAPI(productUrl: string): Promise<any | null> {
  try {
    const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      console.error(`[EuraFlow] OZON API 请求失败: ${response.status}`);
      throw new Error(`API请求失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data.widgetStates) {
      console.error('[EuraFlow] OZON API 返回数据中没有 widgetStates');
      throw new Error('widgetStates 不存在');
    }

    return data.widgetStates;
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

    if (isDebugEnabled()) {
      console.log(`[EuraFlow] 正在调用 OZON Modal API 获取完整变体: ${apiUrl}`);
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
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

    if (isDebugEnabled()) {
      console.log(`[EuraFlow] 从 Modal API 获取到 ${aspects.length} 个 aspect`);
    }

    return aspects;
  } catch (error) {
    console.error('[EuraFlow] 调用 Modal API 失败:', error);
    return null;
  }
}

/**
 * 从上品帮注入的 DOM 中提取数据
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
        // 检查是否为"无数据"
        if (value === '无数据' || value === '-' || value === '') {
          // 明确标记为不可用
          result.length = -1;
          result.width = -1;
          result.height = -1;
        } else {
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
      if (isDebugEnabled()) {
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
        if (isDebugEnabled()) {
          console.log(`[EuraFlow] 检测到上品帮注入的 DOM（尝试 ${attempts} 次）`);
        }
        resolve(true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        if (isDebugEnabled()) {
          console.log('[EuraFlow] 超时：未检测到上品帮注入的 DOM');
        }
        resolve(false);
      }
    }, 50);
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

    if (isDebugEnabled()) {
      console.log(`[EuraFlow] 正在调用 OZON Page2 API 获取特征和描述: ${apiUrl}`);
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[EuraFlow] Page2 API 请求失败: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const widgetStates = data.widgetStates || {};
    const keys = Object.keys(widgetStates);

    const result: {
      description?: string;
      attributes?: Array<{ attribute_id: number; value: string; dictionary_value_id?: number }>;
    } = {};

    // 1. 提取 webDescription
    const descriptionKey = keys.find(k => k.includes('webDescription') && k.includes('pdpPage2column'));
    if (descriptionKey) {
      const descriptionData = JSON.parse(widgetStates[descriptionKey]);
      if (descriptionData?.richAnnotation) {
        const desc = descriptionData.richAnnotation;
        result.description = desc;
        if (isDebugEnabled()) {
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

        result.attributes = attributes;

        if (isDebugEnabled()) {
          console.log(`[EuraFlow] 从 Page2 API 提取到 ${attributes.length} 个特征`);
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null;
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
 * 从 widgetStates 解析基础商品数据
 */
function parseFromWidgetStates(widgetStates: any): Omit<ProductDetailData, 'variants' | 'has_variants'> | null {
  try {
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

    // 5. 提取类目ID（breadCrumbs 或 webBreadCrumbs 或 webCurrentSeller）
    let category_id: number | undefined = undefined;
    // 优先查找 breadCrumbs（不带 web 前缀，OZON 新格式）
    const breadcrumbsKey = keys.find(k => k.includes('breadCrumb'));
    if (breadcrumbsKey) {
      const breadcrumbsData = JSON.parse(widgetStates[breadcrumbsKey]);
      // 类目ID可能在 breadcrumbs 的最后一项中
      if (breadcrumbsData?.breadcrumbs && Array.isArray(breadcrumbsData.breadcrumbs)) {
        const lastItem = breadcrumbsData.breadcrumbs[breadcrumbsData.breadcrumbs.length - 1];
        // 从 link 中提取 category ID，格式：/category/name-{id}/
        const categoryMatch = lastItem?.link?.match(/\/category\/.*-(\d+)\//);
        if (categoryMatch) {
          category_id = parseInt(categoryMatch[1]);
        }
      } else if (breadcrumbsData?.items && Array.isArray(breadcrumbsData.items)) {
        // 兼容旧格式
        const lastItem = breadcrumbsData.items[breadcrumbsData.items.length - 1];
        if (lastItem?.categoryId) {
          category_id = parseInt(lastItem.categoryId);
        }
      }
    }
    // 降级：从其他 widget 提取
    if (!category_id) {
      const sellerKey = keys.find(k => k.includes('webCurrentSeller'));
      if (sellerKey) {
        const sellerData = JSON.parse(widgetStates[sellerKey]);
        if (sellerData?.categoryId) {
          category_id = parseInt(sellerData.categoryId);
        }
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
    if (isDebugEnabled()) {
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
    // 绿色价格（Ozon Card价格）
    let priceStr = variant.data?.price || '';
    let price = 0;
    if (typeof priceStr === 'string') {
      price = parseFloat(priceStr.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
    } else {
      price = parseFloat(priceStr) || 0;
    }

    // 黑色价格（原价）
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
    if (isDebugEnabled()) {
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
    if (isDebugEnabled()) {
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
    if (isDebugEnabled()) {
      console.log(`[EuraFlow] 变体 [${sku}] 最终数据（完整）:`, variantData);
    }
  });

  return Array.from(variantMap.values());
}

/**
 * 检查是否启用调试模式
 */
function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('EURAFLOW_DEBUG') === 'true';
  } catch {
    return false;
  }
}

/**
 * 提取商品数据（主函数）
 */
export async function extractProductData(): Promise<ProductDetailData> {
  try {
    const productUrl = window.location.href;

    // 获取基础数据
    const widgetStates = await fetchProductDataFromOzonAPI(productUrl);
    const baseData = parseFromWidgetStates(widgetStates);

    if (!baseData) {
      throw new Error('解析基础数据失败');
    }

    // 提取商品 slug（用于 Page2 API）
    const slugMatch = productUrl.match(/\/product\/([^\/\?]+)/);
    const productSlug = slugMatch ? slugMatch[1] : null;

    // 调用 Page2 API 获取完整特征和描述
    if (productSlug) {
      if (isDebugEnabled()) {
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

        if (isDebugEnabled()) {
          console.log(`[EuraFlow] Page2 API 成功合并数据`);
        }
      }
    }

    // 等待并尝试从上品帮注入的 DOM 中提取数据
    if (isDebugEnabled()) {
      console.log('[EuraFlow] 等待上品帮注入 DOM 数据...');
    }

    const hasInjectedDOM = await waitForInjectedDOM();

    if (hasInjectedDOM) {
      const injectedData = extractDataFromInjectedDOM();

      if (injectedData && Object.keys(injectedData).length > 0) {
        // 合并 dimensions 数据（如果所有必需字段都存在且有效）
        if (
          injectedData.weight !== undefined &&
          injectedData.height !== undefined &&
          injectedData.width !== undefined &&
          injectedData.length !== undefined
        ) {
          // 检查是否为"无数据"（-1表示无数据）
          if (
            injectedData.weight === -1 ||
            injectedData.height === -1 ||
            injectedData.width === -1 ||
            injectedData.length === -1
          ) {
            // 不合并dimensions，保持为undefined
            baseData.dimensions = undefined;

            if (isDebugEnabled()) {
              console.log('[EuraFlow] 上品帮 DOM 中的 dimensions 为"无数据"，跳过合并');
            }
          } else {
            baseData.dimensions = {
              weight: injectedData.weight,
              height: injectedData.height,
              width: injectedData.width,
              length: injectedData.length,
            };

            if (isDebugEnabled()) {
              console.log('[EuraFlow] 成功从上品帮 DOM 中提取 dimensions:', baseData.dimensions);
            }
          }
        }

        // 合并 brand 数据（上品帮数据优先）
        if (injectedData.brand) {
          baseData.brand = injectedData.brand;

          if (isDebugEnabled()) {
            console.log('[EuraFlow] 成功从上品帮 DOM 中提取 brand:', baseData.brand);
          }
        }

        // 合并 description 数据（如果存在）
        if (injectedData.description) {
          baseData.description = injectedData.description;

          if (isDebugEnabled()) {
            console.log('[EuraFlow] 成功从上品帮 DOM 中提取 description');
          }
        }
      }
    } else {
      if (isDebugEnabled()) {
        console.log('[EuraFlow] 上品帮未注入 DOM，跳过上品帮数据提取');
      }
    }

    // 调试：输出提取到的基础商品数据
    if (isDebugEnabled()) {
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
    const stage1Variants = extractVariantsStage1(widgetStates);

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
      if (isDebugEnabled()) {
        console.log(`[EuraFlow] 尝试使用 Modal API 获取完整变体（product_id=${productId}）`);
      }

      const modalAspects = await fetchFullVariantsFromModal(productId);
      if (modalAspects && modalAspects.length > 0) {
        // 从 Modal API 提取变体（aspects 的最后一个元素包含完整变体）
        const lastAspect = modalAspects[modalAspects.length - 1];
        const modalVariants = (lastAspect?.variants || [])
          .flat(3)
          .filter((variant: any) => {
            const searchableText = variant.data?.searchableText || '';
            return searchableText !== 'Уцененные';
          })
          .map((variant: any) => ({
            ...variant,
            link: variant.link ? variant.link.split('?')[0] : '',
          }));

        stage2Variants = modalVariants;

        if (isDebugEnabled()) {
          console.log(`[EuraFlow] Modal API 成功获取 ${stage2Variants.length} 个变体`);
        }
      } else {
        console.warn('[EuraFlow] Modal API 未返回变体');
      }
    }

    // 合并去重（每个变体使用自己的 data.title）
    const finalVariants = mergeAndDeduplicateVariants(stage1Variants, stage2Variants);

    if (isDebugEnabled()) {
      console.log(`[EuraFlow] 最终提取到 ${finalVariants.length} 个变体`);
    }

    return {
      ...baseData,
      has_variants: finalVariants.length > 0,
      variants: finalVariants,
    };
  } catch (error) {
    console.error('[EuraFlow] 商品数据采集失败:', error);

    // 返回最小有效数据
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
