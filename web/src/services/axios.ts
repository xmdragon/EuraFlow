import axios from 'axios'
import authService from './authService'

// 请求拦截器
axios.interceptors.request.use(
  (config) => {
    const token = authService.accessToken
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
let isRefreshing = false
let failedQueue: any[] = []

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // 如果是登录页或刷新token请求，不处理
    if (originalRequest.url?.includes('/auth/login') || 
        originalRequest.url?.includes('/auth/refresh')) {
      return Promise.reject(error)
    }

    // 如果是401错误且不是重试请求
    if (error.response?.status === 401 && !originalRequest._retry) {
      // 如果没有refresh token，直接跳转登录页
      if (!authService.refreshToken) {
        authService.clearTokens()
        window.location.href = '/login'
        return Promise.reject(error)
      }

      if (isRefreshing) {
        // 如果正在刷新，将请求加入队列
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(() => {
          originalRequest.headers['Authorization'] = `Bearer ${authService.accessToken}`
          return axios(originalRequest)
        }).catch(err => {
          return Promise.reject(err)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        await authService.refresh()
        processQueue(null)
        isRefreshing = false
        originalRequest.headers['Authorization'] = `Bearer ${authService.accessToken}`
        return axios(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        isRefreshing = false
        // 刷新失败，清除token并跳转到登录页
        authService.clearTokens()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }

    // 如果是403或其他认证相关错误，直接跳转到登录页
    if (error.response?.status === 403) {
      authService.clearTokens()
      window.location.href = '/login'
    }

    return Promise.reject(error)
  }
)

export default axios