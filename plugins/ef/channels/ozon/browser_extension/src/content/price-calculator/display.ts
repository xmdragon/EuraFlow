/**
 * OZON 真实售价计算器 - 显示注入
 *
 * 在页面上注入和管理价格显示元素
 */

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 使用 OZON 风格的命名
  injectedElementId: 'euraflow-widget-price',
  injectedSectionId: 'euraflow-section',
};

/**
 * 注入或更新显示元素（注入到 OZON 商品详情页右侧容器）
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

  // 参考上品帮的逻辑：获取 .container 的最后子元素的最后子元素
  const container = document.querySelector('.container') as HTMLElement | null;

  if (!container || !container.lastChild) {
    console.log('[EuraFlow] 未找到 .container，跳过注入');
    return;
  }

  const rightSide = (container.lastChild as HTMLElement).lastChild as HTMLElement | null;

  if (!rightSide || !rightSide.children || rightSide.children.length === 0) {
    console.log('[EuraFlow] 未找到右侧容器，跳过注入');
    return;
  }

  // 获取目标容器：children[0].firstChild 或 children[1].firstChild
  const targetContainer = (rightSide.children[0] as HTMLElement)?.firstChild as HTMLElement ||
                          (rightSide.children[1] as HTMLElement)?.firstChild as HTMLElement;

  if (!targetContainer) {
    console.log('[EuraFlow] 未找到目标容器，跳过注入');
    return;
  }

  console.log('[EuraFlow] 找到目标容器');

  // 检查是否已存在 EuraFlow 区域
  let euraflowSection = document.getElementById(
    DISPLAY_CONFIG.injectedSectionId
  ) as HTMLDivElement | null;

  // 如果组件已存在但结构被破坏，先移除再重建
  if (euraflowSection) {
    const buttonRow = euraflowSection.querySelector('#euraflow-button-row');
    if (!buttonRow) {
      // 按钮行被移除了，直接删除整个组件重建
      console.log('[EuraFlow] 检测到组件结构被破坏，重建组件');
      euraflowSection.remove();
      euraflowSection = null;
    }
  }

  if (euraflowSection) {
    // 已存在且结构完整，只更新价格和数据
    console.log('[EuraFlow] 组件存在且结构完整，仅更新数据');

    const priceText = euraflowSection.querySelector(
      '#euraflow-price-text'
    ) as HTMLElement;
    if (priceText) {
      // 更新价格值（在第二个span中）
      const priceValue = priceText.querySelector('.tsHeadline500Medium') as HTMLElement;
      if (priceValue) {
        priceValue.innerHTML = message.replace('真实售价：', '');
      }
    }

    // 更新"采集"按钮的数据属性
    const collectButton = euraflowSection.querySelector(
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
    const followButton = euraflowSection.querySelector(
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
    // 不存在，创建新的 EuraFlow 区域
    console.log('[EuraFlow] 创建新的 EuraFlow 区域');

    // 创建 EuraFlow 容器（模仿 OZON 原生组件样式）
    const euraflowContainer = document.createElement('div');
    euraflowContainer.id = DISPLAY_CONFIG.injectedSectionId;
    euraflowContainer.setAttribute('data-widget', 'webPdpGrid');
    euraflowContainer.className = 'pdp_as2 pdp_sa8 pdp_sa5 pdp_as6';
    euraflowContainer.style.padding = '8px 0px';
    euraflowContainer.style.width = '388px';

    // 第一行：真实售价（使用OZON原生样式）
    const priceRow = document.createElement('div');
    priceRow.style.padding = '8px 0';

    const priceText = document.createElement('div');
    priceText.id = 'euraflow-price-text';
    priceText.style.display = 'flex';
    priceText.style.alignItems = 'center';
    priceText.style.justifyContent = 'space-between';
    priceText.style.padding = '12px 16px';
    priceText.style.backgroundColor = '#FFF3E0';
    priceText.style.borderRadius = '8px';
    priceText.style.marginBottom = '12px';

    const priceLabel = document.createElement('span');
    priceLabel.className = 'tsBody400Medium';
    priceLabel.style.color = '#757575';
    priceLabel.textContent = '真实售价';

    const priceValue = document.createElement('span');
    priceValue.className = 'tsHeadline500Medium';
    priceValue.style.color = '#D84315';
    priceValue.innerHTML = message.replace('真实售价：', '');

    priceText.appendChild(priceLabel);
    priceText.appendChild(priceValue);
    priceRow.appendChild(priceText);

    // 第二行：跟卖 + 采集按钮（使用OZON原生按钮样式）
    const buttonRow = document.createElement('div');
    buttonRow.id = 'euraflow-button-row';
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '8px';

    // 创建"跟卖"按钮（OZON原生样式）
    const followButton = document.createElement('button');
    followButton.id = 'euraflow-follow-sell';
    followButton.setAttribute('type', 'button');
    followButton.className = 'pdp_e9a pdp_fa3 b25_5_1-a0 b25_5_1-b3 b25_5_1-a5';
    followButton.style.background = 'var(--bgActionPrimary)';
    followButton.style.color = 'var(--textLightKey)';
    followButton.style.flex = '1';
    followButton.style.height = '48px';
    followButton.style.borderRadius = '8px';
    followButton.style.border = 'none';
    followButton.style.cursor = 'pointer';
    followButton.style.position = 'relative';
    followButton.style.overflow = 'hidden';
    if (realPrice !== null) {
      followButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      followButton.setAttribute('data-product', JSON.stringify(productData));
    }

    // 按钮内容容器
    const followContent = document.createElement('div');
    followContent.className = 'b25_5_1-a2';
    followContent.style.display = 'flex';
    followContent.style.alignItems = 'center';
    followContent.style.justifyContent = 'center';
    followContent.style.gap = '4px';

    const followText = document.createElement('div');
    followText.className = 'b25_5_1-a9 tsBodyControl500Medium';
    followText.textContent = '跟卖';

    followContent.appendChild(followText);

    // 按钮波纹效果层
    const followRipple = document.createElement('div');
    followRipple.className = 'b25_5_1-a';
    followRipple.style.backgroundColor = 'var(--textLightKey)';

    followButton.appendChild(followContent);
    followButton.appendChild(followRipple);

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

    // 创建"采集"按钮（OZON原生样式，辅助按钮）
    const collectButton = document.createElement('button');
    collectButton.id = 'euraflow-collect';
    collectButton.setAttribute('type', 'button');
    collectButton.className = 'pdp_e9a pdp_fa3 b25_5_1-a0 b25_5_1-b3 b25_5_1-a5';
    collectButton.style.background = 'var(--bgActionSecondary)';
    collectButton.style.color = 'var(--textActionPrimary)';
    collectButton.style.flex = '1';
    collectButton.style.height = '48px';
    collectButton.style.borderRadius = '8px';
    collectButton.style.border = 'none';
    collectButton.style.cursor = 'pointer';
    collectButton.style.position = 'relative';
    collectButton.style.overflow = 'hidden';
    if (realPrice !== null) {
      collectButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      collectButton.setAttribute('data-product', JSON.stringify(productData));
    }

    // 按钮内容容器
    const collectContent = document.createElement('div');
    collectContent.className = 'b25_5_1-a2';
    collectContent.style.display = 'flex';
    collectContent.style.alignItems = 'center';
    collectContent.style.justifyContent = 'center';
    collectContent.style.gap = '4px';

    const collectText = document.createElement('div');
    collectText.className = 'b25_5_1-a9 tsBodyControl500Medium';
    collectText.textContent = '采集';

    collectContent.appendChild(collectText);

    // 按钮波纹效果层
    const collectRipple = document.createElement('div');
    collectRipple.className = 'b25_5_1-a';
    collectRipple.style.backgroundColor = 'var(--graphicActionPrimary)';

    collectButton.appendChild(collectContent);
    collectButton.appendChild(collectRipple);

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
        collectText.textContent = '采集中...';

        const { getApiConfig } = await import('../../shared/storage');
        const config = await getApiConfig();

        if (!config || !config.apiUrl || !config.apiKey) {
          alert('API未配置，请先配置API');
          collectButton.disabled = false;
          collectButton.style.opacity = '1';
          collectText.textContent = '采集';
          return;
        }

        // 通过 background service worker 发送请求（避免 CORS）
        const response = await chrome.runtime.sendMessage({
          type: 'COLLECT_PRODUCT',
          data: {
            apiUrl: config.apiUrl,
            apiKey: config.apiKey,
            source_url: window.location.href,
            product_data: product
          }
        });

        if (!response.success) {
          throw new Error(response.error || '采集失败');
        }

        alert('✓ 商品已采集，请到系统采集记录中查看');
      } catch (error) {
        console.error('[EuraFlow] 采集失败:', error);
        alert('采集失败：' + (error as Error).message);
      } finally {
        collectButton.disabled = false;
        collectButton.style.opacity = '1';
        collectText.textContent = '采集';
      }
    });

    // 将按钮添加到按钮行
    buttonRow.appendChild(followButton);
    buttonRow.appendChild(collectButton);

    // 将价格行和按钮行添加到容器
    euraflowContainer.appendChild(priceRow);
    euraflowContainer.appendChild(buttonRow);

    // 参考上品帮：设置第一个子元素的高度为 auto
    if (rightSide.children[0]?.firstChild) {
      (rightSide.children[0].firstChild as HTMLElement).style.height = 'auto';
    }

    // 参考上品帮：插入到目标容器的第一个子元素之前
    targetContainer.insertBefore(euraflowContainer, targetContainer.firstElementChild);

    console.log('[EuraFlow] 已将 EuraFlow 组件注入到目标容器（参考上品帮逻辑）');
  }
}

/**
 * 移除显示元素
 */
export function removeDisplay(): void {
  const euraflowSection = document.getElementById(
    DISPLAY_CONFIG.injectedSectionId
  );
  if (euraflowSection) {
    euraflowSection.remove();
  }
}

/**
 * 获取目标容器元素（用于检查页面是否准备好）
 * 参考上品帮的逻辑
 */
export function getTargetContainer(): Element | null {
  const container = document.querySelector('.container') as HTMLElement | null;
  if (!container || !container.lastChild) return null;

  const rightSide = (container.lastChild as HTMLElement).lastChild as HTMLElement | null;
  if (!rightSide || !rightSide.children || rightSide.children.length === 0) return null;

  return (rightSide.children[0] as HTMLElement)?.firstChild as HTMLElement ||
         (rightSide.children[1] as HTMLElement)?.firstChild as HTMLElement ||
         null;
}
