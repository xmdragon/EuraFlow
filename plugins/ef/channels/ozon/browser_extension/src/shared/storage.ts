import type { ApiConfig, CollectorConfig } from './types';

/**
 * 浏览器扩展存储工具
 *
 * 使用 chrome.storage.sync 实现配置持久化和跨设备同步
 */

const DEFAULT_API_CONFIG: ApiConfig = {
  apiUrl: '',
  apiKey: '',
  autoUpload: true
};

const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  targetCount: 100,
  scrollDelay: 5000,
  scrollWaitTime: 1000
};

/**
 * 获取API配置
 */
export async function getApiConfig(): Promise<ApiConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiUrl', 'apiKey', 'autoUpload'], (result: { [key: string]: any }) => {
      resolve({
        apiUrl: result.apiUrl || DEFAULT_API_CONFIG.apiUrl,
        apiKey: result.apiKey || DEFAULT_API_CONFIG.apiKey,
        autoUpload: result.autoUpload !== undefined ? result.autoUpload : DEFAULT_API_CONFIG.autoUpload
      });
    });
  });
}

/**
 * 保存API配置
 */
export async function setApiConfig(config: Partial<ApiConfig>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(config, () => {
      resolve();
    });
  });
}

/**
 * 获取采集配置
 */
export async function getCollectorConfig(): Promise<CollectorConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['targetCount', 'scrollDelay', 'scrollWaitTime'], (result: { [key: string]: any }) => {
      resolve({
        targetCount: result.targetCount || DEFAULT_COLLECTOR_CONFIG.targetCount,
        scrollDelay: result.scrollDelay || DEFAULT_COLLECTOR_CONFIG.scrollDelay,
        scrollWaitTime: result.scrollWaitTime || DEFAULT_COLLECTOR_CONFIG.scrollWaitTime
      });
    });
  });
}

/**
 * 保存采集配置
 */
export async function setCollectorConfig(config: Partial<CollectorConfig>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(config, () => {
      resolve();
    });
  });
}

/**
 * 测试API连接
 */
export async function testApiConnection(apiUrl: string, apiKey: string): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      data: { apiUrl, apiKey }
    });

    return response.success;
  } catch (error) {
    console.error('[Storage] Test connection failed:', error);
    return false;
  }
}
