import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// 扩展 dayjs 支持 UTC 和时区
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 时间 Hook
 * 统一管理全局时区设置和时间格式化
 *
 * @example
 * ```typescript
 * const { timezone, formatDateTime, formatDate, formatTime, toUTC } = useDateTime();
 *
 * // 格式化 UTC 时间为用户时区
 * <span>{formatDateTime(order.ordered_at)}</span>  // "11-03 15:30"
 * <span>{formatDate(order.ordered_at)}</span>      // "2025-11-03"
 *
 * // 将用户时区时间转换为 UTC（用于发送给后端）
 * const utcDate = toUTC(userSelectedDate);
 * ```
 */
export const useDateTime = () => {
  const { data: settings } = useQuery({
    queryKey: ['ozon', 'global-settings'],
    queryFn: async () => {
      const response = await fetch('/api/ef/v1/ozon/global-settings', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      if (!response.ok) throw new Error('获取全局设置失败');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
    retry: 1,
  });

  // 默认时区：Asia/Shanghai (UTC+8)
  const timezone = settings?.settings?.default_timezone?.setting_value?.value || 'Asia/Shanghai';

  /**
   * 格式化 UTC 时间为用户时区的日期时间字符串
   * @param utcTime - UTC 时间（ISO 8601 字符串或 Date 对象）
   * @param format - 时间格式（默认：'MM-DD HH:mm'）
   * @returns 格式化后的时间字符串（如："11-03 15:30"）
   */
  const formatDateTime = useCallback(
    (utcTime: string | Date | null | undefined, format: string = 'MM-DD HH:mm'): string => {
      if (!utcTime) return '-';
      return dayjs.utc(utcTime).tz(timezone).format(format);
    },
    [timezone]
  );

  /**
   * 格式化 UTC 时间为用户时区的日期字符串
   * @param utcTime - UTC 时间（ISO 8601 字符串或 Date 对象）
   * @param format - 日期格式（默认：'YYYY-MM-DD'）
   * @returns 格式化后的日期字符串（如："2025-11-03"）
   */
  const formatDate = useCallback(
    (utcTime: string | Date | null | undefined, format: string = 'YYYY-MM-DD'): string => {
      if (!utcTime) return '-';
      return dayjs.utc(utcTime).tz(timezone).format(format);
    },
    [timezone]
  );

  /**
   * 格式化 UTC 时间为用户时区的时间字符串
   * @param utcTime - UTC 时间（ISO 8601 字符串或 Date 对象）
   * @param format - 时间格式（默认：'HH:mm:ss'）
   * @returns 格式化后的时间字符串（如："15:30:45"）
   */
  const formatTime = useCallback(
    (utcTime: string | Date | null | undefined, format: string = 'HH:mm:ss'): string => {
      if (!utcTime) return '-';
      return dayjs.utc(utcTime).tz(timezone).format(format);
    },
    [timezone]
  );

  /**
   * 将用户时区的时间转换为 UTC 时间字符串
   * 用于发送给后端的日期范围查询
   * @param localTime - 用户时区的时间（dayjs 对象、字符串或 Date）
   * @param format - 输出格式（默认：'YYYY-MM-DD'）
   * @returns UTC 时间字符串（如："2025-11-02"）
   */
  const toUTC = useCallback(
    (localTime: unknown, format: string = 'YYYY-MM-DD'): string => {
      if (!localTime) return '';
      // 将用户时区的时间转换为 UTC
      return dayjs.tz(localTime, timezone).utc().format(format);
    },
    [timezone]
  );

  /**
   * 将用户时区的日期转换为 UTC 日期+时间范围（用于日期区间查询）
   * @param localDate - 用户时区的日期（dayjs 对象）
   * @param isEndDate - 是否是结束日期（结束日期需要设置为 23:59:59）
   * @returns UTC 时间字符串（如："2025-11-02T00:00:00Z" 或 "2025-11-02T23:59:59Z"）
   */
  const toUTCRange = useCallback(
    (localDate: unknown, isEndDate: boolean = false): string => {
      if (!localDate) return '';

      // 在用户时区设置时间为 00:00:00 或 23:59:59
      const timeInUserTz = dayjs(localDate)
        .tz(timezone)
        .set('hour', isEndDate ? 23 : 0)
        .set('minute', isEndDate ? 59 : 0)
        .set('second', isEndDate ? 59 : 0)
        .set('millisecond', isEndDate ? 999 : 0);

      // 转换为 UTC 并格式化为 ISO 8601 格式
      return timeInUserTz.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
    },
    [timezone]
  );

  return {
    timezone,
    formatDateTime,
    formatDate,
    formatTime,
    toUTC,
    toUTCRange,
  };
};
