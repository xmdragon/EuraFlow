/**
 * 自动采集模块
 *
 * 功能：
 * - 从 EuraFlow 后端获取待采集地址队列
 * - 自动打开标签页进行商品采集
 * - 采集完成后上传数据并更新状态
 * - 循环处理下一个地址
 *
 * 使用流程：
 * 1. 用户在 Web 管理后台配置采集地址
 * 2. 用户在插件中点击"开始自动采集"
 * 3. 插件轮流打开地址进行采集
 * 4. 用户可随时停止采集
 */

import { createEuraflowApi, type CollectionSource } from '../shared/api/euraflow-api';
import { getAutoCollectConfig } from '../shared/storage';

/**
 * 自动采集状态
 */
export interface AutoCollectorState {
  isRunning: boolean;
  currentSource: CollectionSource | null;
  currentTabId: number | null;
  collectedCount: number;
  totalSources: number;
  processedSources: number;
  errors: string[];
  startTime: number | null;
}

/**
 * 自动采集器（单例）
 */
class AutoCollector {
  private state: AutoCollectorState = {
    isRunning: false,
    currentSource: null,
    currentTabId: null,
    collectedCount: 0,
    totalSources: 0,
    processedSources: 0,
    errors: [],
    startTime: null,
  };

  private apiUrl: string = '';
  private apiKey: string = '';
  private stopRequested: boolean = false;

  // 采集配置（运行时从存储读取）
  private config = {
    collectionTimeoutMs: 10 * 60 * 1000, // 单个地址采集超时：默认10分钟（运行时更新）
    tabCloseDelay: 2000,                 // 关闭标签页前的等待时间：2秒
    nextSourceDelay: 3000,               // 处理下一个地址前的等待时间：3秒
    maxConsecutiveErrors: 3,             // 连续错误次数上限
  };

  /**
   * 获取当前状态
   */
  getState(): AutoCollectorState {
    return { ...this.state };
  }

  /**
   * 开始自动采集
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      throw new Error('自动采集已在运行中');
    }

    // 获取 API 配置
    const apiConfig = await this.getApiConfig();
    if (!apiConfig.apiUrl || !apiConfig.apiKey) {
      throw new Error('请先配置 EuraFlow API 地址和密钥');
    }

    // 获取自动采集配置
    const autoCollectConfig = await getAutoCollectConfig();
    this.config.collectionTimeoutMs = (autoCollectConfig.collectionTimeoutMinutes || 10) * 60 * 1000;
    console.log(`[AutoCollector] 采集超时设置为 ${autoCollectConfig.collectionTimeoutMinutes || 10} 分钟`);

    this.apiUrl = apiConfig.apiUrl;
    this.apiKey = apiConfig.apiKey;
    this.stopRequested = false;

    // 初始化状态
    this.state = {
      isRunning: true,
      currentSource: null,
      currentTabId: null,
      collectedCount: 0,
      totalSources: 0,
      processedSources: 0,
      errors: [],
      startTime: Date.now(),
    };

    console.log('[AutoCollector] 开始自动采集');

    // 开始采集循环
    this.runCollectionLoop();
  }

  /**
   * 停止自动采集
   */
  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    console.log('[AutoCollector] 停止采集请求');
    this.stopRequested = true;

    // 如果当前有标签页在采集，发送停止消息
    if (this.state.currentTabId) {
      try {
        await chrome.tabs.sendMessage(this.state.currentTabId, {
          type: 'STOP_COLLECTION'
        });
      } catch {
        // 标签页可能已关闭
      }
    }

