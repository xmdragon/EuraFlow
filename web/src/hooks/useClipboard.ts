import { logger } from '@/utils/logger';

// 模块级：被拒绝的剪贴板内容（内容 -> 过期时间戳）
// 用户手动清除后，1分钟内不再自动填充相同内容
const rejectedClipboard = new Map<string, number>();

// 拒绝列表过期时间（毫秒）
const REJECTION_EXPIRE_TIME = 60 * 1000; // 1分钟

/**
 * 标记剪贴板内容为已拒绝（用户主动清除）
 * @param text 被拒绝的内容
 */
export const markClipboardRejected = (text: string): void => {
  const trimmed = text.trim();
  if (!trimmed) return;

  // 设置过期时间为当前时间 + 1分钟
  const expireAt = Date.now() + REJECTION_EXPIRE_TIME;
  rejectedClipboard.set(trimmed, expireAt);

  logger.info('剪贴板内容已标记为拒绝，1分钟内不再自动填充:', trimmed);

  // 清理过期的拒绝记录（避免内存泄漏）
  cleanupExpiredRejections();
};

/**
 * 检查剪贴板内容是否在拒绝列表中
 * @param text 要检查的内容
 * @returns 如果在拒绝列表中且未过期，返回 true
 */
export const isClipboardRejected = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const expireAt = rejectedClipboard.get(trimmed);
  if (!expireAt) return false;

  // 检查是否过期
  if (Date.now() > expireAt) {
    rejectedClipboard.delete(trimmed);
    return false;
  }

  return true;
};

/**
 * 清理过期的拒绝记录
 */
const cleanupExpiredRejections = (): void => {
  const now = Date.now();
  for (const [text, expireAt] of rejectedClipboard.entries()) {
    if (now > expireAt) {
      rejectedClipboard.delete(text);
    }
  }
};

/**
 * 验证追踪号码/SKU 格式
 *
 * 支持以下格式（长度≥8位）：
 * 1. 纯数字：12345678
 * 2. 数字-数字：1234-5678
 * 3. 字母数字组合：AB123456, A1B2C3D4
 * 4. 字母开头+数字+字母结尾：A123456B, AB1234CD
 */
export const validateTrackingFormat = (text: string): boolean => {
  const trimmed = text.trim();
  const length = trimmed.length;

  // 长度必须≥8位
  if (length < 8) {
    return false;
  }

  // 格式1：纯数字，≥8位
  if (/^\d{8,}$/.test(trimmed)) {
    return true;
  }

  // 格式2：数字-数字-数字...（支持多个连字符），总长度≥8
  // 例如：1234-5678, 0149232257-0009-2
  if (/^\d+(-\d+)+$/.test(trimmed) && length >= 8) {
    return true;
  }

  // 格式3：字母数字组合，≥8位（至少包含1个字母和1个数字）
  if (/^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d]{8,}$/.test(trimmed)) {
    return true;
  }

  // 格式4：字母开头+数字+字母结尾，≥8位
  if (/^[a-zA-Z]+\d+[a-zA-Z]+$/.test(trimmed) && length >= 8) {
    return true;
  }

  return false;
};

/**
 * 读取剪贴板内容（需要用户授权）
 *
 * @returns 剪贴板文本内容，失败返回 null
 *
 * 注意：
 * - 首次调用时浏览器会请求权限
 * - 需要 HTTPS 或 localhost 环境
 * - 用户拒绝权限时会静默失败
 */
export const readFromClipboard = async (): Promise<string | null> => {
  try {
    // 检查浏览器是否支持 Clipboard API
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      logger.warn('浏览器不支持 Clipboard API');
      return null;
    }

    // 读取剪贴板内容
    const text = await navigator.clipboard.readText();

    // 返回清理后的文本（去除首尾空格）
    return text.trim() || null;
  } catch (error) {
    // 常见错误：
    // - NotAllowedError: 用户拒绝授权
    // - SecurityError: 非 HTTPS 环境（localhost 除外）
    logger.warn('读取剪贴板失败:', error);
    return null;
  }
};

/**
 * 读取并验证剪贴板内容
 *
 * @returns 验证通过的文本，否则返回 null
 */
export const readAndValidateClipboard = async (): Promise<string | null> => {
  const text = await readFromClipboard();

  if (!text) {
    return null;
  }

  // 检查是否在拒绝列表中（用户主动清除过）
  if (isClipboardRejected(text)) {
    logger.info('剪贴板内容在拒绝列表中，跳过自动填充:', text);
    return null;
  }

  // 验证格式
  if (!validateTrackingFormat(text)) {
    logger.info('剪贴板内容不符合追踪号码格式:', text);
    return null;
  }

  return text;
};
