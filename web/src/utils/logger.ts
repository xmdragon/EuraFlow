/**
 * 统一日志工具
 * 基于 loglevel 实现，支持分级控制和按模块管理
 *
 * 使用方法:
 * ```typescript
 * import { logger, createLogger } from '@/utils/logger';
 *
 * // 默认日志器
 * logger.debug('调试信息');
 * logger.info('普通信息');
 * logger.warn('警告信息');
 * logger.error('错误信息');
 *
 * // 创建模块专属日志器
 * const productLogger = createLogger('product');
 * productLogger.debug('商品模块调试信息');
 * ```
 *
 * 日志级别（从低到高）:
 * - TRACE (5): 最详细的日志
 * - DEBUG (4): 调试信息
 * - INFO (3): 一般信息
 * - WARN (2): 警告信息
 * - ERROR (1): 错误信息
 * - SILENT (0): 关闭所有日志
 *
 * 环境变量控制:
 * - 开发环境: LOG_LEVEL=debug (显示 debug 及以上级别)
 * - 生产环境: LOG_LEVEL=warn (只显示 warn 和 error)
 */

import log, { Logger } from 'loglevel';

// 日志级别类型
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * 根据环境获取默认日志级别
 */
const getDefaultLogLevel = (): LogLevel => {
  // 优先使用环境变量
  const envLevel = import.meta.env.VITE_LOG_LEVEL as LogLevel;
  if (envLevel) {
    return envLevel;
  }

  // 根据环境自动判断
  const isDevelopment = import.meta.env.MODE === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

/**
 * 配置日志格式化输出
 */
const setupLogFormat = (logger: Logger, prefix: string = '') => {
  const originalFactory = logger.methodFactory;

  logger.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return function (...args) {
      const timestamp = new Date().toISOString();
      const levelTag = methodName.toUpperCase().padEnd(5);
      const prefixTag = prefix ? `[${prefix}]` : '';

      // 格式: [时间] [级别] [模块] 消息
      rawMethod(`[${timestamp}] [${levelTag}]${prefixTag}`, ...args);
    };
  };

  logger.setLevel(logger.getLevel()); // 重新应用当前级别
};

// 创建默认日志器
const rootLogger = log.getLogger('app');
rootLogger.setLevel(getDefaultLogLevel());
setupLogFormat(rootLogger);

/**
 * 创建模块专属日志器
 * @param moduleName 模块名称，如 'product', 'order', 'auth'
 * @param level 可选的日志级别，默认继承全局级别
 */
export const createLogger = (moduleName: string, level?: LogLevel): Logger => {
  const logger = log.getLogger(moduleName);
  logger.setLevel(level || getDefaultLogLevel());
  setupLogFormat(logger, moduleName);
  return logger;
};

/**
 * 设置全局日志级别
 * @param level 日志级别
 */
export const setGlobalLogLevel = (level: LogLevel) => {
  log.setLevel(level);
};

/**
 * 默认导出的日志器（推荐使用）
 */
export const logger = rootLogger;

/**
 * 常用模块的日志器（预创建）
 */
export const loggers = {
  auth: createLogger('auth'),
  api: createLogger('api'),
  product: createLogger('product'),
  order: createLogger('order'),
  notification: createLogger('notification'),
  websocket: createLogger('websocket'),
  sync: createLogger('sync'),
} as const;

/**
 * 向后兼容的控制台方法（仅用于迁移期间）
 * @deprecated 请使用 logger.debug/info/warn/error
 */
export const devLog = (...args: any[]) => {
  logger.debug(...args);
};

export default logger;
