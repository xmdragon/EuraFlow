/**
 * OZON 反爬虫检查器
 *
 * 模拟 OZON 官方的 antibot 机制：
 * - preflightCheck(): 请求前检查是否有验证码待处理
 * - handle403(responseData): 处理 403 响应，保存 incidentId，触发用户通知
 */

export interface AntibotIncident {
  incidentId: string;
  timestamp: number;
  url: string;
}

/**
 * OZON 反爬虫检查器（单例）
 *
 * 核心功能：
 * 1. 请求前检查：如果有验证码待处理，阻止新请求
 * 2. 403 处理：保存 incidentId，触发浏览器通知，暂停采集
 * 3. 验证码清除：用户完成验证后，清除标记，恢复采集
 */
export class AntibotChecker {
  private static instance: AntibotChecker;
  private readonly STORAGE_KEY = 'ozon_captcha_pending';

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 获取全局单例
   */
  static getInstance(): AntibotChecker {
    if (!AntibotChecker.instance) {
      AntibotChecker.instance = new AntibotChecker();
    }
    return AntibotChecker.instance;
  }

  /**
   * 请求前检查（Preflight Check）
   *
   * 如果有验证码待处理，抛出错误阻止新请求
   *
   * @throws {Error} 如果有验证码待处理，抛出 'CAPTCHA_PENDING' 错误
   *
   * @example
   * await antibot.preflightCheck(); // 请求前必须调用
   */
  async preflightCheck(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      const incident: AntibotIncident | undefined = result[this.STORAGE_KEY];

      if (incident) {
        const elapsedMinutes = (Date.now() - incident.timestamp) / 1000 / 60;
        throw new Error(
          `CAPTCHA_PENDING: 检测到待处理的人机验证（incidentId: ${incident.incidentId}，已等待 ${elapsedMinutes.toFixed(0)} 分钟）。请完成验证后继续采集。`
        );
      }
    } catch (error: any) {
      // chrome.storage API 可能失败（如权限问题）
      if (error.message.startsWith('CAPTCHA_PENDING')) {
        throw error; // 重新抛出验证码错误
      }
      // 其他错误（如 storage 访问失败）不阻止请求
      console.warn('[AntibotChecker] preflightCheck 失败:', error.message);
    }
  }

  /**
   * 处理 403 响应（类似 OZON 官方的 antibot.handle403）
   *
   * 解析响应数据，提取 incidentId，保存到 storage，触发浏览器通知
   *
   * @param responseData 403 响应的 JSON 数据
   * @returns 是否成功处理（true: 保存成功, false: 无 incidentId 或保存失败）
   *
   * @example
   * if (response.status === 403) {
   *   const data = await response.json();
   *   await antibot.handle403(data);
   *   // 暂停采集，等待用户处理
   * }
   */
  async handle403(responseData: any): Promise<boolean> {
    try {
      // 1. 提取 incidentId（OZON 的反爬虫响应通常包含此字段）
      const incidentId = responseData?.incidentId || responseData?.incident_id;

      if (!incidentId) {
        console.warn('[AntibotChecker] 403 响应中未找到 incidentId，可能不是反爬虫拦截');
        return false;
      }

      // 2. 保存 incident 到 storage
      const incident: AntibotIncident = {
        incidentId,
        timestamp: Date.now(),
        url: responseData?.url || 'unknown'
      };

      await chrome.storage.local.set({ [this.STORAGE_KEY]: incident });

      // 3. 触发浏览器通知（提示用户）
      await this.notifyUser(incident);

      console.error(
        `[AntibotChecker] 🚫 触发反爬虫拦截！incidentId: ${incidentId}，采集已暂停，请手动完成人机验证。`
      );

      return true;
    } catch (error: any) {
      console.error('[AntibotChecker] handle403 失败:', error.message);
      return false;
    }
  }

  /**
   * 清除验证码标记（用户完成验证后调用）
   *
   * @example
   * // 在控制面板或后台脚本中调用
   * await antibot.clearCaptcha();
   */
  async clearCaptcha(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.STORAGE_KEY);
    } catch (error: any) {
      console.error('[AntibotChecker] clearCaptcha 失败:', error.message);
    }
  }

  /**
   * 获取当前的 incident（如果有）
   */
  async getCurrentIncident(): Promise<AntibotIncident | null> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      return result[this.STORAGE_KEY] || null;
    } catch (error: any) {
      console.error('[AntibotChecker] getCurrentIncident 失败:', error.message);
      return null;
    }
  }

  /**
   * 触发浏览器通知（私有方法）
   */
  private async notifyUser(incident: AntibotIncident): Promise<void> {
    try {
      // 检查通知权限
      if (!chrome.notifications) {
        console.warn('[AntibotChecker] 浏览器不支持通知 API');
        return;
      }

      // 创建通知
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title: 'EuraFlow - OZON 人机验证',
        message: `检测到反爬虫拦截（incidentId: ${incident.incidentId.substring(0, 8)}...）。请访问 OZON 网站完成人机验证后，重新启动采集。`,
        priority: 2
      });
    } catch (error: any) {
      console.warn('[AntibotChecker] 通知失败:', error.message);
    }
  }
}
