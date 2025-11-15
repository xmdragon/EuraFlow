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
 * 注入或更新显示元素（注入到上品帮内部的列表中）
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

  // 找到上品帮内部的 <ul> 列表
  const ulList = shangpinbang.querySelector('ul') as HTMLUListElement | null;
  if (!ulList) {
    console.log('[EuraFlow] 未找到上品帮的 <ul> 列表，跳过注入');
    return;
  }

  console.log('[EuraFlow] 找到上品帮的 <ul> 列表');

  // 检查是否已存在 EuraFlow 区域
  let euraflowSection = document.getElementById(
    DISPLAY_CONFIG.injectedSectionId
  ) as HTMLLIElement | null;

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

    // 1. 创建分隔标题 <li>
    const titleLi = document.createElement('li');
    titleLi.setAttribute('data-v-7f40698a', ''); // 模仿上品帮的 Vue scoped 属性
    titleLi.style.borderTop = '2px solid #1976D2';
    titleLi.style.marginTop = '12px';
    titleLi.style.paddingTop = '12px';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'text-class';
    titleDiv.setAttribute('data-v-7f40698a', '');
    titleDiv.innerHTML = '<span data-v-7f40698a="" style="font-size: 16px; font-weight: bold; color: #1976D2;">EuraFlow</span>';
    titleLi.appendChild(titleDiv);

    // 2. 创建价格显示 <li>
    const priceLi = document.createElement('li');
    priceLi.id = DISPLAY_CONFIG.injectedSectionId; // 用于后续查找
    priceLi.setAttribute('data-v-7f40698a', '');

    const priceDiv = document.createElement('div');
    priceDiv.className = 'text-class';
    priceDiv.setAttribute('data-v-7f40698a', '');
    priceDiv.id = 'euraflow-price-text';
    priceDiv.innerHTML = `<b>${message}</b>`;
    priceLi.appendChild(priceDiv);

    // 3. 创建按钮组 <li>
    const buttonLi = document.createElement('li');
    buttonLi.setAttribute('data-v-7f40698a', '');

    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'text-class';
    buttonDiv.setAttribute('data-v-7f40698a', '');
    buttonDiv.style.display = 'flex';
    buttonDiv.style.gap = '8px';
    buttonDiv.style.marginTop = '8px';

    // 创建"跟卖"按钮
    const followButton = document.createElement('button');
    followButton.id = 'euraflow-follow-sell';
    followButton.textContent = '跟卖';
    followButton.setAttribute('type', 'button');
    followButton.className = 'css-dev-only-do-not-override-1xuzwek ant-btn ant-btn-primary';
    if (realPrice !== null) {
      followButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      followButton.setAttribute('data-product', JSON.stringify(productData));
    }

    Object.assign(followButton.style, {
      flex: '1',
      padding: '8px 16px',
      backgroundColor: '#1976D2',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold',
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
    collectButton.className = 'css-dev-only-do-not-override-1xuzwek ant-btn ant-btn-primary';
    if (realPrice !== null) {
      collectButton.setAttribute('data-price', realPrice.toString());
    }
    if (productData) {
      collectButton.setAttribute('data-product', JSON.stringify(productData));
    }

    Object.assign(collectButton.style, {
      flex: '1',
      padding: '8px 16px',
      backgroundColor: '#52c41a',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold',
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

    buttonDiv.appendChild(followButton);
    buttonDiv.appendChild(collectButton);
    buttonLi.appendChild(buttonDiv);

    // 将所有元素添加到上品帮的 <ul> 列表末尾
    ulList.appendChild(titleLi);
    ulList.appendChild(priceLi);
    ulList.appendChild(buttonLi);

    console.log('[EuraFlow] 已将 EuraFlow 组件注入到上品帮内部');
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
    // 移除价格 <li>（包含 ID 的元素）
    euraflowSection.remove();

    // 移除标题 <li>（查找前一个兄弟元素，如果是 EuraFlow 标题则移除）
    const prevSibling = euraflowSection.previousElementSibling;
    if (prevSibling && prevSibling.textContent?.includes('EuraFlow')) {
      prevSibling.remove();
    }

    // 移除按钮 <li>（查找下一个兄弟元素，如果包含按钮则移除）
    const nextSibling = euraflowSection.nextElementSibling;
    if (nextSibling && nextSibling.querySelector('#euraflow-collect, #euraflow-follow-sell')) {
      nextSibling.remove();
    }
  }
}

/**
 * 获取上品帮组件元素（用于检查页面是否准备好）
 */
export function getTargetContainer(): Element | null {
  return document.querySelector(DISPLAY_CONFIG.shangpinbangSelector);
}
