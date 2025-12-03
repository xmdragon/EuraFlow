/**
 * OZON 真实售价计算器 - 主类
 *
 * 在商品详情页自动计算并显示真实售价
 */

import { calculateRealPrice } from './calculator';
import { injectCompleteDisplay, updateRealPrice, updateFollowSellerData, updateCategoryData, updateButtonsWithConfig } from './display';
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

      // 3. 只等待 SPB 数据 + DOM 稳定，立即注入
      const [spbSalesResponse, _domReady] = await Promise.all([
        spbSalesPromise,
        this.waitForContainerReady()
      ]);

      const spbSalesData = spbSalesResponse?.success ? spbSalesResponse.data : null;

      // 4. 立即注入组件，真实售价显示 ---，等异步数据完整后再更新
      await injectCompleteDisplay({
        message: '---',
        price: null,
        ozonProduct: null,
        spbSales: spbSalesData,
        euraflowConfig: null
      });

      // 6. 异步加载所有其他数据并更新组件
      this.loadAsyncData(productId, spbSalesData, configPromise);

    } catch (error) {
      console.error('[EuraFlow] 初始化失败:', error);
    }
  }

  /**
   * 异步加载数据并更新组件
   */
  private loadAsyncData(
    productId: string,
    spbSalesData: any,
    configPromise: Promise<any>
  ): void {
    // 异步加载 OZON 商品数据
    const ozonDataPromise = extractProductData().catch(err => {
      console.warn('[EuraFlow] OZON 商品数据获取失败:', err);
      return null;
    });

    // 配置加载完成后更新按钮
    Promise.all([configPromise, ozonDataPromise]).then(([configResponse, ozonProduct]) => {
      const euraflowConfig = configResponse?.success ? configResponse.data : null;
      if (euraflowConfig || ozonProduct) {
        updateButtonsWithConfig(euraflowConfig, ozonProduct, spbSalesData);
      }
    }).catch(() => {});

    // OZON 数据加载完成后：更新真实售价 + 获取类目数据
    ozonDataPromise.then(ozonProduct => {
      if (ozonProduct) {
        // 从 OZON API 数据计算真实售价
        // ozonProduct.cardPrice = 绿色价格（Ozon卡价格）
        // ozonProduct.price = 黑色价格（普通价格）
        const greenPrice = (ozonProduct.cardPrice ?? 0) > 0 ? ozonProduct.cardPrice : null;
        const blackPrice = (ozonProduct.price ?? 0) > 0 ? ozonProduct.price : null;
        if (blackPrice !== null) {
          const { message } = calculateRealPrice(greenPrice, blackPrice, '¥');
          if (message) {
            updateRealPrice(message);
          }
        }

        // 获取类目数据
        chrome.runtime.sendMessage({
          type: 'FETCH_ALL_PRODUCT_DATA',
          data: {
            url: window.location.href,
            productSku: productId,
            productDetail: ozonProduct,
            ratingData: extractRatingFromJsonLd(),
            spbSalesData: spbSalesData,
            followSellerData: null
          }
        }).then(response => {
          if (response?.success && response.data?.spbSales) {
            updateCategoryData(response.data.spbSales);
          }
        }).catch(() => {});
      }
    });

    // 跟卖数据
    if (!spbSalesData?.competitorCount && spbSalesData?.competitorCount !== 0) {
      fetchFollowSellerData(productId).then(followSellerData => {
        // 无论是否有跟卖数据，都更新组件（没有跟卖时显示"无跟卖"）
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
      }).catch(() => {
        // API 失败时保持 ---，不更新（让用户知道是加载失败而非真的无跟卖）
      });
    }
  }

  /**
   * 销毁计算器，清理资源
   */
  public destroy(): void {
    // 无需清理，因为没有观察器、定时器等
  }
}
