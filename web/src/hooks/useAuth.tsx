import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useState, useEffect } from 'react';

import authService from '@/services/authService';
import type { AuthContextValue, LoginRequest, User } from '@/types/auth';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  // Query to fetch current user
  const { data, isLoading, error } = useQuery({
    queryKey: ['currentUser'],
    queryFn: authService.getCurrentUser,
    enabled: authService.isAuthenticated(),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
  });

  // Update user state when data changes
  useEffect(() => {
    if (data) {
      setUser(data);
    } else if (error) {
      setUser(null);
      // Clear tokens on 401
      if ((error as any)?.response?.status === 401) {
        authService.clearTokens();
      }
    }
  }, [data, error]);

  // 自动刷新Token机制：在过期前1小时自动刷新
  useEffect(() => {
    const token = authService.accessToken;
    if (!token) return;

    const checkAndRefreshToken = async () => {
      try {
        // 解析JWT获取过期时间
        const parts = token.split('.');
        if (parts.length !== 3) return;

        const payload = JSON.parse(atob(parts[1]));
        if (!payload.exp) return;

        const expiresAt = payload.exp * 1000; // 转换为毫秒
        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;

        // 如果剩余时间小于1小时且大于0，则刷新token
        if (timeUntilExpiry < 60 * 60 * 1000 && timeUntilExpiry > 0) {
          console.log('Token即将过期，自动刷新中...', {
            expiresAt: new Date(expiresAt).toISOString(),
            remainingMinutes: Math.floor(timeUntilExpiry / 60000),
          });

          await authService.refresh();
          await queryClient.invalidateQueries({ queryKey: ['currentUser'] });

          console.log('Token自动刷新成功');
        }
      } catch (error) {
        console.error('自动刷新Token失败:', error);
        // 刷新失败不清除token，让用户继续使用直到真正过期
      }
    };

    // 立即检查一次
    checkAndRefreshToken();

    // 每5分钟检查一次
    const intervalId = setInterval(checkAndRefreshToken, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [queryClient]);

  const login = async (credentials: LoginRequest) => {
    try {
      const response = await authService.login(credentials);
      setUser(response.user);

      // Invalidate and refetch user data
      await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (error) {
      // Login failed
      throw error;
    }
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
    queryClient.clear();
    window.location.href = '/login';
  };

  const refreshToken = async () => {
    await authService.refresh();
    await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
  };

  const refreshUser = async () => {
    await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
  };

  const value: AuthContextValue = {
    user,
    isLoading: isLoading && authService.isAuthenticated(),
    login,
    logout,
    refreshToken,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default useAuth;
