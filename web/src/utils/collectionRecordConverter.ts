/**
 * 采集记录转换工具
 * 将采集记录的数据格式转换为商品表单需要的格式
 */
import type { FormData } from '@/services/draftTemplateApi';
import type { ProductVariant, VariantDimension } from '@/hooks/useVariantManager';
import { loggers } from '@/utils/logger';

/**
 * 图片格式统一处理
 * 支持多种图片格式：
 * 1. string[] - 直接使用
 * 2. {url: string, is_primary?: boolean}[] - 提取 url
 * 3. 单个 string - 转换为数组
 */
export function normalizeImages(images: unknown): string[] {
  if (!images) {
    return [];
  }

  // 如果是字符串数组，直接返回
  if (Array.isArray(images) && images.every(img => typeof img === 'string')) {
    return images.filter(Boolean);
  }

  // 如果是对象数组，提取 url 字段
  if (Array.isArray(images)) {
    return images
      .map((img: unknown) => {
        if (typeof img === 'string') {
          return img;
        }
        if (img && typeof img === 'object') {
          const imgObj = img as { url?: string; original_url?: string };
          return imgObj.url || imgObj.original_url || '';
        }
        return '';
      })
      .filter(Boolean);
  }

  // 如果是单个字符串，转换为数组
  if (typeof images === 'string') {
    return [images];
  }

  return [];
}

/**
 * 视频格式统一处理
 * 支持多种视频格式：
 * 1. {url: string, cover?: string, is_cover?: boolean}[] - 标准格式
 * 2. string[] - 转换为标准格式
 */
export function normalizeVideos(videos: unknown): Array<{url: string; cover?: string; is_cover?: boolean}> {
  if (!videos || !Array.isArray(videos)) {
    return [];
  }

  return videos
    .map((video: unknown) => {
      if (typeof video === 'string') {
        return { url: video, is_cover: false };
      }
      if (video && typeof video === 'object') {
        const videoObj = video as { url?: string; cover?: string; is_cover?: boolean };
        if (videoObj.url) {
          return {
            url: videoObj.url,
            cover: videoObj.cover,
            is_cover: videoObj.is_cover || false,
          };
        }
      }
      return null;
    })
    .filter(Boolean) as Array<{url: string; cover?: string; is_cover?: boolean}>;
}

/**
 * 变体规格字符串解析（降级方案）
 * 尝试从 "белый / XL" 或 "颜色: 红色, 尺寸: L" 格式中提取
 * 注意：如果格式是 "白色 / XL"（无维度名称），则返回空对象
 */
