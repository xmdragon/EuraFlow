/**
 * OZON 商品上架 API
 */

import { apiClient } from '../client';
import type {
  CreateProductRequest,
  ProductImportStatusResponse,
  UploadMediaRequest,
  UploadMediaFileResponse
} from '../types/listing';

/**
 * 导入商品（完整上架流程）
 */
export const importProduct = async (
  shopId: number,
  offerId: string,
  mode: "NEW_CARD" | "FOLLOW_PDP" = "NEW_CARD",
  autoAdvance: boolean = true,
) => {
  const response = await apiClient.post("/ozon/listings/products/import", {
    shop_id: shopId,
    offer_id: offerId,
    mode,
    auto_advance: autoAdvance,
  });
  return response.data;
};

/**
 * 重新上架商品（从归档中还原）
 */
export const unarchiveProduct = async (shopId: number, productId: number) => {
  const response = await apiClient.post("/ozon/listings/products/unarchive", {
    shop_id: shopId,
    product_id: productId,
  });
  return response.data;
};

/**
 * 获取商品上架状态
 */
export const getListingStatus = async (shopId: number, offerId: string) => {
  const response = await apiClient.get(
    `/ozon/listings/products/${offerId}/status`,
    {
      params: { shop_id: shopId },
    },
  );
  return response.data;
};

/**
 * 更新商品价格
 */
export const updateListingPrice = async (
  offerId: string,
  shopId: number,
  price: string,
  oldPrice?: string,
  minPrice?: string,
  currencyCode: string = "RUB",
  autoActionEnabled: boolean = false,
) => {
  const response = await apiClient.post(
    `/ozon/listings/products/${offerId}/price`,
    {
      shop_id: shopId,
      price,
      old_price: oldPrice,
      min_price: minPrice,
      currency_code: currencyCode,
      auto_action_enabled: autoActionEnabled,
    },
  );
  return response.data;
};

/**
 * 更新商品库存
 */
export const updateListingStock = async (
  offerId: string,
  shopId: number,
  stock: number,
  warehouseId: number = 1,
  productId?: number,
) => {
  const response = await apiClient.post(
    `/ozon/listings/products/${offerId}/stock`,
    {
      shop_id: shopId,
      stock,
      warehouse_id: warehouseId,
      product_id: productId,
    },
  );
  return response.data;
};

/**
 * 导入商品图片
 */
export const importProductImages = async (
  offerId: string,
  shopId: number,
  imageUrls: string[],
  validateProperties: boolean = false,
) => {
  const response = await apiClient.post(
    `/ozon/listings/products/${offerId}/images`,
    {
      shop_id: shopId,
      image_urls: imageUrls,
      validate_properties: validateProperties,
    },
  );
  return response.data;
};

/**
 * 获取图片导入状态
 */
export const getImagesStatus = async (
  offerId: string,
  shopId: number,
  state?: string,
) => {
  const response = await apiClient.get(
    `/ozon/listings/products/${offerId}/images/status`,
    {
      params: { shop_id: shopId, state },
    },
  );
  return response.data;
};

/**
 * 获取商品导入日志
 */
export const getProductImportLogs = async (
  shopId: number,
  offerId?: string,
  state?: string,
  limit: number = 50,
) => {
  const response = await apiClient.get("/ozon/listings/logs/products", {
    params: { shop_id: shopId, offer_id: offerId, state, limit },
  });
  return response.data;
};

/**
 * 创建商品记录到数据库
 */
export const createProduct = async (data: CreateProductRequest) => {
  const response = await apiClient.post("/ozon/listings/products/create", data);
  return response.data;
};

/**
 * 查询商品导入状态
 */
export const getProductImportStatus = async (
  taskId: string,
  shopId: number
): Promise<ProductImportStatusResponse> => {
  const response = await apiClient.get(
    `/ozon/listings/products/import-status/${taskId}`,
    { params: { shop_id: shopId } }
  );
  return response.data;
};

/**
 * 上传图片/视频到图床
 */
export const uploadMedia = async (data: UploadMediaRequest) => {
  const response = await apiClient.post("/ozon/listings/media/upload", data);
  return response.data;
};

/**
 * 上传文件（multipart/form-data）
 */
export const uploadMediaFile = async (
  file: File,
  shopId: number,
  mediaType: "image" | "video" = "image",
  folder?: string
): Promise<UploadMediaFileResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("shop_id", shopId.toString());
  formData.append("media_type", mediaType);
  if (folder) {
    formData.append("folder", folder);
  }

  const response = await apiClient.post("/ozon/listings/media/upload-file", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};
