/**
 * OZON 真实售价计算器 - 核心逻辑
 *
 * 从页面提取价格并计算真实售价
 */

// ========== 配置常量 ==========
export const CONFIG = {
  // 计算公式系数
  FORMULA_MULTIPLIER: 2.5,

  // 选择器
  SELECTORS: {
    priceWidget: '[data-widget="webPrice"]',
    greenPriceContainer: '.pdp_fb1',
    greenPriceText: '.tsHeadline600Large',
    blackPriceContainer: '.pdp_bf9',
    blackPriceText500: '.pdp_b7f.tsHeadline500Medium',
    blackPriceText600: '.pdp_b7f.tsHeadline600Large',
  },
};

// ========== 类型定义 ==========
export interface PriceInfo {
  value: number | null;
  currency: string | null;
}

export interface PricesResult {
  greenPrice: number | null;
  blackPrice: number | null;
  currency: string | null;
}

export interface CalculationResult {
  price: number | null;
  message: string | null;
}

// ========== 工具函数 ==========

/**
 * 解析价格文本
 * @param priceText - 价格文本，如 "1 219 ₽" 或 "69,02 ¥"
 * @returns 解析后的价格对象
 */
export function parsePrice(priceText: string | null | undefined): PriceInfo {
  if (!priceText) {
    return { value: null, currency: null };
  }

  // 提取货币符号
  const currencyMatch = priceText.match(/[₽¥]/);
  const currency = currencyMatch ? currencyMatch[0] : null;

  // 提取并清理数字
  // 1. 移除货币符号
  // 2. 移除所有空格
  // 3. 将逗号替换为点（欧洲格式）
  const cleanText = priceText
    .replace(/[₽¥]/g, '')
    .replace(/\s/g, '')
    .replace(/,/g, '.');

  const value = parseFloat(cleanText);

  return {
    value: isNaN(value) ? null : value,
    currency: currency,
  };
}

/**
 * 查找并解析页面上的价格
 * @returns 绿标价、黑标价和货币信息
 */
export function findPrices(): PricesResult {
  const result: PricesResult = {
    greenPrice: null,
    blackPrice: null,
    currency: null,
  };

  // 查找价格组件
  const priceWidget = document.querySelector(CONFIG.SELECTORS.priceWidget);
  if (!priceWidget) {
    return result;
  }

  // 查找绿标价（Ozon Card 价格）
  const greenPriceContainer = priceWidget.querySelector(
    CONFIG.SELECTORS.greenPriceContainer
  );
  if (greenPriceContainer) {
    const greenPriceElement = greenPriceContainer.querySelector(
      CONFIG.SELECTORS.greenPriceText
    );
    if (greenPriceElement) {
      const parsed = parsePrice(greenPriceElement.textContent);
      result.greenPrice = parsed.value;
      result.currency = parsed.currency;
    }
  }

  // 查找黑标价（常规价格）
  // 尝试查找多价格情况（tsHeadline500Medium）
  let blackPriceElement = priceWidget.querySelector(
    CONFIG.SELECTORS.blackPriceText500
  );

  // 如果没找到，尝试单价格情况（tsHeadline600Large）
  if (!blackPriceElement) {
    // 需要排除绿标价区域，找到 pdp_bf9 容器外的黑标价
    blackPriceElement = priceWidget.querySelector(
      CONFIG.SELECTORS.blackPriceText600
    );

    // 如果找到的是绿标价，跳过
    if (
      blackPriceElement &&
      greenPriceContainer &&
      greenPriceContainer.contains(blackPriceElement)
    ) {
      blackPriceElement = null;
    }
  }

  if (blackPriceElement) {
    const parsed = parsePrice(blackPriceElement.textContent);
    result.blackPrice = parsed.value;
    // 如果之前没有货币，更新货币
    if (!result.currency) {
      result.currency = parsed.currency;
    }
  }

  return result;
}

/**
 * 计算真实售价
 * @param greenPrice - 绿标价
 * @param blackPrice - 黑标价
 * @param currency - 货币符号
 * @returns 计算结果和显示消息
 */
export function calculateRealPrice(
  greenPrice: number | null,
  blackPrice: number | null,
  currency: string | null
): CalculationResult {
  // 检查货币是否为卢布
  if (currency === '₽') {
    return {
      price: null,
      message: '⚠️ 请切换货币为CNY',
    };
  }

  // 检查是否有黑标价
  if (blackPrice === null) {
    return {
      price: null,
      message: null,
    };
  }

  // 统一使用公式计算：有绿标价时，使用公式
  if (greenPrice !== null) {
    const realPrice = Math.ceil(
      (blackPrice - greenPrice) * CONFIG.FORMULA_MULTIPLIER + blackPrice
    );
    return {
      price: realPrice,
      message: `真实售价：${realPrice.toFixed(2)} ¥`,
    };
  }

  // 只有黑标价时，直接使用黑标价
  return {
    price: blackPrice,
    message: `真实售价：${blackPrice.toFixed(2)} ¥`,
  };
}
