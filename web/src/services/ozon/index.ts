/**
 * OZON 服务统一导出
 *
 * 使用示例：
 * import { getShops, createShop } from '@/services/ozon';
 * import type { Product, Order } from '@/services/ozon';
 */

// ==================== API 导出 ====================

// 客户端
export { apiClient } from './client';

// 店铺
export * from './api/shops';

// 仓库
export * from './api/warehouses';

// 统计
export * from './api/statistics';

// 聊天
export * from './api/chats';

// 商品
export * from './api/products';

// 订单
export * from './api/orders';

// 发货单
export * from './api/postings';

// 打包发货
export * from './api/packing';

// 报表
export * from './api/reports';

// 财务
export * from './api/finance';

// 类目
export * from './api/categories';

// 商品上架
export * from './api/listings';

// Webhook
export * from './api/webhooks';

// 同步日志
export * from './api/sync';

// 全局设置
export * from './api/settings';

// 类目佣金
export * from './api/commissions';

// 促销活动
export * from './api/promotions';

// 取消和退货
export * from './api/cancellations';

// 库存管理
export * from './api/stock';

// ==================== 类型导出 ====================

// 店铺类型
export type { ShopData, ApiCredentials } from './types/shop';

// 统计类型
export type { Statistics, DailyPostingStats, DailyRevenueStats } from './types/statistics';

// 聊天类型
export type { OzonChat, OzonChatMessage, ChatStats } from './types/chat';

// 商品类型
export type {
  Product,
  ProductFilter,
  PriceUpdate,
  StockUpdate,
  ProductAttributes,
  ProductImages,
  PurchasePriceHistory,
  PurchasePriceHistoryResponse
} from './types/product';

// 订单类型
export type {
  Order,
  OrderItem,
  Posting,
  PostingWithOrder,
  OrderFilter,
  ShipmentRequest,
  ShipmentPackage,
  DiscardOrderRequest,
  SplitPostingProduct,
  SplitPostingItem,
  SplitPostingRequest,
  SplitPostingResponse
} from './types/order';

// 发货单类型
export type {
  PrepareStockRequest,
  UpdateBusinessInfoRequest,
  SubmitDomesticTrackingRequest,
  UpdateDomesticTrackingRequest,
  OrderExtraInfo
} from './types/posting';

// 打包发货类型
export type {
  BatchPrintResult,
  FailedPosting,
  PackingOrdersParams,
  PackingStatsParams,
  PackingStatsData
} from './types/packing';

// 财务类型
export type {
  FinanceTransaction,
  FinanceTransactionsResponse,
  FinanceTransactionsSummary,
  FinanceTransactionsFilter,
  FinanceTransactionDailySummary,
  FinanceTransactionsDailySummaryResponse
} from './types/finance';

// 类目类型
export type {
  Category,
  CategoryAttribute,
  DictionaryValue,
  BatchSyncCategoryAttributesOptions,
  SyncSingleCategoryAttributesOptions
} from './types/category';

// 商品上架类型
export type {
  ListingStatus,
  MediaImportLog,
  ProductImportLog,
  VideoInfo,
  CreateProductRequest,
  ProductImportStatusResponse,
  UploadMediaRequest,
  UploadMediaFileResponse
} from './types/listing';

// Webhook 类型
export type { WebhookConfig, WebhookEvent } from './types/webhook';

// 同步日志类型
export type { SyncLog } from './types/sync';

// 促销活动类型
export type { PromotionAction } from './types/promotion';

// 取消和退货类型
export type {
  Cancellation,
  Return,
  CancellationListResponse,
  ReturnListResponse,
  CancellationFilter,
  ReturnFilter
} from './types/cancellation';

// 库存管理类型
export type {
  StockItem,
  AddStockRequest,
  UpdateStockRequest,
  StockCheckItem
} from './types/stock';
