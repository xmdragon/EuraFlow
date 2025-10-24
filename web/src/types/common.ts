/**
 * 通用类型定义
 */

// API 错误类型
export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

// 表单值类型（基础）
export type FormValues = Record<string, unknown>;

// 通用响应类型
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 分页响应类型
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
  next_cursor?: string;
}

// React Query Error 类型
export type QueryError = Error | ApiError;

// Mutation 回调类型
export type MutationErrorHandler = (error: QueryError) => void;
export type MutationSuccessHandler<T = unknown> = (data: T) => void;
