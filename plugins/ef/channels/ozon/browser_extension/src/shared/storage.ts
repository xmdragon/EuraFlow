import type { ApiConfig, AuthConfig, CollectorConfig, ShangpinbangConfig, DataPanelConfig, RateLimitConfig, FilterConfig, AutoCollectConfig } from './types';
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

const DEFAULT_AUTH_CONFIG: AuthConfig = {
  apiUrl: '',
  username: '',
  accessToken: undefined,
  refreshToken: undefined,
  tokenExpiry: undefined
};

const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  targetCount: 100
};

// ========== 旧版 API Key 配置（已废弃，保留用于兼容） ==========

export async function getApiConfig(): Promise<ApiConfig> {
  const result = await chrome.storage.sync.get(['apiUrl', 'apiKey']);
  return {
    apiUrl: result.apiUrl || DEFAULT_API_CONFIG.apiUrl,
    apiKey: result.apiKey || DEFAULT_API_CONFIG.apiKey
  };
}

/**
 * 保存API配置（已废弃）
 */
export async function setApiConfig(config: Partial<ApiConfig>): Promise<void> {
  await chrome.storage.sync.set(config);
}

// ========== 新版认证配置 ==========

/**
 * 获取认证配置
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  const result = await chrome.storage.sync.get([
    'authApiUrl',
    'authUsername',
    'authAccessToken',
    'authRefreshToken',
    'authTokenExpiry'
  ]);
  return {
    apiUrl: result.authApiUrl || DEFAULT_AUTH_CONFIG.apiUrl,
    username: result.authUsername || DEFAULT_AUTH_CONFIG.username,
    accessToken: result.authAccessToken || DEFAULT_AUTH_CONFIG.accessToken,
    refreshToken: result.authRefreshToken || DEFAULT_AUTH_CONFIG.refreshToken,
    tokenExpiry: result.authTokenExpiry || DEFAULT_AUTH_CONFIG.tokenExpiry
  };
}

/**
 * 保存认证配置
 */
export async function setAuthConfig(config: Partial<AuthConfig>): Promise<void> {
  const storageData: { [key: string]: any } = {};

  if (config.apiUrl !== undefined) storageData.authApiUrl = config.apiUrl;
  if (config.username !== undefined) storageData.authUsername = config.username;
  if (config.accessToken !== undefined) storageData.authAccessToken = config.accessToken;
  if (config.refreshToken !== undefined) storageData.authRefreshToken = config.refreshToken;
  if (config.tokenExpiry !== undefined) storageData.authTokenExpiry = config.tokenExpiry;

  await chrome.storage.sync.set(storageData);
}

/**
 * 清除认证信息（登出）
 */
export async function clearAuthConfig(): Promise<void> {
  await chrome.storage.sync.remove([
    'authAccessToken',
    'authRefreshToken',
    'authTokenExpiry'
  ]);
}

/**
 * 检查是否已登录（有有效的 access token）
 */
export async function isAuthenticated(): Promise<boolean> {
  const config = await getAuthConfig();
  if (!config.accessToken) {
    return false;
  }
  // 检查 token 是否过期（提前 60 秒判断）
  if (config.tokenExpiry && Date.now() > config.tokenExpiry - 60000) {
    return false;
  }
  return true;
}

/**
 * 获取 Access Token（快捷方法）
 */
export async function getAccessToken(): Promise<string | undefined> {
  const config = await getAuthConfig();
  return config.accessToken;
}

/**
 * 获取 Refresh Token（快捷方法）
 */
export async function getRefreshToken(): Promise<string | undefined> {
  const config = await getAuthConfig();
  return config.refreshToken;
}

export async function getCollectorConfig(): Promise<CollectorConfig> {
  const result = await chrome.storage.sync.get(['targetCount']);
  return {
    targetCount: result.targetCount || DEFAULT_COLLECTOR_CONFIG.targetCount
  };
}

export async function setCollectorConfig(config: Partial<CollectorConfig>): Promise<void> {
  await chrome.storage.sync.set(config);
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
  const result = await chrome.storage.sync.get(['spbPhone', 'spbPassword', 'spbToken', 'spbTokenExpiry']);
  return {
    phone: result.spbPhone || DEFAULT_SHANGPINBANG_CONFIG.phone,
    password: result.spbPassword || DEFAULT_SHANGPINBANG_CONFIG.password,
    token: result.spbToken || DEFAULT_SHANGPINBANG_CONFIG.token,
    tokenExpiry: result.spbTokenExpiry || DEFAULT_SHANGPINBANG_CONFIG.tokenExpiry
  };
}

/**
 * 保存上品帮配置
 */
