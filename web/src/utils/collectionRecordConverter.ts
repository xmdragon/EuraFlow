/**
 * 采集记录转换工具
 * 将采集记录的数据格式转换为商品表单需要的格式
 */
import type { FormData } from '@/services/draftTemplateApi';
import type { ProductVariant } from '@/hooks/useVariantManager';
import { loggers } from '@/utils/logger';

/**
 * 图片格式统一处理
 * 支持多种图片格式：
 * 1. string[] - 直接使用
 * 2. {url: string, is_primary?: boolean}[] - 提取 url
 * 3. 单个 string - 转换为数组
 */
export function normalizeImages(images: any): string[] {
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
      .map((img: any) => {
        if (typeof img === 'string') {
          return img;
        }
        if (img && typeof img === 'object') {
          return img.url || img.original_url || '';
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
export function normalizeVideos(videos: any): Array<{url: string; cover?: string; is_cover?: boolean}> {
  if (!videos || !Array.isArray(videos)) {
    return [];
  }

  return videos
    .map((video: any) => {
      if (typeof video === 'string') {
        return { url: video, is_cover: false };
      }
      if (video && typeof video === 'object' && video.url) {
        return {
          url: video.url,
          cover: video.cover,
          is_cover: video.is_cover || false,
        };
      }
      return null;
    })
    .filter(Boolean) as Array<{url: string; cover?: string; is_cover?: boolean}>;
}

/**
 * 变体规格字符串解析
 * 示例："颜色: 红色, 尺寸: L" -> {colorAttr: "红色", sizeAttr: "L"}
 */
function parseSpecifications(specifications: string): Record<string, string> {
  if (!specifications) {
    return {};
  }

  const result: Record<string, string> = {};
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
 * 将采集记录数据转换为商品表单数据
 */
export function convertCollectionRecordToFormData(
  record: any,
  shopId: number
): FormData {
  const productData = record.product_data || {};

  loggers.ozon.info('[CollectionRecord] 转换采集记录数据', {
    recordId: record.id,
    hasVariants: !!productData.variants,
    variantsCount: productData.variants?.length || 0,
    hasImages: !!productData.images,
    imagesCount: productData.images?.length || 0,
  });

  // 处理主商品图片
  const mainImages = normalizeImages(productData.images);

  // 处理主商品视频
  const mainVideos = normalizeVideos(productData.videos);

  // 处理变体数据
  let variantDimensions: any[] = [];
  let variants: ProductVariant[] = [];

  if (productData.variants && productData.variants.length > 0) {
    // 从第一个变体提取维度信息（假设所有变体的维度相同）
    const firstVariant = productData.variants[0];
    const specDetails = firstVariant.spec_details || parseSpecifications(firstVariant.specifications || '');

    // 提取变体维度
    const dimensionKeys = Object.keys(specDetails);
    variantDimensions = dimensionKeys.map((key, index) => ({
      // 注意：这里的 attribute_id 是临时生成的，实际应该从类目属性中匹配
      attribute_id: 90000 + index, // 临时ID，需要后续匹配
      name: key,
      is_required: true,
      is_aspect: true,
      dictionary_id: null,
    }));

    // 转换变体列表
    variants = productData.variants.map((variant: any, index: number) => {
      const variantImages = normalizeImages(variant.images);
      const variantVideos = normalizeVideos(variant.videos);
      const specDetails = variant.spec_details || parseSpecifications(variant.specifications || '');

      // 构建维度值映射
      const dimensionValues: Record<number, any> = {};
      dimensionKeys.forEach((key, idx) => {
        dimensionValues[90000 + idx] = specDetails[key];
      });

      return {
        id: `variant_${index + 1}`,
        offer_id: variant.variant_id || `${record.id}_variant_${index + 1}`,
        barcode: variant.barcode || '',
        price: variant.price || productData.price || 0,
        old_price: variant.original_price || productData.old_price,
        images: variantImages.length > 0 ? variantImages : mainImages, // 如果变体没有图片，使用主商品图片
        videos: variantVideos,
        dimension_values: dimensionValues,
      };
    });

    loggers.ozon.info('[CollectionRecord] 变体数据转换完成', {
      dimensionsCount: variantDimensions.length,
      variantsCount: variants.length,
      sampleDimension: variantDimensions[0],
      sampleVariant: variants[0],
    });
  }

  // 构建表单数据
  const formData: FormData = {
    shop_id: shopId,
    // category_id 需要用户手动选择或从采集记录中提取
    title: productData.title || productData.title_cn || '',
    description: productData.description || '',
    offer_id: `collection_${record.id}_${Date.now()}`, // 生成唯一的 offer_id
    price: productData.price,
    old_price: productData.old_price,
    width: productData.dimensions?.width,
    height: productData.dimensions?.height,
    depth: productData.dimensions?.length || productData.dimensions?.depth,
    weight: productData.dimensions?.weight,
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
    },
  };

  return formData;
}
