/**
 * 内容脚本入口
 *
 * 此脚本会被注入到OZON页面（商品列表页或详情页）
 */

import { DataFusionEngine } from './fusion/engine';
import { ProductCollector } from './collector';
import { FilterEngine } from './filter';
import { getCollectorConfig, getFilterConfig } from '../shared/storage';
import { ControlPanel } from './components/ControlPanel';
import { RealPriceCalculator } from './price-calculator';
import { ProductListEnhancer } from './list-enhancer';

// 模块级别的采集器引用（用于自动采集消息处理）
let globalCollector: ProductCollector | null = null;

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

    // 1. 初始化商品列表增强器（检测上品帮，注入数据面板）
    const listEnhancer = new ProductListEnhancer();
    listEnhancer.init().catch(error => {
      console.error('[Main] 商品列表增强器初始化失败:', error);
    });

    // 2. 创建数据融合引擎（直接提取OZON原生数据 + 批量调用上品帮API）
    const fusionEngine = new DataFusionEngine();

    // 3. 加载采集配置
    const collectorConfig = await getCollectorConfig();

    // 4. 创建采集器（API配置和上传由 ControlPanel 负责）
    const collector = new ProductCollector(fusionEngine);
    globalCollector = collector;  // 保存到全局引用

    // 5. 加载过滤配置并注入到采集器
    const filterConfig = await getFilterConfig();
    const filterEngine = new FilterEngine(filterConfig);
    collector.setFilterEngine(filterEngine);

    if (__DEBUG__) {
      const hasFilter = filterEngine.hasAnyFilter();
      console.log('[Main] 过滤配置已加载:', {
        hasFilter,
        config: filterConfig
      });
    }

    // 6. 创建并挂载控制面板
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

// ========== 消息监听器：响应 background 的请求 ==========
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 变体提取请求
  if (message.type === 'EXTRACT_PRODUCT_DATA') {
    // 动态导入并执行
    import('./parsers/product-detail').then(async (module) => {
      try {
        const productData = await module.extractProductData();
        sendResponse({ success: true, data: productData });
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

  // 自动采集请求（从 auto-collector 发送）
  if (message.type === 'AUTO_COLLECT') {
    handleAutoCollect(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 停止采集请求
  if (message.type === 'STOP_COLLECTION') {
    if (globalCollector) {
      globalCollector.stopCollection();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: '采集器未初始化' });
    }
    return true;
  }
});

/**
 * 处理自动采集请求
 */
async function handleAutoCollect(data: { targetCount: number; autoMode?: boolean }): Promise<{ products: any[] }> {
  const { targetCount } = data;

  // 检查采集器是否已初始化
  if (!globalCollector) {
    // 如果页面刚加载，采集器可能还未初始化，等待一下
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (!globalCollector) {
      throw new Error('采集器未初始化（请确保页面为商品列表页）');
    }
  }

  // 检查是否已在运行
  if (globalCollector.isRunning) {
    throw new Error('采集已在进行中');
  }

  console.log(`[AutoCollect] 开始自动采集，目标数量: ${targetCount}`);

  // 执行采集
  const products = await globalCollector.startCollection(targetCount);

  console.log(`[AutoCollect] 采集完成，共 ${products.length} 个商品`);

  return { products };
}
