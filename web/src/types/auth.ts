/* eslint-disable no-unused-vars */
export interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  primary_shop_id?: number;
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
  login: (_credentials: LoginRequest) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}
