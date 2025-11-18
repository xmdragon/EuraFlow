import type { ProductData } from '../../shared/types';

/**
 * 数据融合引擎（重构版）
 *
 * 功能：直接从OZON商品卡片提取原生数据（SKU、标题、价格、图片等）
 * 不再依赖上品帮DOM注入，销售数据通过API获取
 */
export class DataFusionEngine {
  constructor() {
    // 不再需要parser参数
  }

  /**
   * 立即提取OZON原生数据（重构版）
   *
   * 功能：从商品卡片中提取OZON原生数据
   * - SKU（从URL）
   * - 标题（俄文）
   * - 当前价格
   * - 原价
   * - 商品链接
   * - 图片URL
   * - 评分
   * - 评论数
   *
   * 注意：不再提取上品帮数据（佣金、销量等），这些数据将通过API获取
   */
  async fuseProductDataImmediate(cardElement: HTMLElement): Promise<ProductData> {
    const product: Partial<ProductData> = {};

    // 1. 提取SKU（从商品链接）
    const link = cardElement.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    if (link && link.href) {
      // URL格式: https://www.ozon.ru/product/name-3083658390/
      const urlParts = link.href.split('/product/');
      if (urlParts.length > 1) {
        const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
        const lastDashIndex = pathPart.lastIndexOf('-');
        if (lastDashIndex !== -1) {
          const sku = pathPart.substring(lastDashIndex + 1);
          if (/^\d{6,}$/.test(sku)) {
            product.product_id = sku;
          }
        }
      }

      // 商品链接
      product.ozon_link = link.href;
    }

    // 2. 提取标题（俄文）
    const titleElement = cardElement.querySelector('a[href*="/product/"] span.tsBody500Medium');
    if (titleElement) {
      product.product_name_ru = titleElement.textContent?.trim();
    }

    // 3. 提取当前价格（不带删除线）
    const currentPriceElement = cardElement.querySelector('span.tsHeadline500Medium:not([class*="strikethrough"])');
    if (currentPriceElement) {
      const priceText = currentPriceElement.textContent?.replace(/[₽¥\s]/g, '').trim();
      if (priceText) {
        product.current_price = parseFloat(priceText);
      }
    }

    // 4. 提取原价（带删除线）
    const originalPriceElement = cardElement.querySelector('span.tsBodyControl400Small.c35_3_11-b');
    if (originalPriceElement) {
      const priceText = originalPriceElement.textContent?.replace(/[₽¥\s]/g, '').trim();
      if (priceText) {
        product.original_price = parseFloat(priceText);
      }
    }

    // 5. 提取评分（带 --textPremium 样式）
    const ratingSpans = cardElement.querySelectorAll('span[style*="--textPremium"]');
    for (const span of Array.from(ratingSpans)) {
      const text = span.textContent?.trim();
      if (text && /^\d+(\.\d+)?$/.test(text)) {
        product.rating = parseFloat(text);
        break;
      }
    }

    // 6. 提取评论数（带 --textSecondary 样式，纯数字，无小数点）
    const reviewSpans = cardElement.querySelectorAll('span[style*="--textSecondary"]');
    for (const span of Array.from(reviewSpans)) {
      const text = span.textContent?.trim();
      if (text && !text.includes('.')) {
        const num = text.replace(/[^\d]/g, '');
        if (num) {
          product.review_count = parseInt(num, 10);
          break;
        }
      }
    }

    // 7. 提取图片URL
    const imageElement = cardElement.querySelector('img:not(.ozon-bang-img)') as HTMLImageElement;
    if (imageElement) {
      product.image_url = imageElement.src;
    }

    return product as ProductData;
  }

  /**
   * 获取融合统计（已废弃，保留用于兼容）
   * @deprecated 不再使用parser，返回空统计
   */
  getFusionStats(): { spbFields: number; totalFields: number; fusedFields: string[] } {
    return {
      spbFields: 0,
      totalFields: 0,
      fusedFields: []
    };
  }
}
