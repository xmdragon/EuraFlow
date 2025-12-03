/**
 * OZON 真实售价计算器 - 独立浏览器扩展
 *
 * 数据源：OZON API（/api/entrypoint-api.bx/page/json/v2）
 * 计算逻辑：与 EuraFlow 浏览器扩展完全一致
 */

(function () {
  "use strict";

  // ========== 配置常量 ==========
  const CONFIG = {
    // 计算公式系数
    FORMULA_MULTIPLIER: 2.2,

    // API 请求超时（毫秒）
    API_TIMEOUT: 10000,

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
      injectedElementId: "ozon-real-price-display",
    },
  };

  // ========== 缓存 ==========
  let cachedPriceData = null;
  let lastProductUrl = null;

  // ========== 工具函数 ==========

  /**
   * 解析价格字符串（移除空格、逗号，转为数字）
   */
  function cleanPrice(priceStr) {
    if (!priceStr) return 0;
    return parseFloat(priceStr.replace(/\s/g, '').replace(/,/g, '.')) || 0;
  }

  /**
   * 检测货币类型
   */
  function detectCurrency(priceStr) {
    if (!priceStr) return null;
    if (priceStr.includes('₽')) return '₽';
    if (priceStr.includes('¥')) return '¥';
    return null;
  }

  /**
   * 通过 OZON API 获取商品价格数据
   */
  async function fetchPriceFromAPI(productUrl) {
    try {
      const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

      const response = await fetch(apiUrl, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status}`);
      }

      const data = await response.json();

      if (!data.widgetStates) {
        throw new Error('widgetStates 不存在');
      }

      // 查找 webPrice widget（精确匹配 webPrice-，排除其他变体）
      const keys = Object.keys(data.widgetStates);
      const priceKey = keys.find(k => /^webPrice-\d+-/.test(k));

      if (!priceKey) {
        throw new Error('未找到 webPrice widget');
      }

      const priceData = JSON.parse(data.widgetStates[priceKey]);

      // cardPrice = 绿色价格（Ozon卡价格）
      // price = 黑色价格（普通价格）
      const cardPrice = cleanPrice(priceData?.cardPrice);
      const price = cleanPrice(priceData?.price);
      const currency = detectCurrency(priceData?.cardPrice) || detectCurrency(priceData?.price);

      return { cardPrice, price, currency };
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn('[OZON真实售价] API 请求超时');
      } else {
        console.warn('[OZON真实售价] API 请求失败:', error.message);
      }
      return null;
    }
  }

  /**
   * 计算真实售价的核心函数（与 EuraFlow 浏览器扩展完全一致）
   */
  function calculateRealPriceCore(greenPrice, blackPrice) {
    if (greenPrice > 0 && blackPrice > greenPrice) {
      const basePrice = (blackPrice - greenPrice) * CONFIG.FORMULA_MULTIPLIER + blackPrice;
      const roundedPrice = Math.round(basePrice);

      let adjustment = 0;
      if (roundedPrice > 0) {
        adjustment = Math.floor(roundedPrice / 100);
        if (roundedPrice % 100 === 0 && adjustment > 0) {
          adjustment -= 1;
        }
      }

      return roundedPrice - adjustment;
    }

    return Math.round(blackPrice);
  }

  /**
   * 计算真实售价（包装函数）
   */
  function calculateRealPrice(greenPrice, blackPrice, currency) {
    if (currency === '₽') {
      return { price: null, message: '⚠️ 请切换货币为CNY' };
    }

    if (blackPrice === null || blackPrice === 0) {
      return { price: null, message: null };
    }

    const realPrice = calculateRealPriceCore(greenPrice || 0, blackPrice);
    return { price: realPrice, message: `真实售价：${realPrice.toFixed(2)} ¥` };
  }

  /**
   * 注入或更新显示元素
   */
  function injectOrUpdateDisplay(message) {
    if (!message) {
      const existingElement = document.getElementById(CONFIG.SELECTORS.injectedElementId);
      if (existingElement) existingElement.remove();
      return;
    }

    const targetContainer = document.querySelector(CONFIG.SELECTORS.priceWidget);
    if (!targetContainer || !targetContainer.parentElement) return;

    let displayElement = document.getElementById(CONFIG.SELECTORS.injectedElementId);

    if (displayElement) {
      displayElement.textContent = message;
    } else {
      displayElement = document.createElement("div");
      displayElement.id = CONFIG.SELECTORS.injectedElementId;
      Object.assign(displayElement.style, CONFIG.STYLE);
      displayElement.textContent = message;
      targetContainer.parentElement.insertBefore(displayElement, targetContainer.nextSibling);
    }
  }

  /**
   * 主执行函数
   */
  async function calculateAndDisplay() {
    try {
      const currentUrl = window.location.href;

      // 检查缓存
      if (cachedPriceData && lastProductUrl === currentUrl) {
        const { message } = calculateRealPrice(
          cachedPriceData.cardPrice,
          cachedPriceData.price,
          cachedPriceData.currency
        );
        injectOrUpdateDisplay(message);
        return;
      }

      const priceData = await fetchPriceFromAPI(currentUrl);
      if (!priceData) return;

      cachedPriceData = priceData;
      lastProductUrl = currentUrl;

      const { cardPrice, price, currency } = priceData;
      if (price === 0 && cardPrice === 0) return;

      const { message } = calculateRealPrice(cardPrice, price, currency);
      injectOrUpdateDisplay(message);
    } catch (error) {
      console.error("[OZON真实售价] 错误:", error);
    }
  }

  /**
   * 等待价格组件出现
   */
  function waitForPriceWidget() {
    return new Promise((resolve) => {
      const maxWait = 15000;
      const checkInterval = 200;
      let elapsed = 0;

      const check = () => {
        const priceWidget = document.querySelector(CONFIG.SELECTORS.priceWidget);
        if (priceWidget) {
          resolve(true);
          return;
        }

        elapsed += checkInterval;
        if (elapsed >= maxWait) {
          resolve(false);
          return;
        }

        setTimeout(check, checkInterval);
      };

      check();
    });
  }

  /**
   * 设置 URL 变化监听（SPA 导航）
   */
  function setupUrlChangeListener() {
    let lastUrl = window.location.href;

    const handleUrlChange = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        cachedPriceData = null;
        lastProductUrl = null;

        // 只在商品页面执行
        if (window.location.pathname.includes('/product/')) {
          waitForPriceWidget().then((found) => {
            if (found) calculateAndDisplay();
          });
        }
      }
    };

    window.addEventListener('popstate', handleUrlChange);

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      handleUrlChange();
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      handleUrlChange();
    };
  }

  /**
   * 初始化
   */
  async function init() {
    try {
      console.log('[OZON真实售价] 扩展已加载 v1.0.0');

      setupUrlChangeListener();

      const found = await waitForPriceWidget();
      if (found) {
        await calculateAndDisplay();
      }
    } catch (error) {
      console.error("[OZON真实售价] 初始化错误:", error);
    }
  }

  // 启动
  init();
})();
