/**
 * 认证服务 - 管理用户认证和token
 */

interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_at?: number; // timestamp
}

class AuthService {
  private static instance: AuthService;
  private tokens: AuthTokens | null = null;
  private readonly TOKEN_KEY = 'ef_auth_tokens';
  private refreshPromise: Promise<boolean> | null = null;

  private constructor() {
    // 从localStorage恢复token
    this.loadTokens();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * 从localStorage加载token
   */
  private loadTokens(): void {
    try {
      const stored = localStorage.getItem(this.TOKEN_KEY);
      if (stored) {
        this.tokens = JSON.parse(stored);
        // 检查是否过期
        if (this.tokens?.expires_at && Date.now() > this.tokens.expires_at) {
          this.clearTokens();
        }
      }
    } catch (error) {
      console.error('Failed to load tokens:', error);
      this.clearTokens();
    }
  }

  /**
   * 保存token到localStorage
   */
  private saveTokens(): void {
    if (this.tokens) {
      localStorage.setItem(this.TOKEN_KEY, JSON.stringify(this.tokens));
    } else {
      localStorage.removeItem(this.TOKEN_KEY);
    }
  }

  /**
   * 设置认证token
   */
  public setTokens(tokens: AuthTokens): void {
    // 如果没有expires_at，默认30分钟过期
    if (!tokens.expires_at) {
      tokens.expires_at = Date.now() + 30 * 60 * 1000;
    }
    this.tokens = tokens;
    this.saveTokens();
  }

  /**
   * 获取当前token
   */
  public getAccessToken(): string | null {
    // 检查是否过期
    if (this.tokens?.expires_at && Date.now() > this.tokens.expires_at - 60000) {
      // 提前1分钟刷新
      this.refreshToken();
    }
    return this.tokens?.access_token || null;
  }

  /**
   * 获取认证头
   */
  public getAuthHeader(): Record<string, string> {
    const token = this.getAccessToken();
    if (token) {
      return {
        'Authorization': `Bearer ${token}`
      };
    }
    return {};
  }

  /**
   * 清除token
   */
  public clearTokens(): void {
    this.tokens = null;
    this.saveTokens();
  }

  /**
   * 判断是否已认证
   */
  public isAuthenticated(): boolean {
    if (!this.tokens) return false;
    if (this.tokens.expires_at && Date.now() > this.tokens.expires_at) {
      this.clearTokens();
      return false;
    }
    return !!this.tokens.access_token;
  }

  /**
   * 登录
   */
  public async login(username: string, password: string): Promise<boolean> {
    try {
      const response = await fetch('/api/ef/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          username,
          password,
          grant_type: 'password'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Login failed');
      }

      const data = await response.json();

      // 保存token
      this.setTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        expires_at: Date.now() + (data.expires_in || 1800) * 1000
      });

      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }

  /**
   * 刷新token
   */
  public async refreshToken(): Promise<boolean> {
    // 避免重复刷新
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async _doRefresh(): Promise<boolean> {
    if (!this.tokens?.refresh_token) {
      return false;
    }

    try {
      const response = await fetch('/api/ef/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: this.tokens.refresh_token
        })
      });

      if (!response.ok) {
        this.clearTokens();
        window.location.href = '/login';
        return false;
      }

      const data = await response.json();

      this.setTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token || this.tokens.refresh_token,
        token_type: data.token_type || 'Bearer',
        expires_at: Date.now() + (data.expires_in || 1800) * 1000
      });

      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearTokens();
      window.location.href = '/login';
      return false;
    }
  }

  /**
   * 登出
   */
  public logout(): void {
    this.clearTokens();
    window.location.href = '/login';
  }
}

export default AuthService.getInstance();