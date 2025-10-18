/**
 * 内容脚本入口
 *
 * 此脚本会被注入到OZON商品列表页面
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ShangpinbangParser } from './parsers/shangpinbang';
import { MaoziErpParser } from './parsers/maozi-erp';
import { DataFusionEngine } from './fusion/engine';
import { ProductCollector } from './collector';
import { ApiClient } from '../shared/api-client';
import { getApiConfig, getCollectorConfig } from '../shared/storage';
import { ControlPanel } from './components/ControlPanel';

console.log('[EuraFlow] Content script loaded');

// 检测当前页面是否为OZON商品列表页面
function isProductListPage(): boolean {
  const url = window.location.href;
  return url.includes('ozon.ru') &&
         (url.includes('/category/') || url.includes('/search/'));
}

// 等待DOM加载完成
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  console.log('[EuraFlow] Initializing...');

  if (!isProductListPage()) {
    console.log('[EuraFlow] Not a product list page, skipping initialization');
    return;
  }

  console.log('[EuraFlow] Product list page detected');

  // 1. 初始化解析器
  const parsers = [
    new ShangpinbangParser(),
    new MaoziErpParser()
  ];

  // 2. 创建融合引擎
  const fusionEngine = new DataFusionEngine(parsers);

  // 3. 加载配置
  const apiConfig = await getApiConfig();
  const collectorConfig = await getCollectorConfig();

  // 4. 创建API客户端
  const apiClient = new ApiClient(apiConfig.apiUrl, apiConfig.apiKey);

  // 5. 创建采集器
  const collector = new ProductCollector(fusionEngine, apiClient, collectorConfig);

  // 6. 创建并挂载控制面板
  const panelContainer = document.createElement('div');
  panelContainer.id = 'ef-control-panel-root';
  document.body.appendChild(panelContainer);

  const root = ReactDOM.createRoot(panelContainer);
  root.render(
    React.createElement(ControlPanel, {
      fusionEngine,
      collector,
      config: collectorConfig
    })
  );

  console.log('[EuraFlow] Initialization complete');
}

// 导出类型（供TypeScript使用）
export {};
