// ==UserScript==
// @name         OZON真实售价计算器
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  在OZON商品页面显示计算后的真实售价（支持动态更新）
// @author       EuraFlow
// @match        https://www.ozon.ru/product/*
// @match        https://*.ozon.ru/product/*
// @include      /^https?://.*\.ozon\.ru/product/.*/
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // ========== 配置常量 ==========
  const CONFIG = {
    // 价格区间阈值
    LOW_PRICE_THRESHOLD: 90,
    MID_PRICE_MIN: 90,
    MID_PRICE_MAX: 120,
    MID_PRICE_MARKUP: 5,

    // 计算公式系数
    FORMULA_MULTIPLIER: 2.5,

    // 防抖延迟（毫秒）
    DEBOUNCE_DELAY: 500,

    // 样式配置
    STYLE: {
      backgroundColor: "#FFE7BA",
      borderLeft: "4px solid #FF9800",
      color: "#D84315",
      fontSize: "18px",
      fontWeight: "bold",
      padding: "16px",
      borderRadius: "8px",
      marginBottom: "16px",
    },

    // 选择器
    SELECTORS: {
      priceWidget: '[data-widget="webPrice"]',
      greenPriceContainer: ".pdp_fb1",
      greenPriceText: ".tsHeadline600Large",
      blackPriceContainer: ".pdp_bf9",
      blackPriceText500: ".pdp_b7f.tsHeadline500Medium",
      blackPriceText600: ".pdp_b7f.tsHeadline600Large",
      targetContainer: ".pdp_b8i.pdp_i8b",
      injectedElementId: "tampermonkey-real-price",
    },
  };

  // ========== 工具函数 ==========

  /**
   * 防抖函数
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * 解析价格文本
   * @param {string} priceText - 价格文本，如 "1 219 ₽" 或 "69,02 ¥"
   * @returns {{value: number|null, currency: string|null}} 解析后的价格对象
   */
  function parsePrice(priceText) {
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
      .replace(/[₽¥]/g, "")
      .replace(/\s/g, "")
      .replace(/,/g, ".");

    const value = parseFloat(cleanText);

    return {
      value: isNaN(value) ? null : value,
      currency: currency,
    };
  }

  /**
   * 查找并解析页面上的价格
   * @returns {{greenPrice: number|null, blackPrice: number|null, currency: string|null}}
   */
  function findPrices() {
    const result = {
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
   * @param {number|null} greenPrice - 绿标价
   * @param {number|null} blackPrice - 黑标价
   * @param {string|null} currency - 货币符号
   * @returns {{price: number|null, message: string}}
   */
  function calculateRealPrice(greenPrice, blackPrice, currency) {
    // 检查货币是否为卢布
    if (currency === "₽") {
      return {
        price: null,
        message: "⚠️ 请切换货币为CNY",
      };
    }

    // 检查是否有黑标价
    if (blackPrice === null) {
      return {
        price: null,
        message: null,
      };
    }

    // 优先级规则1: 黑标价 < 90 ¥
    if (blackPrice < CONFIG.LOW_PRICE_THRESHOLD) {
      return {
        price: blackPrice,
        message: `真实售价：${blackPrice.toFixed(2)} ¥`,
      };
    }

    // 优先级规则2: 黑标价在 90-120 ¥
    if (
      blackPrice >= CONFIG.MID_PRICE_MIN &&
      blackPrice <= CONFIG.MID_PRICE_MAX
    ) {
      const realPrice = blackPrice + CONFIG.MID_PRICE_MARKUP;
      return {
        price: realPrice,
        message: `真实售价：${realPrice.toFixed(2)} ¥`,
      };
    }

    // 优先级规则3: 有绿标价，使用公式
    if (greenPrice !== null) {
      const realPrice = Math.ceil(
        (blackPrice - greenPrice) * CONFIG.FORMULA_MULTIPLIER + blackPrice
      );
      return {
        price: realPrice,
        message: `真实售价：${realPrice.toFixed(2)} ¥`,
      };
    }

    // 默认情况：只有黑标价
    return {
      price: blackPrice,
      message: `真实售价：${blackPrice.toFixed(2)} ¥`,
    };
  }

  /**
   * 注入或更新显示元素
   * @param {string} message - 要显示的消息
   */
  function injectOrUpdateDisplay(message) {
    if (!message) {
      // 如果没有消息，移除已存在的显示元素
      const existingElement = document.getElementById(
        CONFIG.SELECTORS.injectedElementId
      );
      if (existingElement) {
        existingElement.remove();
      }
      return;
    }

    // 查找目标容器
    const targetContainer = document.querySelector(
      CONFIG.SELECTORS.targetContainer
    );
    if (!targetContainer) {
      return;
    }

    // 检查是否已存在显示元素
    let displayElement = document.getElementById(
      CONFIG.SELECTORS.injectedElementId
    );

    if (displayElement) {
      // 更新现有元素
      displayElement.textContent = message;
    } else {
      // 创建新元素
      displayElement = document.createElement("div");
      displayElement.id = CONFIG.SELECTORS.injectedElementId;

      // 应用样式
      Object.assign(displayElement.style, CONFIG.STYLE);

      // 设置文本
      displayElement.textContent = message;

      // 注入到目标容器之前
      targetContainer.parentNode.insertBefore(
        displayElement,
        targetContainer
      );
    }
  }

  /**
   * 主执行函数
   */
  function calculateAndDisplay() {
    try {
      // 查找价格
      const { greenPrice, blackPrice, currency } = findPrices();

      // 如果没有找到任何价格，静默失败
      if (blackPrice === null && greenPrice === null) {
        return;
      }

      // 计算真实售价
      const { price, message } = calculateRealPrice(
        greenPrice,
        blackPrice,
        currency
      );

      // 注入或更新显示
      injectOrUpdateDisplay(message);
    } catch (error) {
      console.error("[OZON真实售价] 错误:", error);
    }
  }

  /**
   * 设置动态监听
   */
  function setupDynamicListener() {
    // 防抖处理的执行函数
    const debouncedCalculate = debounce(
      calculateAndDisplay,
      CONFIG.DEBOUNCE_DELAY
    );

    // 创建 MutationObserver
    const observer = new MutationObserver((mutations) => {
      // 检查是否有相关元素变化
      let shouldUpdate = false;

      for (const mutation of mutations) {
        // 检查是否影响价格区域
        if (
          mutation.target.closest &&
          (mutation.target.closest(CONFIG.SELECTORS.priceWidget) ||
            mutation.target.closest(CONFIG.SELECTORS.targetContainer))
        ) {
          shouldUpdate = true;
          break;
        }
      }

      if (shouldUpdate) {
        debouncedCalculate();
      }
    });

    // 监听整个文档的子树变化
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-widget"],
    });
  }

  /**
   * 初始化脚本
   */
  function init() {
    try {
      // 等待页面完全加载
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          calculateAndDisplay();
          setupDynamicListener();
        });
      } else {
        // 页面已加载，直接执行
        calculateAndDisplay();
        setupDynamicListener();
      }
    } catch (error) {
      console.error("[OZON真实售价] 初始化错误:", error);
    }
  }

  // ========== 启动脚本 ==========
  init();
})();
