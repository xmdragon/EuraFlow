/**
 * 额度系统类型定义
 */

// 余额信息
export interface CreditBalance {
  balance: string;
  total_recharged: string;
  total_consumed: string;
  low_balance_threshold: string;
  low_balance_alert_muted: boolean;
  is_low_balance: boolean;
  credit_name: string;
  account_user_id: number;
  account_username: string;
}

// 消费计算请求
export interface CalculateCostRequest {
  module: string;
  posting_numbers: string[];
  exclude_reprints?: boolean;
}

// 消费计算响应
export interface CalculateCostResponse {
  total_cost: string;
  unit_cost: string;
  billable_count: number;
  reprint_count: number;
  current_balance: string;
  sufficient: boolean;
  credit_name: string;
}

// 交易记录
export interface CreditTransaction {
  id: number;
  transaction_type: 'recharge' | 'consume' | 'refund' | 'adjust';
  amount: string;
  balance_before: string;
  balance_after: string;
  module: string | null;
  operator_user_id: number;
  operator_username: string;
  details: {
    posting_numbers?: string[];
    billable_count?: number;
    reprint_count?: number;
  };
  payment_method: string | null;
  payment_amount_cny: string | null;
  notes: string | null;
  ip_address: string | null;
  created_at: string;
}

// 交易记录列表响应
export interface TransactionsResponse {
  items: CreditTransaction[];
  total: number;
  page: number;
  page_size: number;
}

// 模块配置
export interface ModuleConfig {
  module_key: string;
  module_name: string;
  cost_per_unit: string;
  unit_description: string;
  is_enabled: boolean;
}

// 管理员视角的账户信息
export interface CreditAccount {
  id: number;
  user_id: number;
  username: string;
  role: string;
  balance: string;
  total_recharged: string;
  total_consumed: string;
  low_balance_threshold: string;
  is_low_balance: boolean;
  sub_accounts_count: number;
  created_at: string;
  updated_at: string;
}

// 账户列表响应
export interface AccountsResponse {
  items: CreditAccount[];
  total: number;
  page: number;
  page_size: number;
}

// 充值请求
export interface RechargeRequest {
  user_id: number;
  amount: string;
  payment_method: 'manual' | 'wechat' | 'alipay';
  payment_amount_cny?: string;
  payment_order_no?: string;
  notes?: string;
}

// 充值响应
export interface RechargeResponse {
  transaction_id: number;
  balance_before: string;
  balance_after: string;
  amount: string;
}

// 充值记录
export interface RechargeRecord {
  id: number;
  user_id: number;
  username: string;
  amount: string;
  payment_method: string;
  payment_amount_cny: string | null;
  payment_order_no: string | null;
  balance_before: string;
  balance_after: string;
  approved_by: number;
  approved_by_username: string;
  notes: string | null;
  ip_address: string | null;
  created_at: string;
}

// 充值记录列表响应
export interface RechargeRecordsResponse {
  items: RechargeRecord[];
  total: number;
  page: number;
  page_size: number;
}

// 更新模块配置请求
export interface UpdateModuleConfigRequest {
  cost_per_unit?: string;
  module_name?: string;
  unit_description?: string;
  is_enabled?: boolean;
}

// 额度不足错误详情
export interface InsufficientCreditError {
  error: 'INSUFFICIENT_CREDIT';
  message: string;
  required: string;
  balance: string;
  credit_name: string;
}
