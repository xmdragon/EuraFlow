/**
 * 额度系统 API 服务
 */
import apiClient from './simpleAxios';
import type {
  CreditBalance,
  CalculateCostRequest,
  CalculateCostResponse,
  TransactionsResponse,
  ModuleConfig,
  AccountsResponse,
  RechargeRequest,
  RechargeResponse,
  RechargeRecordsResponse,
  UpdateModuleConfigRequest,
} from '@/types/credit';

// ============ 用户接口 ============

/**
 * 获取当前用户余额
 */
export const getBalance = async (): Promise<CreditBalance> => {
  const response = await apiClient.get('/credit/balance');
  return response.data;
};

/**
 * 计算模块消费
 */
export const calculateCost = async (
  request: CalculateCostRequest
): Promise<CalculateCostResponse> => {
  const response = await apiClient.post('/credit/calculate', request);
  return response.data;
};

/**
 * 静默余额预警
 */
export const muteAlert = async (): Promise<{ muted: boolean }> => {
  const response = await apiClient.post('/credit/mute-alert');
  return response.data;
};

/**
 * 获取交易记录
 */
export const getTransactions = async (params: {
  transaction_type?: string;
  module?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}): Promise<TransactionsResponse> => {
  const response = await apiClient.get('/credit/transactions', { params });
  return response.data;
};

/**
 * 获取模块配置列表（用户可见）
 */
export const getModuleConfigs = async (): Promise<{ items: ModuleConfig[] }> => {
  const response = await apiClient.get('/credit/module-configs');
  return response.data;
};

// ============ 管理员接口 ============

/**
 * 获取所有用户额度列表
 */
export const getAccounts = async (params: {
  search?: string;
  role?: string;
  page?: number;
  page_size?: number;
}): Promise<AccountsResponse> => {
  const response = await apiClient.get('/admin/credit/accounts', { params });
  return response.data;
};

/**
 * 为用户充值
 */
export const recharge = async (request: RechargeRequest): Promise<RechargeResponse> => {
  const response = await apiClient.post('/admin/credit/recharge', request);
  return response.data;
};

/**
 * 获取充值记录
 */
export const getRechargeRecords = async (params: {
  user_id?: number;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}): Promise<RechargeRecordsResponse> => {
  const response = await apiClient.get('/admin/credit/recharge-records', { params });
  return response.data;
};

/**
 * 获取模块配置列表（管理员）
 */
export const getAdminModuleConfigs = async (): Promise<{ items: ModuleConfig[] }> => {
  const response = await apiClient.get('/admin/credit/module-configs');
  return response.data;
};

/**
 * 更新模块配置
 */
export const updateModuleConfig = async (
  moduleKey: string,
  request: UpdateModuleConfigRequest
): Promise<ModuleConfig> => {
  const response = await apiClient.put(`/admin/credit/module-configs/${moduleKey}`, request);
  return response.data;
};

/**
 * 更新用户预警阈值
 */
export const updateThreshold = async (
  userId: number,
  threshold: string
): Promise<{ ok: boolean; threshold: string }> => {
  const response = await apiClient.put(`/admin/credit/accounts/${userId}/threshold`, {
    user_id: userId,
    threshold,
  });
  return response.data;
};
