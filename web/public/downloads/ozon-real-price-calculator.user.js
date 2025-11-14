// ==UserScript==
// @name         OZON真实售价计算器
// @namespace    http://tampermonkey.net/
// @version      1.3.2
// @description  在OZON商品页面显示计算后的真实售价（修复OZON删除chrome.runtime导致的错误）
// @author       EuraFlow
// @match        https://www.ozon.ru/product/*
// @match        https://*.ozon.ru/product/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // ========== 修复 OZON 删除 chrome.runtime 的问题 ==========
  // OZON 网站会删除 chrome.runtime 以防止扩展抓取数据
  // 这会导致 Tampermonkey 扩展报错，但不影响脚本功能
  // 我们提供一个空的 polyfill 来消除错误
  if (typeof chrome !== 'undefined' && !chrome.runtime) {
    try {
      Object.defineProperty(chrome, 'runtime', {
        value: {
          connect: function() { return { postMessage: function() {}, onMessage: { addListener: function() {} } }; },
          sendMessage: function() {},
          onMessage: { addListener: function() {} },
          getURL: function(path) { return path; },
          id: 'tampermonkey-polyfill',
          lastError: null,
        },
        writable: false,
        configurable: false,
      });
    } catch (e) {
      // 如果无法定义，静默失败（不影响脚本功能）
    }
  }

  // ========== 配置常量 ==========
  const CONFIG = {
    // 计算公式系数
    FORMULA_MULTIPLIER: 2.2,

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

    // 选择器（使用稳定的类名，避免 pdp_xxx 变化导致失效）
    SELECTORS: {
      priceWidget: '[data-widget="webPrice"]',
      // 绿色价格文本（稳定）
      greenPriceText: ".tsHeadline600Large",
      // 黑色价格（多价格情况，稳定）
      blackPriceText500: ".tsHeadline500Medium",
      // 注入位置
      separatorWidget: '[data-widget="separator"]',
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

    // 查找所有价格元素（使用稳定的类名）
    const greenPriceElements = priceWidget.querySelectorAll(
      CONFIG.SELECTORS.greenPriceText
    );
    const blackPriceElements = priceWidget.querySelectorAll(
      CONFIG.SELECTORS.blackPriceText500
    );

    // 提取绿色价格（Ozon Card价格）
    // 策略：第一个 tsHeadline600Large 通常是绿色价格
    if (greenPriceElements.length > 0) {
      const parsed = parsePrice(greenPriceElements[0].textContent);
      result.greenPrice = parsed.value;
      result.currency = parsed.currency;
    }

    // 提取黑色价格（常规价格）
    // 策略：第一个 tsHeadline500Medium 通常是黑色价格
    if (blackPriceElements.length > 0) {
      const parsed = parsePrice(blackPriceElements[0].textContent);
      result.blackPrice = parsed.value;
      if (!result.currency) {
        result.currency = parsed.currency;
      }
    }

    return result;
  }

  /**
   * 计算真实售价（核心算法，与浏览器扩展保持一致）
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

    let realPrice;

    // 有绿标价且绿标价 < 黑标价时，使用公式计算
    if (greenPrice !== null && greenPrice > 0 && blackPrice > greenPrice) {
      // 计算基础价格
      const basePrice = (blackPrice - greenPrice) * CONFIG.FORMULA_MULTIPLIER + blackPrice;
      // 四舍五入到整数
      const roundedPrice = Math.round(basePrice);

      // 按价格区间修正：1-100减1，101-200减2，201-300减3...
      let adjustment = 0;
      if (roundedPrice > 0) {
        adjustment = Math.floor(roundedPrice / 100);
        // 如果刚好是100的倍数，则属于上一个区间
        if (roundedPrice % 100 === 0 && adjustment > 0) {
          adjustment -= 1;
        }
      }

      realPrice = roundedPrice - adjustment;
    } else {
      // 没有绿标价或绿标价≥黑标价，直接使用黑标价
      realPrice = Math.round(blackPrice);
    }

    return {
      price: realPrice,
      message: `真实售价：${realPrice.toFixed(2)} ¥`,
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

    // 查找 separator 元素（更稳定的注入位置）
    const separator = document.querySelector(CONFIG.SELECTORS.separatorWidget);
    if (!separator || !separator.parentElement) {
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

      // 注入到 separator 之前
      separator.parentElement.insertBefore(displayElement, separator);
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