export async function setShangpinbangConfig(config: Partial<ShangpinbangConfig>): Promise<void> {
  const storageData: { [key: string]: any } = {};

  if (config.phone !== undefined) storageData.spbPhone = config.phone;
  if (config.password !== undefined) storageData.spbPassword = config.password;
  if (config.token !== undefined) storageData.spbToken = config.token;
  if (config.tokenExpiry !== undefined) storageData.spbTokenExpiry = config.tokenExpiry;

  await chrome.storage.sync.set(storageData);
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
  const result = await chrome.storage.sync.get(['dataPanelVisibleFields']);
  return {
    visibleFields: result.dataPanelVisibleFields || DEFAULT_DATA_PANEL_CONFIG.visibleFields
  };
}

/**
 * 保存数据面板配置
 */
export async function setDataPanelConfig(config: Partial<DataPanelConfig>): Promise<void> {
  const storageData: { [key: string]: any } = {};

  if (config.visibleFields !== undefined) {
    storageData.dataPanelVisibleFields = config.visibleFields;
  }

  await chrome.storage.sync.set(storageData);
}

// ========== OZON API 频率限制配置存储 ==========

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  mode: 'random',           // 默认随机频率
  fixedDelay: 100,          // 默认固定延迟100ms（快速响应 + 限流器内部有抖动）
  randomDelayMin: 50,       // 默认随机延迟最小50ms（配合3并发，模拟快速切换商品）
  randomDelayMax: 150,      // 默认随机延迟最大150ms（限流器会添加±50ms抖动）
  enabled: true,            // 默认启用频率限制
};

/**
 * 获取OZON API频率限制配置
 */
export async function getRateLimitConfig(): Promise<RateLimitConfig> {
  const result = await chrome.storage.sync.get(
    ['rateLimitMode', 'rateLimitFixedDelay', 'rateLimitRandomMin', 'rateLimitRandomMax', 'rateLimitEnabled']
  );
  return {
    mode: result.rateLimitMode || DEFAULT_RATE_LIMIT_CONFIG.mode,
    fixedDelay: result.rateLimitFixedDelay || DEFAULT_RATE_LIMIT_CONFIG.fixedDelay,
    randomDelayMin: result.rateLimitRandomMin || DEFAULT_RATE_LIMIT_CONFIG.randomDelayMin,
    randomDelayMax: result.rateLimitRandomMax || DEFAULT_RATE_LIMIT_CONFIG.randomDelayMax,
    enabled: result.rateLimitEnabled !== undefined ? result.rateLimitEnabled : DEFAULT_RATE_LIMIT_CONFIG.enabled,
  };
}

/**
 * 保存OZON API频率限制配置
 */
export async function setRateLimitConfig(config: Partial<RateLimitConfig>): Promise<void> {
  const storageData: { [key: string]: any } = {};

  if (config.mode !== undefined) storageData.rateLimitMode = config.mode;
  if (config.fixedDelay !== undefined) storageData.rateLimitFixedDelay = config.fixedDelay;
  if (config.randomDelayMin !== undefined) storageData.rateLimitRandomMin = config.randomDelayMin;
  if (config.randomDelayMax !== undefined) storageData.rateLimitRandomMax = config.randomDelayMax;
  if (config.enabled !== undefined) storageData.rateLimitEnabled = config.enabled;

  await chrome.storage.sync.set(storageData);
}

// ========== 采集过滤配置存储 ==========

const DEFAULT_FILTER_CONFIG: FilterConfig = {
  priceMin: undefined,
  priceMax: undefined,
  monthlySalesMin: undefined,
  weightMax: undefined,
  listingDateAfter: undefined,
  sellerMode: 'ALL',
  followSellerMax: undefined
};

/**
 * 获取采集过滤配置
 */
export async function getFilterConfig(): Promise<FilterConfig> {
  const result = await chrome.storage.sync.get([
    'filterPriceMin',
    'filterPriceMax',
    'filterMonthlySalesMin',
    'filterWeightMax',
    'filterListingDateAfter',
    'filterSellerMode',
    'filterFollowSellerMax'
  ]);

  return {
    priceMin: result.filterPriceMin ?? undefined,
    priceMax: result.filterPriceMax ?? undefined,
    monthlySalesMin: result.filterMonthlySalesMin ?? undefined,
    weightMax: result.filterWeightMax ?? undefined,
    listingDateAfter: result.filterListingDateAfter ?? undefined,
    sellerMode: result.filterSellerMode ?? DEFAULT_FILTER_CONFIG.sellerMode,
    followSellerMax: result.filterFollowSellerMax ?? undefined
  };
}

/**
 * 保存采集过滤配置
 */
