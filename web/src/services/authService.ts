/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
import axios from 'axios';

import type { LoginRequest, LoginResponse, User } from '@/types/auth';

const API_BASE_URL = '/api/ef/v1';

class AuthService {
  private _accessToken: string | null = null;
  private _refreshToken: string | null = null;

  get accessToken(): string | null {
    return this._accessToken;
  }

  get refreshToken(): string | null {
    return this._refreshToken;
  }

  constructor() {
    // Load tokens from localStorage
    this._accessToken = localStorage.getItem('access_token');
    this._refreshToken = localStorage.getItem('refresh_token');


    // Setup axios interceptors
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor to add auth header
    axios.interceptors.request.use((config) => {
      if (this._accessToken) {
        config.headers.Authorization = `Bearer ${this._accessToken}`;
        // Token added to request
      } else {
        // No token available for request
      }
      return config;
    });

    // Response interceptor to handle token refresh
    axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        // Handle 401 errors
        if (error.response?.status === 401) {
          const isAuthMeRequest = error.config?.url?.includes('/auth/me');
          const isRefreshRequest = error.config?.url?.includes('/auth/refresh');
          const isLoginRequest = error.config?.url?.includes('/auth/login');

          // 401 Unauthorized error

          // Don't try to refresh for login or refresh requests
          if (isLoginRequest || isRefreshRequest) {
            // Skipping token refresh for login/refresh request
            return Promise.reject(error);
          }

          // If we have a refresh token and it's not already a refresh attempt
          if (this._refreshToken && !error.config?._retry) {
            error.config._retry = true;
            // Attempting to refresh token...
            try {
              await this.refresh();
              // Token refresh successful, retrying original request
              // Update the Authorization header with new token
              error.config.headers.Authorization = `Bearer ${this._accessToken}`;
              return axios.request(error.config);
            } catch (refreshError) {
              // Token refresh failed
              // Refresh failed, clear tokens
              this.clearTokens();
              // Redirect to login if appropriate
              if (this.shouldRedirectToLogin(error.config?.url)) {
                // Redirecting to login page
                window.location.href = '/login';
              }
              return Promise.reject(refreshError);
            }
          } else {
            const reason = !this._refreshToken ? 'No refresh token available' : 'Already retried once';
            // Clearing tokens
            // No refresh token or already retried, clear tokens
            this.clearTokens();
            // Redirect to login if appropriate
            if (this.shouldRedirectToLogin(error.config?.url)) {
              console.info('[AuthService] Redirecting to login page');
              window.location.href = '/login';
            }
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login`, credentials);
      const { access_token, refresh_token } = response.data;

      this.setTokens(access_token, refresh_token);

      return response.data;
    } catch (error) {
      // Login failed
      throw error;
    }
  }

  async refresh(): Promise<void> {
    if (!this._refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await axios.post<{ access_token: string; refresh_token: string }>(
      `${API_BASE_URL}/auth/refresh`,
      {
        refresh_token: this._refreshToken,
      }
    );

    const { access_token, refresh_token } = response.data;
    this.setTokens(access_token, refresh_token);
  }

  async getCurrentUser(): Promise<User> {
    const response = await axios.get<User>(`${API_BASE_URL}/auth/me`);
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await axios.post(`${API_BASE_URL}/auth/logout`);
    } catch (error) {
      // Logout request failed
    }

    this.clearTokens();
  }

  private setTokens(accessToken: string, refreshToken: string) {
    this._accessToken = accessToken;
    this._refreshToken = refreshToken;

    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
  }

  clearTokens() {
    // Clearing tokens from memory and localStorage
    this._accessToken = null;
    this._refreshToken = null;

    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  private shouldRedirectToLogin(url?: string): boolean {
    // Don't redirect for auth endpoints
    if (url?.includes('/auth/')) {
      return false;
    }

    // Don't redirect if already on login page
    if (window.location.pathname === '/login') {
      return false;
    }

    return true;
  }

  isAuthenticated(): boolean {
    // Check if token exists and has valid JWT format
    if (!this._accessToken) {
      // No access token available
      return false;
    }

    // Basic JWT format validation (three parts separated by dots)
    const parts = this._accessToken.split('.');
    if (parts.length !== 3) {
      // Invalid token format, clearing tokens
      // Invalid token format, clear it
      this.clearTokens();
      return false;
    }

    // Try to decode and check expiration
    try {
      const payload = JSON.parse(atob(parts[1]));
      // Check if token is expired (exp is in seconds)
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        // Token has expired, clearing tokens
        // Token is expired, clear it
        this.clearTokens();
        return false;
      }
      // Token is valid
      return true;
    } catch (e) {
      // Failed to decode token, clearing tokens
      // Invalid token, clear it
      this.clearTokens();
      return false;
    }
  }

  // Debug method to check auth status (console output disabled)
  debugAuthStatus(): void {
    // Uncomment below lines for debugging
    // console.group('[AuthService] Current Authentication Status');
    // console.log('Access Token:', this._accessToken ? `${this._accessToken.substring(0, 20)}...` : 'None');
    // console.log('Refresh Token:', this._refreshToken ? `${this._refreshToken.substring(0, 20)}...` : 'None');
    // console.log('Is Authenticated:', this.isAuthenticated());

    // if (this._accessToken) {
    //   try {
    //     const parts = this._accessToken.split('.');
    //     if (parts.length === 3) {
    //       const payload = JSON.parse(atob(parts[1]));
    //       console.log('Token Payload:', {
    //         exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'No expiration',
    //         iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : 'No issued time',
    //         user: payload.sub || payload.user_id || 'Unknown user'
    //       });
    //     }
    //   } catch (error) {
    //     console.log('Failed to decode token payload:', error);
    //   }
    // }
    // console.groupEnd();
  }
}

export const authService = new AuthService();
export default authService;
