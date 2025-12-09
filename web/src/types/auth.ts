// 用户角色
export type UserRole = 'admin' | 'manager' | 'sub_account';

// 管理员级别
export interface ManagerLevel {
  id: number;
  name: string;
  alias?: string;
  max_sub_accounts: number;
  max_shops: number;
  default_expiration_days: number; // 默认过期周期（天）：7/30/90/365/0
  extra_config: Record<string, unknown>;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// 用户配额使用情况
export interface UserQuota {
  sub_accounts_count: number;
  max_sub_accounts: number;
  shops_count: number;
  max_shops: number;
}

// 账号状态
export type AccountStatus = 'active' | 'suspended' | 'disabled';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  permissions: string[];
  is_active: boolean;
  account_status: AccountStatus;
  expires_at?: string;
  parent_user_id?: number;
  primary_shop_id?: number;
  shop_ids?: number[];
  manager_level_id?: number;
  manager_level?: ManagerLevel;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
