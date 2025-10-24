// ==UserScript==
// @name         OZON真实售价计算器
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  在OZON商品页面显示计算后的真实售价（支持动态更新）
// @author       EuraFlow
// @match        https://www.ozon.ru/product/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // 立即输出日志，确认脚本已加载
  console.log("========================================");
  console.log("[OZON真实售价] 脚本已加载！版本 1.0.1");
  console.log("[OZON真实售价] 当前URL:", window.location.href);
  console.log("[OZON真实售价] 页面状态:", document.readyState);
  console.log("========================================");

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

    console.log("[OZON真实售价] 开始查找价格元素...");

    // 查找价格组件
    const priceWidget = document.querySelector(CONFIG.SELECTORS.priceWidget);
    if (!priceWidget) {
      console.warn(
        "[OZON真实售价] 未找到价格组件:",
        CONFIG.SELECTORS.priceWidget
      );
      return result;
    }
    console.log("[OZON真实售价] ✓ 找到价格组件");

    // 查找绿标价（Ozon Card 价格）
    const greenPriceContainer = priceWidget.querySelector(
      CONFIG.SELECTORS.greenPriceContainer
    );
    if (greenPriceContainer) {
      console.log("[OZON真实售价] ✓ 找到绿标价容器");
      const greenPriceElement = greenPriceContainer.querySelector(
        CONFIG.SELECTORS.greenPriceText
      );
      if (greenPriceElement) {
        console.log(
          "[OZON真实售价] ✓ 找到绿标价元素，文本:",
          greenPriceElement.textContent
        );
        const parsed = parsePrice(greenPriceElement.textContent);
        result.greenPrice = parsed.value;
        result.currency = parsed.currency;
        console.log("[OZON真实售价] 解析绿标价:", parsed);
      }
    } else {
      console.log("[OZON真实售价] 未找到绿标价容器（可能是单价格商品）");
    }

    // 查找黑标价（常规价格）
    // 尝试查找多价格情况（tsHeadline500Medium）
    console.log("[OZON真实售价] 尝试查找黑标价（多价格情况）...");
    let blackPriceElement = priceWidget.querySelector(
      CONFIG.SELECTORS.blackPriceText500
    );

    // 如果没找到，尝试单价格情况（tsHeadline600Large）
    if (!blackPriceElement) {
      console.log("[OZON真实售价] 未找到多价格，尝试单价格情况...");
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
        console.log("[OZON真实售价] 找到的是绿标价，跳过");
        blackPriceElement = null;
      }
    }

    if (blackPriceElement) {
      console.log(
        "[OZON真实售价] ✓ 找到黑标价元素，文本:",
        blackPriceElement.textContent
      );
      const parsed = parsePrice(blackPriceElement.textContent);
      result.blackPrice = parsed.value;
      console.log("[OZON真实售价] 解析黑标价:", parsed);
      // 如果之前没有货币，更新货币
      if (!result.currency) {
        result.currency = parsed.currency;
      }
    } else {
      console.warn("[OZON真实售价] 未找到黑标价元素");
    }

    console.log("[OZON真实售价] 价格查找完成:", result);
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
      console.warn("[OZON真实售价] 未找到目标容器");
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

      console.log("[OZON真实售价] 显示元素已注入");
    }
  }

  /**
   * 主执行函数
   */
  function calculateAndDisplay() {
    try {
      console.log("[OZON真实售价] ========== 开始计算 ==========");

      // 查找价格
      console.log("[OZON真实售价] 正在查找价格元素...");
      const { greenPrice, blackPrice, currency } = findPrices();

      console.log("[OZON真实售价] 价格信息:", {
        greenPrice,
        blackPrice,
        currency,
      });

      // 如果没有找到任何价格，静默失败
      if (blackPrice === null && greenPrice === null) {
        console.warn(
          "[OZON真实售价] 未找到任何价格信息，可能页面还未加载完成"
        );
        return;
      }

      // 计算真实售价
      console.log("[OZON真实售价] 正在计算真实售价...");
      const { price, message } = calculateRealPrice(
        greenPrice,
        blackPrice,
        currency
      );

      console.log("[OZON真实售价] 计算结果:", { price, message });

      // 注入或更新显示
      console.log("[OZON真实售价] 正在注入显示元素...");
      injectOrUpdateDisplay(message);

      console.log("[OZON真实售价] ========== 计算完成 ==========");
    } catch (error) {
      console.error("[OZON真实售价] calculateAndDisplay 出错:", error);
      console.error("[OZON真实售价] 错误堆栈:", error.stack);
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
        console.log("[OZON真实售价] 检测到价格变化，重新计算...");
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

    console.log("[OZON真实售价] 动态监听已启动");
  }

  /**
   * 初始化脚本
   */
  function init() {
    try {
      console.log("[OZON真实售价] 脚本初始化...");

      // 等待页面完全加载
      if (document.readyState === "loading") {
        console.log("[OZON真实售价] 页面正在加载，等待 DOMContentLoaded 事件...");
        document.addEventListener("DOMContentLoaded", () => {
          console.log("[OZON真实售价] DOMContentLoaded 事件触发");
          try {
            calculateAndDisplay();
            setupDynamicListener();
          } catch (error) {
            console.error("[OZON真实售价] DOMContentLoaded 执行出错:", error);
          }
        });
      } else {
        // 页面已加载，直接执行
        console.log("[OZON真实售价] 页面已加载，立即执行...");
        calculateAndDisplay();
        setupDynamicListener();
      }

      console.log("[OZON真实售价] 脚本已启动");
    } catch (error) {
      console.error("[OZON真实售价] 初始化出错:", error);
      console.error("[OZON真实售价] 错误堆栈:", error.stack);
    }
  }

  // ========== 启动脚本 ==========
  try {
    console.log("[OZON真实售价] 开始执行 init()...");
    init();
  } catch (error) {
    console.error("[OZON真实售价] 脚本启动失败:", error);
    console.error("[OZON真实售价] 错误堆栈:", error.stack);
  }
})();
