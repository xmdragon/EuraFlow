/**
 * 内容脚本入口
 *
 * 此脚本会被注入到OZON页面（商品列表页或详情页）
 */

import { ShangpinbangParser } from './parsers/shangpinbang';
import { MaoziErpParser } from './parsers/maozi-erp';
import { DataFusionEngine } from './fusion/engine';
import { ProductCollector } from './collector';
import { getCollectorConfig } from '../shared/storage';
import { ControlPanel } from './components/ControlPanel';
import { RealPriceCalculator } from './price-calculator';

// 检测当前页面是否为商品列表页
function isProductListPage(): boolean {
  return window.location.href.includes('ozon.ru') &&
         !window.location.href.includes('/product/');
}

// 检测当前页面是否为商品详情页
function isProductDetailPage(): boolean {
  return window.location.href.includes('/product/');
}

// 等待DOM加载完成
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  // 分支处理：商品详情页 vs 商品列表页
  if (isProductDetailPage()) {
    // 初始化真实售价计算器
    const priceCalculator = new RealPriceCalculator();
    priceCalculator.init();
    return;
  }

  if (isProductListPage()) {

    // 1. 初始化解析器
    const parsers = [
      new ShangpinbangParser(),
      new MaoziErpParser()
    ];

    // 2. 创建融合引擎
    const fusionEngine = new DataFusionEngine(parsers);

    // 3. 加载采集配置
    const collectorConfig = await getCollectorConfig();

    // 4. 创建采集器（API配置和上传由 ControlPanel 负责）
    const collector = new ProductCollector(fusionEngine, collectorConfig);

    // 6. 创建并挂载控制面板
    ControlPanel({
      fusionEngine,
      collector,
      config: collectorConfig
    });

    return;
  }
}

// 导出类型（供TypeScript使用）
export {};