export async function setFilterConfig(config: Partial<FilterConfig>): Promise<void> {
  const storageData: { [key: string]: any } = {};

  // 处理数字和字符串字段，undefined 转为 null 存储（chrome.storage 不支持 undefined）
  if (config.priceMin !== undefined) {
    storageData.filterPriceMin = config.priceMin;
  } else if ('priceMin' in config) {
    storageData.filterPriceMin = null;
  }

  if (config.priceMax !== undefined) {
    storageData.filterPriceMax = config.priceMax;
  } else if ('priceMax' in config) {
    storageData.filterPriceMax = null;
  }

  if (config.monthlySalesMin !== undefined) {
    storageData.filterMonthlySalesMin = config.monthlySalesMin;
  } else if ('monthlySalesMin' in config) {
    storageData.filterMonthlySalesMin = null;
  }

  if (config.weightMax !== undefined) {
    storageData.filterWeightMax = config.weightMax;
  } else if ('weightMax' in config) {
    storageData.filterWeightMax = null;
  }

  if (config.listingDateAfter !== undefined) {
    storageData.filterListingDateAfter = config.listingDateAfter;
  } else if ('listingDateAfter' in config) {
    storageData.filterListingDateAfter = null;
  }

  if (config.sellerMode !== undefined) {
    storageData.filterSellerMode = config.sellerMode;
  }

  if (config.followSellerMax !== undefined) {
    storageData.filterFollowSellerMax = config.followSellerMax;
  } else if ('followSellerMax' in config) {
    storageData.filterFollowSellerMax = null;
  }

  await chrome.storage.sync.set(storageData);
}

/**
 * 清除采集过滤配置（重置为默认）
 */
export async function clearFilterConfig(): Promise<void> {
  await chrome.storage.sync.remove([
    'filterPriceMin',
    'filterPriceMax',
    'filterMonthlySalesMin',
    'filterWeightMax',
    'filterListingDateAfter',
    'filterSellerMode',
    'filterFollowSellerMax'
  ]);
}

// ========== 自动采集配置存储 ==========

const DEFAULT_AUTO_COLLECT_CONFIG: AutoCollectConfig = {
  enabled: false,
  intervalMinutes: 30,         // 默认30分钟
  maxConcurrentTabs: 1,        // 默认单标签页
  productsPerSource: 100,      // 默认每个地址采集100个商品
  autoUpload: true,            // 默认自动上传
  closeTabAfterCollect: true,  // 默认采集后关闭标签页
  collectionTimeoutMinutes: 10, // 默认10分钟超时
};

/**
 * 获取自动采集配置
 */
export async function getAutoCollectConfig(): Promise<AutoCollectConfig> {
  const result = await chrome.storage.sync.get([
    'autoCollectEnabled',
    'autoCollectInterval',
    'autoCollectMaxTabs',
    'autoCollectProductsPerSource',
    'autoCollectAutoUpload',
    'autoCollectCloseTab',
    'autoCollectTimeout'
  ]);

  return {
    enabled: result.autoCollectEnabled ?? DEFAULT_AUTO_COLLECT_CONFIG.enabled,
    intervalMinutes: result.autoCollectInterval ?? DEFAULT_AUTO_COLLECT_CONFIG.intervalMinutes,
    maxConcurrentTabs: result.autoCollectMaxTabs ?? DEFAULT_AUTO_COLLECT_CONFIG.maxConcurrentTabs,
    productsPerSource: result.autoCollectProductsPerSource ?? DEFAULT_AUTO_COLLECT_CONFIG.productsPerSource,
    autoUpload: result.autoCollectAutoUpload ?? DEFAULT_AUTO_COLLECT_CONFIG.autoUpload,
    closeTabAfterCollect: result.autoCollectCloseTab ?? DEFAULT_AUTO_COLLECT_CONFIG.closeTabAfterCollect,
    collectionTimeoutMinutes: result.autoCollectTimeout ?? DEFAULT_AUTO_COLLECT_CONFIG.collectionTimeoutMinutes,
  };
}

/**
 * 保存自动采集配置
 */
export async function setAutoCollectConfig(config: Partial<AutoCollectConfig>): Promise<void> {
  const storageData: { [key: string]: any } = {};

  if (config.enabled !== undefined) storageData.autoCollectEnabled = config.enabled;
  if (config.intervalMinutes !== undefined) storageData.autoCollectInterval = config.intervalMinutes;
  if (config.maxConcurrentTabs !== undefined) storageData.autoCollectMaxTabs = config.maxConcurrentTabs;
  if (config.productsPerSource !== undefined) storageData.autoCollectProductsPerSource = config.productsPerSource;
  if (config.autoUpload !== undefined) storageData.autoCollectAutoUpload = config.autoUpload;
  if (config.closeTabAfterCollect !== undefined) storageData.autoCollectCloseTab = config.closeTabAfterCollect;
  if (config.collectionTimeoutMinutes !== undefined) storageData.autoCollectTimeout = config.collectionTimeoutMinutes;

  await chrome.storage.sync.set(storageData);
}
