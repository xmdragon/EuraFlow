/**
 * OZON 商品详情页数据采集器
 *
 * 用于从商品详情页提取完整的商品数据，支持"一键跟卖"功能
 * 采用 OZON API 方案，实现二阶段变体采集
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

    // 5. 提取描述（webDescription 或 webProductHeading 中的 description）
    let description: string | undefined = undefined;
    const descriptionKey = keys.find(k => k.includes('webDescription'));
    if (descriptionKey) {
      const descriptionData = JSON.parse(widgetStates[descriptionKey]);
      description = descriptionData?.description || descriptionData?.text || descriptionData?.content || undefined;
    }
    // 降级：从 heading 中提取
    if (!description && headingData?.description) {
      description = headingData.description;
    }

    // 6. 提取类目ID（webBreadCrumbs 或 webCurrentSeller）
    let category_id: number | undefined = undefined;
    const breadcrumbsKey = keys.find(k => k.includes('webBreadCrumbs'));
    if (breadcrumbsKey) {
      const breadcrumbsData = JSON.parse(widgetStates[breadcrumbsKey]);
      // 类目ID可能在 breadcrumbs 的最后一项中
      if (breadcrumbsData?.items && Array.isArray(breadcrumbsData.items)) {
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

    // 8. 提取条形码（webCharacteristics）
    let barcode: string | undefined = undefined;
    const characteristicsKey = keys.find(k => k.includes('webCharacteristics'));
    if (characteristicsKey) {
      const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
      if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
        const barcodeChar = characteristicsData.characteristics.find(
          (char: any) => char.title === 'Штрихкод' || char.key === 'barcode'
        );
        if (barcodeChar?.values && barcodeChar.values.length > 0) {
          barcode = barcodeChar.values[0].text || barcodeChar.values[0].value;
        }
      }
    }

    // 9. 提取尺寸和重量（webCharacteristics）
    let dimensions: ProductDetailData['dimensions'] | undefined = undefined;
    if (characteristicsKey) {
      const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
      if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
        const weightChar = characteristicsData.characteristics.find(
          (char: any) => char.title === 'Вес' || char.key === 'weight'
        );
        const heightChar = characteristicsData.characteristics.find(
          (char: any) => char.title === 'Высота' || char.key === 'height'
        );
        const widthChar = characteristicsData.characteristics.find(
          (char: any) => char.title === 'Ширина' || char.key === 'width'
        );
        const lengthChar = characteristicsData.characteristics.find(
          (char: any) => char.title === 'Длина' || char.key === 'length'
        );

        if (weightChar || heightChar || widthChar || lengthChar) {
          dimensions = {
            weight: weightChar?.values?.[0]?.value ? parseFloat(weightChar.values[0].value) : 0,
            height: heightChar?.values?.[0]?.value ? parseFloat(heightChar.values[0].value) : 0,
            width: widthChar?.values?.[0]?.value ? parseFloat(widthChar.values[0].value) : 0,
            length: lengthChar?.values?.[0]?.value ? parseFloat(lengthChar.values[0].value) : 0,
          };
        }
      }
    }

    // 10. 提取类目特征（webCharacteristics）
    const attributes: ProductDetailData['attributes'] = [];
    if (characteristicsKey) {
      const characteristicsData = JSON.parse(widgetStates[characteristicsKey]);
      if (characteristicsData?.characteristics && Array.isArray(characteristicsData.characteristics)) {
        characteristicsData.characteristics.forEach((char: any) => {
          // 跳过已经提取的字段（品牌、条形码、尺寸）
          if (['Бренд', 'Штрихкод', 'Вес', 'Высота', 'Ширина', 'Длина'].includes(char.title)) {
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
        description: description ? description.substring(0, 50) + '...' : undefined,
        category_id,
        brand,
        barcode,
        dimensions,
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
      description,
      category_id,
      brand,
      barcode,
      dimensions,
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
 * 第二阶段：批量获取每个变体的详情页数据（分批处理）
 */
async function fetchVariantDetailsInBatches(variantLinks: string[], batchSize: number = 50): Promise<any[]> {
  const allDetailsVariants: any[] = [];
  const batches = [];

  // 分批
  for (let i = 0; i < variantLinks.length; i += batchSize) {
    batches.push(variantLinks.slice(i, i + batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    const batchPromises = batch.map(async (link) => {
      try {
        const fullUrl = `https://www.ozon.ru${link}`;
        const widgetStates = await fetchProductDataFromOzonAPI(fullUrl);
        if (widgetStates) {
          return extractVariantsStage2(widgetStates);
        }
        return [];
      } catch (error) {
        // 单个变体失败不影响整体
        return [];
      }
    });

    const batchResults = await Promise.all(batchPromises);
    const batchVariants = batchResults.flat();
    allDetailsVariants.push(...batchVariants);
  }

  return allDetailsVariants;
}

/**
 * 第二阶段：从详情页的 webAspects 提取变体
 */
function extractVariantsStage2(widgetStates: any): any[] {
  try {
    const keys = Object.keys(widgetStates);
    const aspectsKey = keys.find(k => k.includes('webAspects'));

    if (!aspectsKey) {
      return [];
    }

    const aspectsData = JSON.parse(widgetStates[aspectsKey]);
    const aspects = aspectsData?.aspects;

    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      return [];
    }

    // 从最后一个 aspect 提取 variants（参考上品帮逻辑）
    const lastAspect = aspects[aspects.length - 1];
    const variants = lastAspect?.variants || [];

    return variants
      .flat(3)
      .filter((v: any) => v.data?.searchableText !== 'Уцененные')
      .map((v: any) => ({
        ...v,
        link: v.link ? v.link.split('?')[0] : '',
      }));
  } catch (error) {
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
      console.log(`[EuraFlow] 变体 [${sku}] 最终数据:`, {
        SKU: sku,
        规格: specifications,
        价格: `${price.toFixed(2)} ¥`,
        图片: imageUrl,
        链接: link,
        可用: variantData.available,
      });
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

    // 第一阶段：提取变体列表
    const stage1Variants = extractVariantsStage1(widgetStates);

    if (stage1Variants.length === 0) {
      return {
        ...baseData,
        has_variants: false,
        variants: undefined,
      };
    }

    // 第二阶段：批量获取变体详情
    const variantLinks = stage1Variants
      .map(v => v.link)
      .filter(link => link && link.length > 0);

    const stage2Variants = await fetchVariantDetailsInBatches(variantLinks);

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
