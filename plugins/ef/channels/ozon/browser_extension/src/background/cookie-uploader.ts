/**
 * Cookie 上传器
 *
 * 定期将 OZON Cookie 上传到后端，使后端可以执行 Web 同步任务
 *
 * 执行时机：
 * - Service Worker 启动时（安装/更新/浏览器启动）
 * - 每小时定时上传
 */

import { createEuraflowApi } from '../shared/api/euraflow-api';

// ========== 常量 ==========

const CACHE_KEY = 'cookie_uploader_last_run';
const UPLOAD_INTERVAL_MS = 60 * 60 * 1000; // 1 小时
const OZON_DOMAIN = '.ozon.ru';

// ========== 类型定义 ==========

interface CookieData {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expirationDate?: number;
}

interface UploadPayload {
  cookies: CookieData[];
  user_agent: string;
}

// ========== Cookie 上传器 ==========

class CookieUploader {
  /**
   * 获取 API 配置
   */
  private async getApiConfig(): Promise<{ apiUrl: string; apiKey: string }> {
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
   * 检查是否应该执行上传
   */
  async shouldUpload(): Promise<boolean> {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const lastRun = result[CACHE_KEY];

    if (!lastRun) return true;

    const elapsed = Date.now() - lastRun;
    return elapsed >= UPLOAD_INTERVAL_MS;
  }

  /**
   * 获取 OZON Cookies
   */
  private async getOzonCookies(): Promise<CookieData[]> {
    const cookies = await chrome.cookies.getAll({ domain: OZON_DOMAIN });

    return cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate,
    }));
  }

  /**
   * 上传 Cookie 到后端
   */
  async upload(): Promise<{ success: boolean; message: string }> {
    try {
      // 检查 API 配置
      const apiConfig = await this.getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        return { success: false, message: '缺少 API 配置' };
      }

      // 获取 OZON Cookies
      const cookies = await this.getOzonCookies();
      if (cookies.length === 0) {
        return { success: false, message: '没有 OZON Cookies' };
      }

      // 检查关键 Cookie 是否存在
      const hasAuthCookie = cookies.some(c =>
        c.name === 'abt_data' || c.name === '__Secure-access-token' || c.name === '__Secure-refresh-token'
      );
      if (!hasAuthCookie) {
        return { success: false, message: '缺少认证 Cookie，可能未登录' };
      }

      // 构建上传数据
      const payload: UploadPayload = {
        cookies,
        user_agent: navigator.userAgent,
      };

      // 上传到后端
      const response = await fetch(`${apiConfig.apiUrl}/api/ef/v1/ozon/session/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiConfig.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, message: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json();

      // 记录上传时间
      await chrome.storage.local.set({ [CACHE_KEY]: Date.now() });

      const shopsUpdated = result.data?.shops_updated || 0;
      return { success: true, message: `成功上传，更新 ${shopsUpdated} 个店铺` };

    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  /**
   * 定时执行上传
   */
  async runIfNeeded(): Promise<void> {
    if (await this.shouldUpload()) {
      console.log('[CookieUploader] 开始上传 Cookie...');
      const result = await this.upload();
      if (result.success) {
        console.log(`[CookieUploader] ${result.message}`);
      } else {
        console.warn(`[CookieUploader] 上传失败: ${result.message}`);
      }
    } else {
      console.log('[CookieUploader] 跳过：距上次上传不足 1 小时');
    }
  }
}

// 导出单例
export const cookieUploader = new CookieUploader();

/**
 * 注册消息处理器
 */
export function registerCookieUploaderHandlers(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 立即上传
    if (message.type === 'COOKIE_UPLOADER_UPLOAD') {
      cookieUploader.upload()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, message: error.message }));
      return true;
    }

    // 检查并上传（如果需要）
    if (message.type === 'COOKIE_UPLOADER_RUN') {
      cookieUploader.runIfNeeded()
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, message: error.message }));
      return true;
    }

    // 重置缓存（测试用）
    if (message.type === 'COOKIE_UPLOADER_RESET') {
      chrome.storage.local.remove(CACHE_KEY)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, message: error.message }));
      return true;
    }
  });
}
