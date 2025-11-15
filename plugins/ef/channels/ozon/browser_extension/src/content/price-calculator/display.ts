/**
 * OZON 真实售价计算器 - 显示注入
 *
 * 在页面上注入和管理价格显示元素
 */

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 选择器（注入到 webSale 之后）
  stickyColumnSelector: '[data-widget="webStickyColumn"]',
  webSaleSelector: '[data-widget="webSale"]',
  injectedElementId: 'euraflow-real-price',
  injectedDataWidget: 'webEuraflowPrice',

  // 样式
  style: {
    backgroundColor: '#FFE7BA',
    color: '#D84315',
    fontSize: '18px',
    fontWeight: 'bold',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
};

/**
 * 注入或更新显示元素（两列布局：左边价格，右边按钮）
 * @param message - 要显示的消息（如 "真实售价：120.00 ¥"）
 * @param realPrice - 真实售价数值（用于传递给弹窗）
 * @param productData - 商品详情数据（包括变体的真实售价）
 */
export function injectOrUpdateDisplay(
  message: string | null,
  realPrice: number | null = null,
  productData: any = null
): void {
  if (!message) {
    // 如果没有消息，移除已存在的显示元素
    removeDisplay();
    return;
  }

  // 查找 webStickyColumn 和 webSale 元素
  const stickyColumn = document.querySelector(
    DISPLAY_CONFIG.stickyColumnSelector
  );
  if (!stickyColumn) {
    return;
  }

  const webSale = stickyColumn.querySelector(
    DISPLAY_CONFIG.webSaleSelector
  );
  if (!webSale) {
    return;
  }

  // 检查是否已存在显示元素
  let displayElement = document.getElementById(
    DISPLAY_CONFIG.injectedElementId
  ) as HTMLDivElement | null;

  if (displayElement) {
    // 更新价格文字
    const priceText = displayElement.querySelector(
      '#euraflow-price-text'
    ) as HTMLDivElement;
    if (priceText) {
      priceText.textContent = message;
    }

    // 更新"采集"按钮的数据属性
    const collectButton = displayElement.querySelector(
      '#euraflow-collect'
    ) as HTMLButtonElement;
    if (collectButton) {
      if (realPrice !== null) {
        collectButton.setAttribute('data-price', realPrice.toString());
      }
      if (productData) {
        collectButton.setAttribute('data-product', JSON.stringify(productData));
      }
    }

    // 更新"跟卖"按钮的数据属性
    const followButton = displayElement.querySelector(
      '#euraflow-follow-sell'
    ) as HTMLButtonElement;
    if (followButton) {
      if (realPrice !== null) {
        followButton.setAttribute('data-price', realPrice.toString());
      }
      if (productData) {
        followButton.setAttribute('data-product', JSON.stringify(productData));
      }
    }
  } else {
    // 创建新元素 - 两列布局
    displayElement = document.createElement('div');
    displayElement.id = DISPLAY_CONFIG.injectedElementId;
    // 添加 data-widget 属性，模仿 OZON 原生组件
    displayElement.setAttribute('data-widget', DISPLAY_CONFIG.injectedDataWidget);

    // 容器样式（flex布局）
    Object.assign(displayElement.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      backgroundColor: '#FFE7BA',
      padding: '16px',
      borderRadius: '8px',
      marginBottom: '16px',
    });

    // 左列：价格显示
    const priceSection = document.createElement('div');
    priceSection.id = 'euraflow-price-text';
    Object.assign(priceSection.style, {
      flex: '1',
      fontSize: '18px',
      fontWeight: 'bold',
      color: '#D84315',
    });
    priceSection.textContent = message;

    // 右列：按钮（跟卖 + 采集）
    const buttonSection = document.createElement('div');
    Object.assign(buttonSection.style, {
      flexShrink: '0',
      display: 'flex',
      gap: '8px',
    });

    // 创建"跟卖"按钮
    const followButton = document.createElement('button');
    followButton.id = 'euraflow-follow-sell';
    followButton.textContent = '跟卖';
    followButton.setAttribute('type', 'button');
    if (realPrice !== null) {
      followButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      followButton.setAttribute('data-product', JSON.stringify(productData));
    }

    Object.assign(followButton.style, {
      padding: '10px 20px',
      backgroundColor: '#1976D2',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold',
      whiteSpace: 'nowrap',
      transition: 'background-color 0.2s',
    });

    followButton.addEventListener('mouseenter', () => {
      followButton.style.backgroundColor = '#1565C0';
    });
    followButton.addEventListener('mouseleave', () => {
      followButton.style.backgroundColor = '#1976D2';
    });

    followButton.addEventListener('click', async () => {
      try {
        const productDataStr = followButton.getAttribute('data-product');
        const product = productDataStr ? JSON.parse(productDataStr) : null;

        if (!product || !product.dimensions) {
          alert('商品数据不完整（缺少尺寸和重量信息），请通过其它插件上架');
          return;
        }

        const dims = product.dimensions;
        if (dims.weight === -1 || dims.height === -1 || dims.width === -1 || dims.length === -1) {
          alert('上品帮尺寸和重量数据较慢，请稍后重试');
          return;
        }

        const { showPublishModal } = await import('../components/PublishModal');
        const currentRealPriceStr = followButton.getAttribute('data-price');
        const currentRealPrice = currentRealPriceStr ? parseFloat(currentRealPriceStr) : null;
        showPublishModal(product, currentRealPrice);
      } catch (error) {
        console.error('[EuraFlow] 打开跟卖弹窗失败:', error);
        alert('打开上架配置失败，请稍后重试');
      }
    });

    // 创建"采集"按钮
    const collectButton = document.createElement('button');
    collectButton.id = 'euraflow-collect';
    collectButton.textContent = '采集';
    collectButton.setAttribute('type', 'button');
    if (realPrice !== null) {
      collectButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      collectButton.setAttribute('data-product', JSON.stringify(productData));
    }

    Object.assign(collectButton.style, {
      padding: '10px 20px',
      backgroundColor: '#52c41a',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold',
      whiteSpace: 'nowrap',
      transition: 'background-color 0.2s',
    });

    collectButton.addEventListener('mouseenter', () => {
      collectButton.style.backgroundColor = '#389e0d';
    });
    collectButton.addEventListener('mouseleave', () => {
      collectButton.style.backgroundColor = '#52c41a';
    });

    collectButton.addEventListener('click', async () => {
      try {
        const productDataStr = collectButton.getAttribute('data-product');
        const product = productDataStr ? JSON.parse(productDataStr) : null;

        if (!product || !product.dimensions) {
          alert('商品数据不完整（缺少尺寸和重量信息），请通过其它插件上架');
          return;
        }

        const dims = product.dimensions;
        if (dims.weight === -1 || dims.height === -1 || dims.width === -1 || dims.length === -1) {
          alert('上品帮尺寸和重量数据较慢，请稍后重试');
          return;
        }

        // 直接发送采集请求，不打开弹窗
        collectButton.disabled = true;
        collectButton.style.opacity = '0.5';
        collectButton.textContent = '采集中...';

        const { getApiConfig } = await import('../../shared/storage');
        const config = await getApiConfig();

        if (!config || !config.apiUrl || !config.apiKey) {
          alert('API未配置，请先配置API');
          return;
        }

        const requestData = {
          source_url: window.location.href,
          product_data: product,
        };

        const response = await fetch(`${config.apiUrl}/api/ef/v1/ozon/collection-records/collect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': config.apiKey,
          },
          credentials: 'include',
          body: JSON.stringify(requestData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.error?.detail || errorData?.detail || '采集失败');
        }

        await response.json();
        alert('✓ 商品已采集，请到系统采集记录中查看');
      } catch (error) {
        console.error('[EuraFlow] 采集失败:', error);
        alert('采集失败：' + (error as Error).message);
      } finally {
        collectButton.disabled = false;
        collectButton.style.opacity = '1';
        collectButton.textContent = '采集';
      }
    });

    buttonSection.appendChild(collectButton);
    buttonSection.appendChild(followButton);
    displayElement.appendChild(priceSection);
    displayElement.appendChild(buttonSection);

    // 注入到 webSale 之后（在 webStickyColumn 内）
    if (webSale.nextSibling) {
      stickyColumn.insertBefore(displayElement, webSale.nextSibling);
    } else {
      stickyColumn.appendChild(displayElement);
    }
  }
}

/**
 * 移除显示元素
 */
export function removeDisplay(): void {
  const existingElement = document.getElementById(
    DISPLAY_CONFIG.injectedElementId
  );
  if (existingElement) {
    existingElement.remove();
  }
}

/**
 * 获取 webStickyColumn 元素（用于检查页面是否准备好）
 */
export function getTargetContainer(): Element | null {
  return document.querySelector(DISPLAY_CONFIG.stickyColumnSelector);
}
