/**
 * EuraFlow 样式注入器
 * 确保样式只注入一次，避免重复
 */

import variablesCSS from './variables.css?inline';
import commonCSS from './common.css?inline';
import controlPanelCSS from './control-panel.css?inline';
import priceCalculatorCSS from './price-calculator.css?inline';
import publishModalCSS from './publish-modal.css?inline';

let stylesInjected = false;

/**
 * 注入 EuraFlow 样式到页面
 * 使用严格的命名空间（ef- 前缀）确保不污染 OZON 页面
 */
export function injectEuraflowStyles(): void {
  // 已注入，跳过
  if (stylesInjected) {
    return;
  }

  // 检查是否已存在
  const styleId = 'euraflow-extension-styles';
  if (document.getElementById(styleId)) {
    stylesInjected = true;
    return;
  }

  // 合并所有 CSS
  const allCSS = [
    variablesCSS,
    commonCSS,
    controlPanelCSS,
    priceCalculatorCSS,
    publishModalCSS
  ].join('\n');

  // 创建 <style> 标签
  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  styleElement.textContent = allCSS;

  // 注入到 <head>
  document.head.appendChild(styleElement);

  stylesInjected = true;
}

/**
 * 移除注入的样式（用于清理）
 */
export function removeEuraflowStyles(): void {
  const styleElement = document.getElementById('euraflow-extension-styles');
  if (styleElement) {
    styleElement.remove();
    stylesInjected = false;
  }
}
