/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { calculateRealPrice } from './calculator';
import { injectCompleteDisplay } from './display';
import { extractProductData, fetchFollowSellerData } from '../parsers/product-detail';

/**
 * 预加载数据类型
 */
interface PrefetchedData {
  productId: string;
  spbDataPromise: Promise<any>;
  configPromise: Promise<any>;
}

/**
 * 提取商品ID从URL（不使用 DOM fallback）
 */
function extractProductId(): string | null {
  const url = window.location.href;
  const pathname = window.location.pathname;

  // 方法1: URL末尾带斜杠或问号（带商品名称的格式：/product/xxx-123456/）
  let match = url.match(/-(\d+)\/(\?|$)/);
  if (match) return match[1];

  // 方法2: URL末尾不带斜杠（带商品名称的格式：/product/xxx-123456）
  match = url.match(/-(\d+)$/);
  if (match) return match[1];

  // 方法3: 纯数字格式（/product/123456/ 或 /product/123456?...）
  if (pathname.includes('/product/')) {
    // 先尝试纯数字格式：/product/123456/
    const pureNumMatch = pathname.match(/\/product\/(\d{6,})\/?$/);
    if (pureNumMatch) return pureNumMatch[1];

    // 再尝试带商品名称的格式
    const pathPart = pathname.split('/product/')[1]?.split('?')[0]?.replace(/\/$/, '');
    if (pathPart) {
      const lastDashIndex = pathPart.lastIndexOf('-');
      if (lastDashIndex !== -1) {
        const sku = pathPart.substring(lastDashIndex + 1);
        if (/^\d{6,}$/.test(sku)) {
          return sku;
        }
      }
    }
  }

  // 不使用 DOM fallback，遇到新 URL 格式时报错，由开发者添加新的正则
  console.error('[EuraFlow] 无法从URL提取商品ID，请反馈此URL格式:', url);
  return null;
}

/**
 * 从页面 JSON-LD 结构化数据提取评分和评价数
 * OZON 页面包含 aggregateRating 数据
 */
function extractRatingFromJsonLd(): { rating: number | null; reviewCount: number | null } {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '');

        // 检查是否有 aggregateRating
        if (data.aggregateRating) {
          const rating = parseFloat(data.aggregateRating.ratingValue);
          const reviewCount = parseInt(data.aggregateRating.reviewCount, 10);

          return {
            rating: isNaN(rating) ? null : rating,
            reviewCount: isNaN(reviewCount) ? null : reviewCount
          };
        }

        // 有些页面可能是数组格式
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.aggregateRating) {
              const rating = parseFloat(item.aggregateRating.ratingValue);
              const reviewCount = parseInt(item.aggregateRating.reviewCount, 10);

              return {
                rating: isNaN(rating) ? null : rating,
                reviewCount: isNaN(reviewCount) ? null : reviewCount
              };
            }
          }
        }
      } catch {
        // 解析单个 script 失败，继续尝试下一个
      }
    }

    return { rating: null, reviewCount: null };
  } catch (error) {
    console.warn('[EuraFlow] 从 JSON-LD 提取评分失败:', error);
    return { rating: null, reviewCount: null };
  }
}

/**
 * 真实售价计算器主类
 */
export class RealPriceCalculator {
  /**
   * 等待 OZON 页面 DOM 稳定（Vue hydration 完成）
   * 检测 webSale 组件内的配送信息是否加载完成
   * 检测逻辑：pdp_fa 容器内容不是 SVG 图标时，说明内容已加载
   */
  private async waitForContainerReady(): Promise<boolean> {
    const MAX_WAIT_TIME = 20000; // 最多等待20秒
    const CHECK_INTERVAL = 200;  // 每200ms检查一次

    return new Promise((resolve) => {
      const startTime = Date.now();

      // 检查关键元素是否已加载（Vue hydration 完成的标志）
      const checkKeyElements = (): boolean => {
        const webSaleWidget = document.querySelector('div[data-widget="webSale"]');
        if (!webSaleWidget) return false;

        const deliveryContainer = webSaleWidget.querySelector('div[class*="pdp_fa"]');
        if (!deliveryContainer) return false;

        const hasSvg = deliveryContainer.querySelector('svg');
        return !hasSvg;
      };

      const checkReady = () => {
        const elapsed = Date.now() - startTime;

        if (elapsed > MAX_WAIT_TIME) {
          resolve(true);
          return;
        }

        if (checkKeyElements()) {
          setTimeout(() => resolve(true), 200);
        } else {
          setTimeout(checkReady, CHECK_INTERVAL);
        }
      };

      checkReady();
    });
  }

