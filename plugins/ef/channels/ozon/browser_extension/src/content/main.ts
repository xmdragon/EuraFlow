/**
 * 内容脚本入口
 *
 * 此脚本会被注入到OZON页面（商品列表页或详情页）
 */

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

async function init() {
  // 分支处理：商品详情页 vs 商品列表页
  if (isProductDetailPage()) {
    // 初始化真实售价计算器（等待Vue渲染完成）
    const priceCalculator = new RealPriceCalculator();
    await priceCalculator.init();
    return;
  }

  if (isProductListPage()) {

    // 1. 创建数据融合引擎（直接提取OZON原生数据 + 批量调用上品帮API）
    const fusionEngine = new DataFusionEngine();

    // 2. 加载采集配置
    const collectorConfig = await getCollectorConfig();

    // 3. 创建采集器（API配置和上传由 ControlPanel 负责）
    const collector = new ProductCollector(fusionEngine);

    // 4. 创建并挂载控制面板
    ControlPanel({
      fusionEngine,
      collector,
      config: collectorConfig
    });

    return;
  }
}

// 导出 onExecute 函数（Vite CRXJS 插件要求）
// 注意：不要在这里直接调用 onExecute()，loader 会调用它
export function onExecute() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

// ========== 消息监听器：响应 background 的变体提取请求 ==========
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PRODUCT_DATA') {
    console.log('[Content] 收到变体提取请求');

    // 动态导入并执行
    import('./parsers/product-detail').then(async (module) => {
      try {
        console.log('[Content] 开始调用 extractProductData()');
        const productData = await module.extractProductData();
        console.log('[Content] extractProductData() 返回结果:', productData);
        console.log('[Content] 变体提取成功:', productData.variants?.length || 0, '个变体');
        console.log('[Content] 准备发送响应给 background');
        sendResponse({ success: true, data: productData });
        console.log('[Content] 响应已发送');
      } catch (error: any) {
        console.error('[Content] 变体提取失败:', error);
        sendResponse({ success: false, error: error.message });
      }
    }).catch(error => {
      console.error('[Content] 模块加载失败:', error);
      sendResponse({ success: false, error: error.message });
    });

    return true; // 异步响应
  }
});
