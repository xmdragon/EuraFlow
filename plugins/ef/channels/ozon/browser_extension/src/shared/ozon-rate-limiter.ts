/**
 * 全局OZON API限流器
 *
 * 统一管理所有 *.ozon.ru 域名的API请求频率，避免触发限流
 * 所有OZON API请求（跟卖数据、包装数据、尺寸数据等）共享同一个队列和时间间隔
 */

import { getRateLimitConfig } from './storage';
import type { RateLimitConfig } from './types';

interface QueueTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

/**
 * OZON API 全局限流器（单例）
 */
export class OzonApiRateLimiter {
  private static instance: OzonApiRateLimiter;

  private queue: QueueTask<any>[] = [];
  private isProcessing = false;
  private lastExecuteTime = 0;

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
   * 执行OZON API请求（自动限流）
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
    return new Promise<T>((resolve, reject) => {
      // 入队
      this.queue.push({ fn, resolve, reject });

      // 触发处理循环（如果未在处理中）
      this.processQueue();
    });
  }

  /**
   * 处理队列（串行执行，严格控制间隔）
   */
  private async processQueue(): Promise<void> {
    // 如果已经在处理，直接返回（避免重复触发）
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;

      // 计算需要延迟的时间
      const now = Date.now();
      const configDelay = await this.getDelayTime();
      const timeSinceLastExecute = now - this.lastExecuteTime;
      const needDelay = Math.max(0, configDelay - timeSinceLastExecute);

      // 延迟（确保与上次执行的间隔 >= 配置值）
      if (needDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, needDelay));
      }

      // 执行任务
      try {
        const result = await task.fn();
        task.resolve(result);
      } catch (error) {
        task.reject(error);
      }

      // 更新最后执行时间
      this.lastExecuteTime = Date.now();
    }

    this.isProcessing = false;
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
}
