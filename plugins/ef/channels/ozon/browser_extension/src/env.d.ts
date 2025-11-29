/// <reference types="vite/client" />

/**
 * 编译时常量，由 vite.config.ts 定义
 * - production 版: false（移除调试日志）
 * - debug 版: true（保留调试日志）
 * - 开发模式: true（保留调试日志）
 */
declare const __DEBUG__: boolean;