    this.state.isRunning = false;
  }

  /**
   * 采集循环
   */
  private async runCollectionLoop(): Promise<void> {
    let consecutiveErrors = 0;

    while (!this.stopRequested) {
      try {
        // 1. 获取下一个待采集地址
        console.log('[AutoCollector] 正在获取下一个待采集地址...');
        const source = await this.getNextSource();

        if (!source) {
          console.log('[AutoCollector] 没有待采集的地址，停止');
          break;
        }

        this.state.currentSource = source;
        console.log(`[AutoCollector] 开始采集: ${source.display_name || source.source_path} (ID: ${source.id})`);

        // 2. 更新状态为"采集中"
        console.log(`[AutoCollector] 更新状态为 collecting...`);
        await this.updateSourceStatus(source.id, 'collecting');

        // 3. 打开标签页并执行采集
        console.log(`[AutoCollector] 打开标签页并执行采集...`);
        const result = await this.collectFromSource(source);
        console.log(`[AutoCollector] 采集完成，获取 ${result.products.length} 个商品`);

        // 4. 上传采集结果
        if (result.products.length > 0) {
          console.log(`[AutoCollector] 上传 ${result.products.length} 个商品...`);
          await this.uploadProducts(result.products, source);
          this.state.collectedCount += result.products.length;
          console.log(`[AutoCollector] 上传成功`);
        } else {
          console.log(`[AutoCollector] 没有采集到商品，跳过上传`);
        }

        // 5. 更新状态为"完成"
        console.log(`[AutoCollector] 更新状态为 completed...`);
        await this.updateSourceStatus(source.id, 'completed', result.products.length);

        // 6. 关闭标签页
        await this.closeCollectionTab();

        this.state.processedSources++;
        consecutiveErrors = 0;  // 重置连续错误计数

        console.log(`[AutoCollector] 地址处理完成，等待 ${this.config.nextSourceDelay}ms 后处理下一个`);

        // 7. 等待一段时间再处理下一个
        await this.sleep(this.config.nextSourceDelay);

      } catch (error: any) {
        console.error('[AutoCollector] 采集错误:', error.message, error.stack);
        this.state.errors.push(error.message);

        // 更新状态为"失败"
        if (this.state.currentSource) {
          await this.updateSourceStatus(
            this.state.currentSource.id,
            'failed',
            0,
            error.message
          );
        }

        // 关闭可能打开的标签页
        await this.closeCollectionTab();

        consecutiveErrors++;

        // 连续错误过多，停止采集
        if (consecutiveErrors >= this.config.maxConsecutiveErrors) {
          console.error('[AutoCollector] 连续错误过多，停止采集');
          break;
        }

        // 等待更长时间后重试
        await this.sleep(this.config.nextSourceDelay * 2);
      }
    }

    // 采集结束
    this.state.isRunning = false;
    this.state.currentSource = null;
    this.state.currentTabId = null;

    console.log('[AutoCollector] 采集循环结束', {
      processed: this.state.processedSources,
      collected: this.state.collectedCount,
      errors: this.state.errors.length,
    });
  }

  /**
   * 获取下一个待采集的地址
   */
  private async getNextSource(): Promise<CollectionSource | null> {
    const api = createEuraflowApi(this.apiUrl, this.apiKey);
    return api.getNextCollectionSource();
  }

  /**
   * 更新采集源状态
   */
  private async updateSourceStatus(
    sourceId: number,
    status: 'collecting' | 'completed' | 'failed',
    productCount?: number,
    error?: string
  ): Promise<void> {
    try {
      const api = createEuraflowApi(this.apiUrl, this.apiKey);
      await api.updateCollectionSourceStatus(sourceId, status, productCount, error);
    } catch (err: any) {
      console.error('[AutoCollector] 更新状态失败:', err.message);
    }
  }

  /**
   * 从指定地址采集商品
   */
  private async collectFromSource(source: CollectionSource): Promise<{ products: any[] }> {
    // 1. 打开新标签页
    const tab = await chrome.tabs.create({
      url: source.source_url,
      active: false,  // 不激活，在后台运行
    });

    if (!tab.id) {
      throw new Error('无法创建标签页');
    }

    this.state.currentTabId = tab.id;

    // 2. 等待页面加载完成
    await this.waitForTabLoaded(tab.id);

    // 3. 等待内容脚本准备就绪（给页面一些加载时间）
    await this.sleep(3000);

    // 4. 发送采集命令并等待结果
    const result = await this.sendCollectionCommand(tab.id, source.target_count);

    return result;
  }

  /**
   * 等待标签页加载完成
   */
  private waitForTabLoaded(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        console.log('[AutoCollector] 标签页加载超时，尝试继续...');
        // 超时后不 reject，而是继续尝试（页面可能部分加载成功）
        resolve();
      }, 30000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          console.log('[AutoCollector] 标签页加载完成');
          resolve();
        }
      };

      // 先检查当前状态，可能已经加载完成
      chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          console.log('[AutoCollector] 标签页已加载完成');
          resolve();
        }
      }).catch(() => {
        // 标签页可能已关闭，忽略
      });

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  /**
   * 发送采集命令到内容脚本
   */
  private async sendCollectionCommand(
    tabId: number,
    targetCount: number
  ): Promise<{ products: any[] }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('采集超时'));
      }, this.config.collectionTimeoutMs);

      // 发送采集命令
      chrome.tabs.sendMessage(tabId, {
        type: 'AUTO_COLLECT',
        data: {
          targetCount,
          autoMode: true,  // 标记为自动采集模式
        }
      }, (response) => {
        clearTimeout(timeout);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.success) {
          reject(new Error(response?.error || '采集失败'));
          return;
        }

        resolve({
          products: response.data?.products || [],
        });
      });
    });
  }

  /**
   * 上传采集的商品数据
   */
  private async uploadProducts(products: any[], source: CollectionSource): Promise<void> {
    if (products.length === 0) {
      return;
    }

    const api = createEuraflowApi(this.apiUrl, this.apiKey);

    // 使用地址路径作为批次名称
    const batchName = source.source_path;

    await api.uploadProducts(products, batchName, source.id);

    console.log(`[AutoCollector] 上传成功: ${products.length} 个商品 (批次: ${batchName})`);
  }

  /**
   * 关闭采集标签页
   */
  private async closeCollectionTab(): Promise<void> {
    if (!this.state.currentTabId) {
      return;
    }

    try {
      // 等待一小段时间确保数据已保存
      await this.sleep(this.config.tabCloseDelay);

      await chrome.tabs.remove(this.state.currentTabId);
    } catch {
      // 标签页可能已关闭
    }

    this.state.currentTabId = null;
  }

  /**
   * 获取 API 配置
   */
  private getApiConfig(): Promise<{ apiUrl: string; apiKey: string }> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['apiUrl', 'apiKey'], (result) => {
        resolve({
          apiUrl: result.apiUrl || '',
          apiKey: result.apiKey || '',
        });
      });
    });
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出单例实例
export const autoCollector = new AutoCollector();

/**
 * 注册消息处理器
 */
export function registerAutoCollectorHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'AUTO_COLLECTOR_START') {
      autoCollector.start()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === 'AUTO_COLLECTOR_STOP') {
      autoCollector.stop()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === 'AUTO_COLLECTOR_STATUS') {
      sendResponse({ success: true, data: autoCollector.getState() });
      return true;
    }
  });
}
