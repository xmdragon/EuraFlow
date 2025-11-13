/**
 * OZON 真实售价计算器 - 显示注入
 *
 * 在页面上注入和管理价格显示元素
 */

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 选择器（注入到价格区域内的第一个位置）
  targetContainer: '.pdp_sa1.pdp_as8.pdp_as5.pdp_a5s',
  injectedElementId: 'euraflow-real-price',

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
 */
export function injectOrUpdateDisplay(
  message: string | null,
  realPrice: number | null = null
): void {
  if (!message) {
    // 如果没有消息，移除已存在的显示元素
    removeDisplay();
    return;
  }

  // 查找目标容器
  const targetContainer = document.querySelector(
    DISPLAY_CONFIG.targetContainer
  );
  if (!targetContainer) {
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

    // 更新按钮的 data-price 属性
    const button = displayElement.querySelector(
      '#euraflow-one-click-follow'
    ) as HTMLButtonElement;
    if (button && realPrice !== null) {
      button.setAttribute('data-price', realPrice.toString());
    }
  } else {
    // 创建新元素 - 两列布局
    displayElement = document.createElement('div');
    displayElement.id = DISPLAY_CONFIG.injectedElementId;

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

    // 右列：按钮
    const buttonSection = document.createElement('div');
    Object.assign(buttonSection.style, {
      flexShrink: '0',
    });

    const button = document.createElement('button');
    button.id = 'euraflow-one-click-follow';
    button.textContent = '一键跟卖';
    button.setAttribute('type', 'button');
    if (realPrice !== null) {
      button.setAttribute('data-price', realPrice.toString());
    }

    Object.assign(button.style, {
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

    // 悬停效果
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#1565C0';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#1976D2';
    });

    // 点击事件（后续实现弹窗）
    button.addEventListener('click', async () => {
      try {
        // 动态导入弹窗模块
        const { showPublishModal } = await import(
          '../components/PublishModal'
        );
        const price = parseFloat(button.getAttribute('data-price') || '0');
        showPublishModal(price);
      } catch (error) {
        console.error('[EuraFlow] 打开上架弹窗失败:', error);
        alert('打开上架配置失败，请稍后重试');
      }
    });

    buttonSection.appendChild(button);
    displayElement.appendChild(priceSection);
    displayElement.appendChild(buttonSection);

    // 注入到目标容器内的第一个位置
    targetContainer.insertBefore(displayElement, targetContainer.firstChild);
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
 * 获取目标容器元素（用于检查页面是否准备好）
 */
export function getTargetContainer(): Element | null {
  return document.querySelector(DISPLAY_CONFIG.targetContainer);
}
