/**
 * OZON 真实售价计算器 - 显示注入
 *
 * 在页面上注入和管理价格显示元素
 */

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 选择器（找到上品帮组件）
  shangpinbangSelector: '.ozon-bang-item',
  // 使用 OZON 风格的命名
  injectedElementId: 'euraflow-widget-price',
  injectedSectionId: 'euraflow-section',
};

/**
 * 注入或更新显示元素（注入到上品帮按钮区域后面）
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

  // 查找上品帮组件
  const shangpinbang = document.querySelector(
    DISPLAY_CONFIG.shangpinbangSelector
  ) as HTMLDivElement | null;

  if (!shangpinbang) {
    console.log('[EuraFlow] 未找到上品帮组件，跳过注入');
    return;
  }

  console.log('[EuraFlow] 找到上品帮组件');

  // 找到上品帮的按钮容器（在 </ul> 之后的 div）
  const buttonContainer = shangpinbang.querySelector('div[style*="padding-right: 15px"]') as HTMLDivElement | null;
  if (!buttonContainer) {
    console.log('[EuraFlow] 未找到上品帮的按钮容器，跳过注入');
    return;
  }

  console.log('[EuraFlow] 找到上品帮的按钮容器');

  // 检查是否已存在 EuraFlow 区域
  let euraflowSection = document.getElementById(
    DISPLAY_CONFIG.injectedSectionId
  ) as HTMLDivElement | null;

  if (euraflowSection) {
    // 已存在，只更新价格文字和按钮数据
    console.log('[EuraFlow] EuraFlow 区域已存在，仅更新数据');

    const priceText = euraflowSection.querySelector(
      '#euraflow-price-text'
    ) as HTMLElement;
    if (priceText) {
      priceText.innerHTML = `<b>${message}</b>`;
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

    // 创建 EuraFlow 容器（模仿上品帮的按钮容器）
    const euraflowContainer = document.createElement('div');
    euraflowContainer.id = DISPLAY_CONFIG.injectedSectionId;
    euraflowContainer.setAttribute('data-v-7f40698a', '');
    euraflowContainer.style.paddingRight = '15px';
    euraflowContainer.style.borderTop = '2px solid #1976D2';
    euraflowContainer.style.paddingTop = '12px';
    euraflowContainer.style.marginTop = '12px';

    // 第一行：EuraFlow 标题 + 真实售价（在同一行）
    const titleRow = document.createElement('div');
    titleRow.setAttribute('data-v-7f40698a', '');
    titleRow.className = 'mui-flex mui-flex__aic jcsb';
    titleRow.style.margin = '12px 0px';

    const titleSpan = document.createElement('span');
    titleSpan.setAttribute('data-v-7f40698a', '');
    titleSpan.style.fontSize = '16px';
    titleSpan.style.fontWeight = 'bold';
    titleSpan.style.color = '#1976D2';
    titleSpan.textContent = 'EuraFlow';

    const priceSpan = document.createElement('span');
    priceSpan.setAttribute('data-v-7f40698a', '');
    priceSpan.id = 'euraflow-price-text';
    priceSpan.innerHTML = `<b style="color: #D84315;">${message}</b>`;

    titleRow.appendChild(titleSpan);
    titleRow.appendChild(priceSpan);

    // 第二行：跟卖 + 采集按钮（模仿上品帮的布局）
    const buttonRow = document.createElement('div');
    buttonRow.setAttribute('data-v-7f40698a', '');
    buttonRow.className = 'mui-flex jcsb';
    buttonRow.style.margin = '12px 0px';

    // 创建"跟卖"按钮（模仿上品帮的样式）
    const followButton = document.createElement('button');
    followButton.id = 'euraflow-follow-sell';
    followButton.setAttribute('type', 'button');
    followButton.setAttribute('data-v-7f40698a', '');
    followButton.className = 'css-dev-only-do-not-override-1xuzwek ant-btn ant-btn-primary mui-flex__cell';
    followButton.style.marginRight = '12px';
    followButton.style.backgroundColor = '#1976D2';
    if (realPrice !== null) {
      followButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      followButton.setAttribute('data-product', JSON.stringify(productData));
    }

    // 创建按钮内容（带图标）
    const followIcon = document.createElement('span');
    followIcon.setAttribute('data-v-7f40698a', '');
    followIcon.setAttribute('role', 'img');
    followIcon.setAttribute('aria-label', 'thunderbolt');
    followIcon.className = 'anticon anticon-thunderbolt';
    followIcon.innerHTML = '<svg focusable="false" data-icon="thunderbolt" width="1em" height="1em" fill="currentColor" aria-hidden="true" viewBox="64 64 896 896"><path d="M848 359.3H627.7L825.8 109c4.1-5.3.4-13-6.3-13H436c-2.8 0-5.5 1.5-6.9 4L170 547.5c-3.1 5.3.7 12 6.9 12h174.4l-89.4 357.6c-1.9 7.8 7.5 13.3 13.3 7.7L853.5 373c5.2-4.9 1.7-13.7-5.5-13.7zM378.2 732.5l60.3-241H281.1l189.6-327.4h224.6L487 427.4h211L378.2 732.5z"></path></svg>';

    const followText = document.createElement('span');
    followText.textContent = '跟卖';

    followButton.appendChild(followIcon);
    followButton.appendChild(followText);

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

    // 创建"采集"按钮（模仿上品帮的样式）
    const collectButton = document.createElement('button');
    collectButton.id = 'euraflow-collect';
    collectButton.setAttribute('type', 'button');
    collectButton.setAttribute('data-v-7f40698a', '');
    collectButton.className = 'css-dev-only-do-not-override-1xuzwek ant-btn ant-btn-primary mui-flex__cell';
    collectButton.style.backgroundColor = '#52c41a';
    if (realPrice !== null) {
      collectButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      collectButton.setAttribute('data-product', JSON.stringify(productData));
    }

    // 创建按钮内容（带图标）
    const collectIcon = document.createElement('span');
    collectIcon.setAttribute('data-v-7f40698a', '');
    collectIcon.setAttribute('role', 'img');
    collectIcon.setAttribute('aria-label', 'dropbox');
    collectIcon.className = 'anticon anticon-dropbox';
    collectIcon.innerHTML = '<svg focusable="false" data-icon="dropbox" width="1em" height="1em" fill="currentColor" aria-hidden="true" viewBox="64 64 896 896"><path d="M64 556.9l264.2 173.5L512.5 577 246.8 412.7zm896-290.3zm0 0L696.8 95 512.5 248.5l265.2 164.2L512.5 577l184.3 153.4L960 558.8 777.7 412.7zM513 609.8L328.2 763.3l-79.4-51.5v57.8L513 928l263.7-158.4v-57.8l-78.9 51.5zM328.2 95L64 265.1l182.8 147.6 265.7-164.2zM64 556.9z"></path></svg>';

    const collectText = document.createElement('span');
    collectText.textContent = '采集';

    collectButton.appendChild(collectIcon);
    collectButton.appendChild(collectText);

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

        console.log('[EuraFlow] API配置:', config);

        if (!config || !config.apiUrl || !config.apiKey) {
          alert('API未配置，请先配置API');
          collectButton.disabled = false;
          collectButton.style.opacity = '1';
          collectButton.textContent = '采集';
          return;
        }

        const requestData = {
          source_url: window.location.href,
          product_data: product,
        };

        console.log('[EuraFlow] 采集请求URL:', `${config.apiUrl}/api/ef/v1/ozon/collection-records/collect`);
        console.log('[EuraFlow] 采集请求数据:', requestData);

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

    // 将按钮添加到按钮行
    buttonRow.appendChild(followButton);
    buttonRow.appendChild(collectButton);

    // 将标题行和按钮行添加到容器
    euraflowContainer.appendChild(titleRow);
    euraflowContainer.appendChild(buttonRow);

    // 将 EuraFlow 容器插入到上品帮按钮容器后面
    buttonContainer.parentNode?.insertBefore(euraflowContainer, buttonContainer.nextSibling);

    console.log('[EuraFlow] 已将 EuraFlow 组件注入到上品帮按钮区域后面');
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
 * 获取上品帮组件元素（用于检查页面是否准备好）
 */
export function getTargetContainer(): Element | null {
  return document.querySelector(DISPLAY_CONFIG.shangpinbangSelector);
}
