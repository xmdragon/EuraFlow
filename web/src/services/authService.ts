import axios from 'axios'
import type { LoginRequest, LoginResponse, User } from '@/types/auth'

const API_BASE_URL = '/api/ef/v1'

class AuthService {
  private accessToken: string | null = null
  private refreshToken: string | null = null

  constructor() {
    // Load tokens from localStorage
    this.accessToken = localStorage.getItem('access_token')
    this.refreshToken = localStorage.getItem('refresh_token')

    // Setup axios interceptors
    this.setupInterceptors()
  }

  private setupInterceptors() {
    // Request interceptor to add auth header
    axios.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`
      }
      return config
    })

    // Response interceptor to handle token refresh
    axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            await this.refresh()
            // Retry the original request
            return axios.request(error.config)
          } catch (refreshError) {
            this.logout()
            window.location.href = '/login'
          }
        }
        return Promise.reject(error)
      }
    )
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login`, credentials)
      const { access_token, refresh_token } = response.data
      
      this.setTokens(access_token, refresh_token)
      
      return response.data
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  async refresh(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await axios.post<{ access_token: string; refresh_token: string }>(`${API_BASE_URL}/auth/refresh`, {
      refresh_token: this.refreshToken
    })
    
    const { access_token, refresh_token } = response.data
    this.setTokens(access_token, refresh_token)
  }

  async getCurrentUser(): Promise<User> {
    const response = await axios.get<User>(`${API_BASE_URL}/auth/me`)
    return response.data
  }

  async logout(): Promise<void> {
    try {
      await axios.post(`${API_BASE_URL}/auth/logout`)
    } catch (error) {
      console.error('Logout request failed:', error)
    }
    
    this.clearTokens()
  }

  private setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    
    localStorage.setItem('access_token', accessToken)
    localStorage.setItem('refresh_token', refreshToken)
  }

  clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  }

  isAuthenticated(): boolean {
    return !!this.accessToken
  }
}

export const authService = new AuthService()
export default authService