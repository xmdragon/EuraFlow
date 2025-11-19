import type { ApiConfig, CollectorConfig, ShangpinbangConfig, DataPanelConfig, RateLimitConfig } from './types';
import { DEFAULT_FIELDS } from './types';

/**
 * 浏览器扩展存储工具
 *
 * 使用 chrome.storage.sync 实现配置持久化和跨设备同步
 */

const DEFAULT_API_CONFIG: ApiConfig = {
  apiUrl: '',
  apiKey: ''
};

const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  targetCount: 100
};

export async function getApiConfig(): Promise<ApiConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiUrl', 'apiKey'], (result: { [key: string]: any }) => {
      resolve({
        apiUrl: result.apiUrl || DEFAULT_API_CONFIG.apiUrl,
        apiKey: result.apiKey || DEFAULT_API_CONFIG.apiKey
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

export async function getCollectorConfig(): Promise<CollectorConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['targetCount'], (result: { [key: string]: any }) => {
      resolve({
        targetCount: result.targetCount || DEFAULT_COLLECTOR_CONFIG.targetCount
      });
    });
  });
}

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

// ========== 上品帮配置存储 ==========

const DEFAULT_SHANGPINBANG_CONFIG: ShangpinbangConfig = {
  phone: '',
  password: '',
  token: undefined,
  tokenExpiry: undefined
};

/**
 * 获取上品帮配置
 */
export async function getShangpinbangConfig(): Promise<ShangpinbangConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['spbPhone', 'spbPassword', 'spbToken', 'spbTokenExpiry'], (result: { [key: string]: any }) => {
      resolve({
        phone: result.spbPhone || DEFAULT_SHANGPINBANG_CONFIG.phone,
        password: result.spbPassword || DEFAULT_SHANGPINBANG_CONFIG.password,
        token: result.spbToken || DEFAULT_SHANGPINBANG_CONFIG.token,
        tokenExpiry: result.spbTokenExpiry || DEFAULT_SHANGPINBANG_CONFIG.tokenExpiry
      });
    });
  });
}

/**
 * 保存上品帮配置
 */
export async function setShangpinbangConfig(config: Partial<ShangpinbangConfig>): Promise<void> {
  return new Promise((resolve) => {
    const storageData: { [key: string]: any } = {};

    if (config.phone !== undefined) storageData.spbPhone = config.phone;
    if (config.password !== undefined) storageData.spbPassword = config.password;
    if (config.token !== undefined) storageData.spbToken = config.token;
    if (config.tokenExpiry !== undefined) storageData.spbTokenExpiry = config.tokenExpiry;

    chrome.storage.sync.set(storageData, () => {
      resolve();
    });
  });
}

/**
 * 获取上品帮Token（快捷方法）
 */
export async function getShangpinbangToken(): Promise<string | undefined> {
  const config = await getShangpinbangConfig();
  return config.token;
}

// ========== 数据面板配置存储 ==========

const DEFAULT_DATA_PANEL_CONFIG: DataPanelConfig = {
  visibleFields: [...DEFAULT_FIELDS],  // 默认显示的字段
};

/**
 * 获取数据面板配置
 */
export async function getDataPanelConfig(): Promise<DataPanelConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['dataPanelVisibleFields'], (result: { [key: string]: any }) => {
      resolve({
        visibleFields: result.dataPanelVisibleFields || DEFAULT_DATA_PANEL_CONFIG.visibleFields
      });
    });
  });
}

/**
 * 保存数据面板配置
 */
export async function setDataPanelConfig(config: Partial<DataPanelConfig>): Promise<void> {
  return new Promise((resolve) => {
    const storageData: { [key: string]: any } = {};

    if (config.visibleFields !== undefined) {
      storageData.dataPanelVisibleFields = config.visibleFields;
    }

    chrome.storage.sync.set(storageData, () => {
      resolve();
    });
  });
}

// ========== OZON API 频率限制配置存储 ==========

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  mode: 'random',           // 默认随机频率
  fixedDelay: 3000,         // 默认固定延迟3秒（原1秒太快，易被限流）
  randomDelayMin: 2000,     // 默认随机延迟最小2秒（原500ms，调整为更自然的间隔）
  randomDelayMax: 5000,     // 默认随机延迟最大5秒（原2秒，模拟真实用户浏览速度）
  enabled: true,            // 默认启用频率限制
};

/**
 * 获取OZON API频率限制配置
 */
export async function getRateLimitConfig(): Promise<RateLimitConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ['rateLimitMode', 'rateLimitFixedDelay', 'rateLimitRandomMin', 'rateLimitRandomMax', 'rateLimitEnabled'],
      (result: { [key: string]: any }) => {
        resolve({
          mode: result.rateLimitMode || DEFAULT_RATE_LIMIT_CONFIG.mode,
          fixedDelay: result.rateLimitFixedDelay || DEFAULT_RATE_LIMIT_CONFIG.fixedDelay,
          randomDelayMin: result.rateLimitRandomMin || DEFAULT_RATE_LIMIT_CONFIG.randomDelayMin,
          randomDelayMax: result.rateLimitRandomMax || DEFAULT_RATE_LIMIT_CONFIG.randomDelayMax,
          enabled: result.rateLimitEnabled !== undefined ? result.rateLimitEnabled : DEFAULT_RATE_LIMIT_CONFIG.enabled,
        });
      }
    );
  });
}

/**
 * 保存OZON API频率限制配置
 */
export async function setRateLimitConfig(config: Partial<RateLimitConfig>): Promise<void> {
  return new Promise((resolve) => {
    const storageData: { [key: string]: any } = {};

    if (config.mode !== undefined) storageData.rateLimitMode = config.mode;
    if (config.fixedDelay !== undefined) storageData.rateLimitFixedDelay = config.fixedDelay;
    if (config.randomDelayMin !== undefined) storageData.rateLimitRandomMin = config.randomDelayMin;
    if (config.randomDelayMax !== undefined) storageData.rateLimitRandomMax = config.randomDelayMax;
    if (config.enabled !== undefined) storageData.rateLimitEnabled = config.enabled;

    chrome.storage.sync.set(storageData, () => {
      resolve();
    });
  });
}
