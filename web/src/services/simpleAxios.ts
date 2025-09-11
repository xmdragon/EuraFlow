import axios from 'axios'
import authService from './authService'

// 请求拦截器 - 添加token
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

// 响应拦截器 - 处理401错误
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // 如果是401或403错误，清除token并跳转登录页
    if (error.response?.status === 401 || error.response?.status === 403) {
      // 避免重复跳转
      if (window.location.pathname !== '/login') {
        authService.clearTokens()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default axios