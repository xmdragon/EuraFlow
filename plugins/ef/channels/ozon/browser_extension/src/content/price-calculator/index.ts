/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { calculateRealPrice } from './calculator';
import { injectCompleteDisplay, updatePriceDisplay, updateFollowSellerData, updateCategoryData, updateRatingData, updateDimensionsData, updateButtonsWithConfig, updateDataLoadingStatus } from './display';
import { extractProductData, extractProductDataFast, fetchFollowSellerData } from '../parsers/product-detail';

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
   * @param prefetchedData 预加载的数据（document_start 时已开始请求）
   */
  public async init(prefetchedData?: PrefetchedData | null): Promise<void> {
    try {
      // 1. 提取商品ID
      const productId = prefetchedData?.productId || extractProductId();
      if (!productId) {
        console.error('[EuraFlow] 无法提取商品ID');
        return;
      }

      // 2. 获取预加载的 Promise
      const spbSalesPromise = prefetchedData?.spbDataPromise || chrome.runtime.sendMessage({
        type: 'GET_SPB_SALES_DATA',
        data: { productSku: productId }
      }).catch(() => ({ success: false, data: null }));

      const configPromise = prefetchedData?.configPromise || chrome.runtime.sendMessage({
        type: 'GET_CONFIG_PREFETCH'
      }).catch(() => ({ success: false, data: null }));

      // 3. 并行获取：SPB 数据 + 快速价格数据 + DOM 稳定
      // 快速价格数据只调用一次 API，不获取完整变体，速度很快
      const fastDataPromise = extractProductDataFast().catch(() => ({
        baseData: null, apiResponse: null, productSku: null, productSlug: null
      }));

      const [spbSalesResponse, fastData, _domReady] = await Promise.all([
        spbSalesPromise,
        fastDataPromise,
        this.waitForContainerReady()
      ]);

      const spbSalesData = spbSalesResponse?.success ? spbSalesResponse.data : null;
      const { baseData: fastBaseData, apiResponse, productSlug } = fastData;

      // 4. 计算真实售价（如果快速数据获取成功）
      let realPrice: number | null = null;
      let greenPrice: number | null = null;
      let blackPrice: number | null = null;
      if (fastBaseData) {
        greenPrice = (fastBaseData.cardPrice ?? 0) > 0 ? fastBaseData.cardPrice : null;
        blackPrice = (fastBaseData.price ?? 0) > 0 ? fastBaseData.price : null;
        if (blackPrice !== null) {
          const result = calculateRealPrice(greenPrice, blackPrice, '¥');
          realPrice = result.realPrice;
        }
      }

      // 5. 立即注入组件，真实售价已计算好
      await injectCompleteDisplay({
        message: realPrice !== null ? `${realPrice.toFixed(2)}¥` : '---',
        price: realPrice,
        ozonProduct: fastBaseData,
        spbSales: spbSalesData,
        euraflowConfig: null,
        productId  // SKU（从 URL 提取的商品ID）
      });

      // 6. 如果有快速价格数据，立即更新价格显示
      if (fastBaseData && blackPrice !== null) {
        updatePriceDisplay(greenPrice, blackPrice, realPrice);
      }

      // 7. 异步加载完整数据（变体、尺寸、描述等）并更新组件
      this.loadAsyncData(productId, spbSalesData, configPromise, apiResponse, productSlug, fastBaseData);

    } catch (error) {
      console.error('[EuraFlow] 初始化失败:', error);
    }
  }

  /**
   * 异步加载数据并更新组件
   * 加载顺序：
   * 1. 基础 API（价格/图片）+ 配置 - 已在 init 中完成
   * 2. 完整变体数据（Modal API）→ 显示跟卖按钮
   * 3. 其他数据（Page2 描述/特征、尺寸）→ 后台继续
   */
  private loadAsyncData(
    productId: string,
    spbSalesData: any,
    configPromise: Promise<any>,
    _apiResponse?: any,
    _productSlug?: string | null,
    fastBaseData?: any
  ): void {
    // 使用原有的完整提取逻辑（包含完整变体数据）
    const ozonDataPromise = extractProductData().catch(err => {
      console.warn('[EuraFlow] OZON 商品数据获取失败:', err);
      return null;
    });

    // 配置和OZON数据加载完成后：更新评分、尺寸、按钮
    // 价格已在 init 中通过快速 API 更新，这里不再重复更新
    Promise.all([configPromise, ozonDataPromise]).then(([configResponse, ozonProduct]) => {
      const euraflowConfig = configResponse?.success ? configResponse.data : null;

      // 使用完整数据或快速数据
      const finalOzonProduct = ozonProduct || fastBaseData;

      if (finalOzonProduct) {
        // 1. 更新评分
        const ratingData = extractRatingFromJsonLd();
        if (ratingData.rating !== null || ratingData.reviewCount !== null) {
          updateRatingData(ratingData.rating, ratingData.reviewCount);
        }

        // 2. 更新尺寸和重量
        if (finalOzonProduct.dimensions) {
          updateDimensionsData(finalOzonProduct.dimensions, spbSalesData);
        }

        // ✅ 基础数据加载完成（变体图片、规格、价格已就绪）
        // 跟卖按钮可以使用了
        updateDataLoadingStatus({ basicDataReady: true });

        // 3. 获取类目数据
        chrome.runtime.sendMessage({
          type: 'FETCH_ALL_PRODUCT_DATA',
          data: {
            url: window.location.href,
            productSku: productId,
            productDetail: finalOzonProduct,
            ratingData: ratingData,
            spbSalesData: spbSalesData,
            followSellerData: null
          }
        }).then(response => {
          if (response?.success && response.data?.spbSales) {
            updateCategoryData(response.data.spbSales);
          }
        }).catch(() => {});
      }

      // 4. 更新按钮（此时变体数据已完整）
      if (euraflowConfig || finalOzonProduct) {
        updateButtonsWithConfig(euraflowConfig, finalOzonProduct, spbSalesData);
      }

      // ✅ 所有数据加载完成（包括配置）
      // 采集按钮可以使用了
      if (finalOzonProduct && euraflowConfig) {
        updateDataLoadingStatus({ allDataReady: true });
      }
    }).catch(() => {});

    // 跟卖数据（并行加载）
    if (!spbSalesData?.competitorCount && spbSalesData?.competitorCount !== 0) {
      fetchFollowSellerData(productId).then(followSellerData => {
        const prices = followSellerData?.prices ?? [];
        updateFollowSellerData({
          ...spbSalesData,
          competitorCount: followSellerData?.count ?? 0,
          followSellerPrices: prices,
          followSellerList: followSellerData?.sellers ?? [],
          competitorMinPrice: prices.length > 0
            ? Math.min(...prices.filter((p: number) => p > 0))
            : null
        });
      }).catch(() => {});
    }
  }

  /**
   * 销毁计算器，清理资源
   */
  public destroy(): void {
    // 无需清理，因为没有观察器、定时器等
  }
}