function parseSpecifications(specifications: string): Record<string, string> {
  if (!specifications) {
    return {};
  }

  const result: Record<string, string> = {};

  // 尝试解析 "key: value, key: value" 格式
  const pairs = specifications.split(',').map(s => s.trim());

  for (const pair of pairs) {
    const [key, value] = pair.split(':').map(s => s.trim());
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 生成维度名称的唯一负数 ID
 * 使用名称的字符码和，确保同名维度生成相同 ID
 */
function generateDimensionId(name: string): number {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return -Math.abs(hash + 10000); // 确保是负数且唯一
}

/**
 * OZON 属性 ID 常量
 * attribute_id=2622298 是 "Тип"（类型）属性，包含商品的类目名称（俄文）
 */
const OZON_TYPE_ATTRIBUTE_ID = 2622298;

/**
 * 从采集记录的 attributes 中提取 "Тип"（类型）属性值
 * 该值是俄文类目名称，可用于匹配本地类目表的 name_ru 字段
 *
 * @param productData 采集记录的 product_data
 * @returns 俄文类目名称，如果不存在则返回 undefined
 */
export function extractCategoryTypeFromAttributes(productData: Record<string, unknown>): string | undefined {
  const attributes = productData.attributes as Array<{ attribute_id: number; value: string }> | undefined;

  if (!attributes || !Array.isArray(attributes)) {
    return undefined;
  }

  const typeAttr = attributes.find(attr => attr.attribute_id === OZON_TYPE_ATTRIBUTE_ID);
  return typeAttr?.value;
}

/**
 * 将采集记录数据转换为商品表单数据
 */
export function convertCollectionRecordToFormData(
  record: Record<string, unknown>,
  shopId: number
): FormData {
  const productData = (record.product_data as Record<string, unknown>) || {};

  // 提取 "Тип" 属性值（俄文类目名称）用于自动匹配类目
  const categoryTypeRu = extractCategoryTypeFromAttributes(productData);

  loggers.ozon.info('[CollectionRecord] 转换采集记录数据', {
    recordId: record.id,
    hasVariants: !!productData.variants,
    variantsCount: Array.isArray(productData.variants) ? productData.variants.length : 0,
    hasImages: !!productData.images,
    imagesCount: Array.isArray(productData.images) ? productData.images.length : 0,
    categoryTypeRu,  // 俄文类目名称，用于自动匹配
  });

  // 处理主商品图片
  const mainImages = normalizeImages(productData.images);

  // 处理主商品视频
  const mainVideos = normalizeVideos(productData.videos);

  // 处理变体数据
  let variantDimensions: VariantDimension[] = [];
  let variants: ProductVariant[] = [];

  if (productData.variants && Array.isArray(productData.variants) && productData.variants.length > 0) {
    // 从第一个变体提取维度信息（假设所有变体的维度相同）
    const firstVariant = productData.variants[0] as Record<string, unknown>;
    const specDetails = (firstVariant.spec_details as Record<string, string>) || parseSpecifications((firstVariant.specifications as string) || '');

    // 提取变体维度（使用负数 ID，这样 autoAddVariantDimensions 会保留它们）
    const dimensionKeys = Object.keys(specDetails);

    // 为每个维度生成一个稳定的负数 ID（基于维度名称）
    const dimensionIdMap: Record<string, number> = {};
    dimensionKeys.forEach((key) => {
      dimensionIdMap[key] = generateDimensionId(key);
    });

    variantDimensions = dimensionKeys.map((key) => ({
      // 使用负数 ID（自定义字段），这样类目切换时不会被移除
      attribute_id: dimensionIdMap[key],
      name: key, // 俄语维度名称（如 "Цвет"、"Размер"）
      attribute_type: 'String',
      // 标记为采集记录来源的维度
      original_field_key: `collection_dim_${key}`,
    }));

    // 转换变体列表
    variants = productData.variants.map((variant: unknown, index: number) => {
      const v = variant as Record<string, unknown>;
      const variantImages = normalizeImages(v.images);
      const variantVideos = normalizeVideos(v.videos);
      const variantSpecDetails = (v.spec_details as Record<string, string>) || parseSpecifications((v.specifications as string) || '');

      // 构建维度值映射（使用相同的负数 ID）
      const dimensionValues: Record<number, unknown> = {};
      dimensionKeys.forEach((key) => {
        dimensionValues[dimensionIdMap[key]] = variantSpecDetails[key] || '';
      });

      // 提取变体主图
      let variantMainImage = (v.image_url as string) || '';
      if (!variantMainImage && variantImages.length > 0) {
        variantMainImage = variantImages[0];
      }

      return {
        id: `variant_${index + 1}`,
        offer_id: (v.variant_id as string) || `${record.id}_variant_${index + 1}`,
        barcode: (v.barcode as string) || '',
        price: (v.price as number) || (productData.price as number) || 0,
        old_price: (v.original_price as number) || (productData.old_price as number),
        // 变体图片：优先使用变体自己的图片，否则使用主商品图片
        images: variantImages.length > 0 ? variantImages : (variantMainImage ? [variantMainImage, ...mainImages] : mainImages),
        videos: variantVideos,
        dimension_values: dimensionValues,
      };
    });

    loggers.ozon.info('[CollectionRecord] 变体数据转换完成', {
      dimensionsCount: variantDimensions.length,
      variantsCount: variants.length,
      dimensionKeys,
      dimensionIdMap,
      sampleDimension: variantDimensions[0],
      sampleVariant: variants[0],
    });
  }

  // 构建表单数据
  const dimensions = productData.dimensions as { width?: number; height?: number; length?: number; depth?: number; weight?: number } | undefined;
  const formData: FormData = {
    shop_id: shopId,
    // category_id 需要用户手动选择或从采集记录中提取
    title: (productData.title as string) || (productData.title_cn as string) || '',
    description: (productData.description as string) || '',
    offer_id: `collection_${record.id}_${Date.now()}`, // 生成唯一的 offer_id
    price: productData.price as number | undefined,
    old_price: productData.old_price as number | undefined,
    width: dimensions?.width,
    height: dimensions?.height,
    depth: dimensions?.length || dimensions?.depth,
    weight: dimensions?.weight,
    dimension_unit: 'mm',
    weight_unit: 'g',
    images: mainImages,
    videos: mainVideos,
    variantDimensions,
    variants,
    attributes: {
      // 保存原始采集记录ID，方便追溯
      _collection_record_id: record.id,
      _source_url: record.source_url,
      // 俄文类目名称，用于自动匹配类目
      _category_type_ru: categoryTypeRu,
    },
  };

  return formData;
}