  /**
   * 初始化计算器
   * @param prefetchedData 预加载的数据（document_start 时已开始请求，不需要 Cookie）
   */
  public async init(prefetchedData?: PrefetchedData | null): Promise<void> {
    try {
      // 1. 提取商品ID（使用预加载的或重新提取）
      const productId = prefetchedData?.productId || extractProductId();
      if (!productId) {
        console.error('[EuraFlow] 无法提取商品ID');
        return;
      }

      // 2. 使用预加载的 Promise 或新建
      const spbSalesPromise = prefetchedData?.spbDataPromise || chrome.runtime.sendMessage({
        type: 'GET_SPB_SALES_DATA',
        data: { productSku: productId }
      }).catch(err => {
        console.warn('[EuraFlow] 上品帮销售数据获取失败:', err.message);
        return { success: false, data: null };
      });

      const configPromise = prefetchedData?.configPromise || chrome.runtime.sendMessage({
        type: 'GET_CONFIG_PREFETCH'
      }).catch(err => {
        console.warn('[EuraFlow] 配置预加载失败:', err.message);
        return { success: false, data: null };
      });

      // 3. 【需要 Cookie/DOM】调用 OZON API 获取商品数据（包含价格）
      let productDetail = null;
      try {
        productDetail = await extractProductData();
      } catch (error: any) {
        console.error('[EuraFlow] 商品详情提取失败:', error);
        return;
      }

      // 4. 从 OZON API 数据提取价格（不使用 DOM fallback）
      if (!productDetail || (productDetail.price <= 0 && !productDetail.original_price)) {
        console.error('[EuraFlow] OZON API 未返回价格数据');
        return;
      }

      // price = 绿色价格(cardPrice)，original_price = 黑色价格(price)
      const greenPrice = productDetail.price > 0 ? productDetail.price : null;
      const blackPrice = productDetail.original_price || null;

      if (blackPrice === null && greenPrice === null) {
        console.error('[EuraFlow] 未找到价格');
        return;
      }

      const { message, price } = calculateRealPrice(greenPrice, blackPrice, '¥');
      if (!message) {
        console.warn('[EuraFlow] 无法计算真实售价');
        return;
      }

      // 5. 等待预加载的 Promise 完成
      const [spbSalesResponse, configResponse] = await Promise.all([spbSalesPromise, configPromise]);
      const spbSalesData = spbSalesResponse?.success ? spbSalesResponse.data : null;
      const euraflowConfig = configResponse?.success ? configResponse.data : null;

      // 6. 如果上品帮没有跟卖数据，通过页面上下文获取
      let followSellerData: { count: number; skus: string[]; prices: number[]; sellers: any[] } | null = null;
      if (!spbSalesData?.competitorCount && spbSalesData?.competitorCount !== 0) {
        followSellerData = await fetchFollowSellerData(productId);
      }

      // 7. 发送数据到 background 进行后续处理（类目查询等）
      const ratingData = extractRatingFromJsonLd();

      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_ALL_PRODUCT_DATA',
        data: {
          url: window.location.href,
          productSku: productId,
          productDetail: productDetail,
          ratingData: ratingData,
          spbSalesData: spbSalesData,
          followSellerData: followSellerData
        }
      });

      if (!response.success) {
        console.error('[EuraFlow] 数据获取失败:', response.error);
        return;
      }

      // 8. 等待 DOM 稳定后注入 UI
      await this.waitForContainerReady();

      const { ozonProduct, spbSales } = response.data;

      // 9. 一次性注入完整组件
      await injectCompleteDisplay({
        message,
        price,
        ozonProduct,
        spbSales,
        euraflowConfig
      });
    } catch (error) {
      console.error('[EuraFlow] 初始化失败:', error);
    }
  }

  /**
   * 销毁计算器，清理资源
   */
  public destroy(): void {
    // 无需清理，因为没有观察器、定时器等
  }
}
