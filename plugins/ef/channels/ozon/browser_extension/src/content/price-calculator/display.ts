/**
 * OZON 真实售价计算器 - 显示注入
 *
 * 在页面上注入和管理价格显示元素
 */

// ========== 配置常量 ==========
const DISPLAY_CONFIG = {
  // 选择器
  targetContainer: '.pdp_b8i.pdp_i8b',
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
 * 注入或更新显示元素
 * @param message - 要显示的消息（如 "真实售价：120.00 ¥"）
 */
export function injectOrUpdateDisplay(message: string | null): void {
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
    // 更新现有元素
    displayElement.textContent = message;
  } else {
    // 创建新元素
    displayElement = document.createElement('div');
    displayElement.id = DISPLAY_CONFIG.injectedElementId;

    // 应用样式
    Object.assign(displayElement.style, DISPLAY_CONFIG.style);

    // 设置文本
    displayElement.textContent = message;

    // 注入到目标容器之前
    targetContainer.parentNode?.insertBefore(displayElement, targetContainer);
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
