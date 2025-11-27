/**
 * 全局OZON API限流器
 *
 * 统一管理所有 *.ozon.ru 域名的API请求频率，避免触发限流
 * 所有OZON API请求（跟卖数据、包装数据、尺寸数据等）共享同一个队列和时间间隔
 */

import { getRateLimitConfig } from './storage';
import type { RateLimitConfig } from './types';
import { AntibotChecker } from './antibot-checker';

interface QueueTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

/**
 * OZON API 全局限流器（单例）
 *
 * 策略调整（2025-01-27）：
 * - 支持最多 4 个并发请求（已验证通过网关请求不会触发限流）
 * - 最小间隔配置 + 随机抖动 ±100ms
 */
export class OzonApiRateLimiter {
  private static instance: OzonApiRateLimiter;

  private queue: QueueTask<any>[] = [];
  private isProcessing = false;
  private lastExecuteTime = 0;
  private activeRequests = 0;               // 当前正在执行的请求数
  private readonly MAX_CONCURRENT = 4;      // 并发数4，提升吞吐量（已验证不会触发限流）
  private readonly JITTER_RANGE = 100;      // 抖动范围 ±100ms

  // 配置缓存（每10秒刷新一次，避免频繁读取storage）
  private cachedConfig: RateLimitConfig | null = null;
  private configCacheTime = 0;
  private readonly CONFIG_CACHE_DURATION = 10000; // 10秒

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 获取全局单例
   */
  static getInstance(): OzonApiRateLimiter {
    if (!OzonApiRateLimiter.instance) {
      OzonApiRateLimiter.instance = new OzonApiRateLimiter();
    }
    return OzonApiRateLimiter.instance;
  }

