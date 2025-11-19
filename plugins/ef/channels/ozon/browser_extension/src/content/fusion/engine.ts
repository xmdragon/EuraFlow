import type { ProductData } from '../../shared/types';

export class DataFusionEngine {
  constructor() {}

  async fuseProductDataImmediate(cardElement: HTMLElement): Promise<ProductData> {
    const product: Partial<ProductData> = {};

    const link = cardElement.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    if (link && link.href) {
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
      product.ozon_link = link.href;
    }

    const titleElement = cardElement.querySelector('a[href*="/product/"] span.tsBody500Medium');
    if (titleElement) {
      product.product_name_ru = titleElement.textContent?.trim();
    }

    const currentPriceElement = cardElement.querySelector('span.tsHeadline500Medium:not([class*="strikethrough"])');
    if (currentPriceElement) {
      const priceText = currentPriceElement.textContent?.replace(/[₽¥\s]/g, '').trim();
      if (priceText) {
        // 处理欧洲格式：21,89 → 21.89
        product.current_price = parseFloat(priceText.replace(/,/g, '.'));
      }
    }

    const originalPriceElement = cardElement.querySelector('span.tsBodyControl400Small.c35_3_11-b');
    if (originalPriceElement) {
      const priceText = originalPriceElement.textContent?.replace(/[₽¥\s]/g, '').trim();
      if (priceText) {
        // 处理欧洲格式：21,89 → 21.89
        product.original_price = parseFloat(priceText.replace(/,/g, '.'));
      }
    }

    const ratingSpans = cardElement.querySelectorAll('span[style*="--textPremium"]');
    for (const span of Array.from(ratingSpans)) {
      const text = span.textContent?.trim();
      if (text && /^\d+(\.\d+)?$/.test(text)) {
        product.rating = parseFloat(text);
        break;
      }
    }

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

    const imageElement = cardElement.querySelector('img:not(.ozon-bang-img)') as HTMLImageElement;
    if (imageElement) {
      product.image_url = imageElement.src;
    }

    return product as ProductData;
  }

  getFusionStats(): { spbFields: number; totalFields: number; fusedFields: string[] } {
    return {
      spbFields: 0,
      totalFields: 0,
      fusedFields: []
    };
  }
}