  /**
   * 执行OZON API请求（自动限流 + 反爬虫检查）
   *
   * @param fn 要执行的异步函数
   * @returns 异步函数的返回值
   *
   * @example
   * const limiter = OzonApiRateLimiter.getInstance();
   * const data = await limiter.execute(() =>
   *   fetch('https://seller.ozon.ru/api/...').then(r => r.json())
   * );
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 反爬虫检查：如果有验证码待处理，立即抛出错误
    const antibot = AntibotChecker.getInstance();
    await antibot.preflightCheck();

    return new Promise<T>((resolve, reject) => {
      // 入队
      this.queue.push({ fn, resolve, reject });

      // 触发处理循环（如果未在处理中）
      this.processQueue();
    });
  }

  /**
   * 执行OZON API请求（自动限流 + 反爬虫检查 + 智能重试）
   *
   * 模拟 OZON 官方的错误处理机制：
   * - 403 → 调用 antibot.handle403()，暂停采集，抛出 CAPTCHA_PENDING 错误
   * - 429 → 指数退避重试（1s → 2s → 4s → 8s），最多重试 3 次
   * - 其他错误 → 直接抛出
   *
   * @param fn 要执行的异步函数（返回 Response 对象）
   * @param maxRetries 最大重试次数（默认 2 次，加上初次执行共 3 次）
   * @returns 异步函数的返回值
   *
   * @example
   * const limiter = OzonApiRateLimiter.getInstance();
   * const response = await limiter.executeWithRetry(() =>
   *   fetch('https://seller.ozon.ru/api/...')
   * );
   */
  async executeWithRetry<T extends Response>(
    fn: () => Promise<T>,
    maxRetries: number = 2
  ): Promise<T> {
    const antibot = AntibotChecker.getInstance();
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 执行请求（包含反爬虫检查和限流）
        const response = await this.execute(fn);

        // 检查 HTTP 状态码
        if (response.status === 403) {
          // 403: 反爬虫拦截
          let responseData: any;
          try {
            responseData = await response.clone().json();
          } catch {
            responseData = { error: '403 Forbidden' };
          }

          const handled = await antibot.handle403(responseData);
          if (handled) {
            // 保存了 incidentId，抛出特殊错误，通知上层暂停采集
            throw new Error('CAPTCHA_PENDING: 触发反爬虫拦截，采集已暂停，请完成人机验证');
          } else {
            // 没有 incidentId，可能是其他原因导致的 403
            throw new Error(`403 Forbidden: ${JSON.stringify(responseData)}`);
          }
        }

        if (response.status === 429) {
          // 429: 限流，指数退避后重试
          if (attempt < maxRetries) {
            const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s
            console.warn(
              `[OzonApiRateLimiter] 触发 429 限流，${backoffTime}ms 后重试（第 ${attempt + 1}/${maxRetries + 1} 次）`
            );
            await this.sleep(backoffTime);
            continue; // 重试
          } else {
            throw new Error('429 Too Many Requests: 超过最大重试次数');
          }
        }

        // 其他状态码：正常返回
        return response;
      } catch (error: any) {
        lastError = error;

        // CAPTCHA_PENDING 错误不重试，直接抛出
        if (error.message?.startsWith('CAPTCHA_PENDING')) {
          throw error;
        }

        // 403 Forbidden 错误不重试（非反爬虫的 403 通常是权限问题）
        if (error.message?.startsWith('403 Forbidden')) {
          throw error;
        }

        // 其他错误：如果还有重试机会，继续；否则抛出
        if (attempt < maxRetries) {
          const backoffTime = Math.pow(2, attempt) * 1000;
          console.warn(
            `[OzonApiRateLimiter] 请求失败（${error.message}），${backoffTime}ms 后重试（第 ${attempt + 1}/${maxRetries + 1} 次）`
          );
          await this.sleep(backoffTime);
          continue;
        }
      }
    }

    // 所有重试都失败，抛出最后一个错误
    throw lastError;
  }

  /**
   * 处理队列（支持并发，最多 3 个同时执行）
   */
  private async processQueue(): Promise<void> {
    // 如果已经在处理，直接返回（避免重复触发）
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 || this.activeRequests > 0) {
      // 检查是否可以启动新任务（并发控制）
      if (this.queue.length > 0 && this.activeRequests < this.MAX_CONCURRENT) {
        const task = this.queue.shift()!;

        // 计算需要延迟的时间（含随机抖动）
        const now = Date.now();
        const configDelay = await this.getDelayTime();
        const jitter = Math.floor(Math.random() * (this.JITTER_RANGE * 2 + 1)) - this.JITTER_RANGE; // -50 ~ +50
        const delayWithJitter = Math.max(0, configDelay + jitter);
        const timeSinceLastExecute = now - this.lastExecuteTime;
        const needDelay = Math.max(0, delayWithJitter - timeSinceLastExecute);

        // 延迟（确保与上次执行的间隔 >= 配置值 + 抖动）
        if (needDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, needDelay));
        }

        // 更新最后执行时间
        this.lastExecuteTime = Date.now();

        // 异步执行任务（不阻塞队列处理）
        this.activeRequests++;
        this.executeTask(task).finally(() => {
          this.activeRequests--;
        });
      } else {
        // 没有可执行的任务，等待一小段时间
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    this.isProcessing = false;
  }

  /**
   * 执行单个任务（异步，不阻塞队列）
   */
  private async executeTask(task: QueueTask<any>): Promise<void> {
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }

  /**
   * 获取延迟时间（根据配置）
   */
  private async getDelayTime(): Promise<number> {
    const config = await this.getConfig();

    // 未启用频率限制
    if (!config.enabled) {
      return 0;
    }

    // 固定频率
    if (config.mode === 'fixed') {
      return config.fixedDelay;
    }

    // 随机频率
    const min = config.randomDelayMin;
    const max = config.randomDelayMax;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 获取配置（带缓存）
   */
  private async getConfig(): Promise<RateLimitConfig> {
    const now = Date.now();

    // 缓存有效，直接返回
    if (this.cachedConfig && (now - this.configCacheTime < this.CONFIG_CACHE_DURATION)) {
      return this.cachedConfig;
    }

    // 缓存过期，重新读取
    this.cachedConfig = await getRateLimitConfig();
    this.configCacheTime = now;

    return this.cachedConfig;
  }

  /**
   * 清空配置缓存（用于测试或强制刷新）
   */
  clearConfigCache(): void {
    this.cachedConfig = null;
    this.configCacheTime = 0;
  }

  /**
   * 获取当前队列长度（用于调试）
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * 延迟函数（私有辅助方法）
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
