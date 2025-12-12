import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

import authService from '@/services/authService';
import type { AuthContextValue, LoginRequest, User, CloneSession } from '@/types/auth';
import { logger } from '@/utils/logger';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  // 克隆状态
  const [isCloned, setIsCloned] = useState(false);
  const [cloneSession, setCloneSession] = useState<CloneSession | null>(null);
  const [cloneExpiresIn, setCloneExpiresIn] = useState(0);
  const cloneTimerRef = useRef<NodeJS.Timeout | null>(null);

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
      const err = error as { response?: { status?: number } };
      if (err?.response?.status === 401) {
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
          logger.debug('Token即将过期，自动刷新中...', {
            expiresAt: new Date(expiresAt).toISOString(),
            remainingMinutes: Math.floor(timeUntilExpiry / 60000),
          });

          await authService.refresh();
          await queryClient.invalidateQueries({ queryKey: ['currentUser'] });

          logger.debug('Token自动刷新成功');
        }
      } catch (error) {
        logger.error('自动刷新Token失败:', error);
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
    const response = await authService.login(credentials);
    setUser(response.user);

    // Invalidate and refetch user data
    await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
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

  // ========== 克隆身份相关 ==========

  // 初始化时检查克隆状态
  useEffect(() => {
    const cloneInfo = authService.getCloneInfoFromToken();
    if (cloneInfo.isCloned) {
      setIsCloned(true);
      // 获取完整的克隆状态
      authService.getCloneStatus().then((status) => {
        if (status.is_cloned) {
          setCloneSession({
            session_id: status.session_id!,
            original_user: status.original_user!,
            cloned_user: status.cloned_user!,
            expires_at: status.expires_at!,
            remaining_seconds: status.remaining_seconds!,
          });
          setCloneExpiresIn(status.remaining_seconds!);
        }
      }).catch(() => {
        // 获取状态失败，可能会话已过期
        setIsCloned(false);
        setCloneSession(null);
      });
    }
  }, []);

  // 克隆倒计时
  useEffect(() => {
    if (!isCloned || cloneExpiresIn <= 0) {
      if (cloneTimerRef.current) {
        clearInterval(cloneTimerRef.current);
        cloneTimerRef.current = null;
      }
      return;
    }

    cloneTimerRef.current = setInterval(() => {
      setCloneExpiresIn((prev) => {
        if (prev <= 1) {
          // 时间到，自动登出
          logger.info('克隆会话已过期，自动登出');
          logout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (cloneTimerRef.current) {
        clearInterval(cloneTimerRef.current);
        cloneTimerRef.current = null;
      }
    };
  }, [isCloned, cloneExpiresIn > 0]);

  // 克隆身份
  const cloneIdentity = useCallback(async (userId: number) => {
    const response = await authService.cloneIdentity(userId);
    setIsCloned(true);
    setCloneSession(response.clone_session);
    setCloneExpiresIn(response.clone_session.remaining_seconds);

    // 重新获取用户信息
    await queryClient.invalidateQueries({ queryKey: ['currentUser'] });

    logger.info('已切换到克隆身份', {
      clonedUser: response.clone_session.cloned_user.username,
    });
  }, [queryClient]);

  // 恢复身份
  const restoreIdentity = useCallback(async () => {
    await authService.restoreIdentity();
    setIsCloned(false);
    setCloneSession(null);
    setCloneExpiresIn(0);

    // 重新获取用户信息
    await queryClient.invalidateQueries({ queryKey: ['currentUser'] });

    logger.info('已恢复原始身份');
  }, [queryClient]);

  // 使用 data 作为用户状态的主要来源，避免 useEffect 延迟导致的闪烁
  // user state 仅用于 login 后立即更新（在 query 重新获取之前）
  const currentUser = data ?? user;

  // 从用户数据中提取设置（/me 接口已合并返回 settings）
  const settings = currentUser?.settings ?? null;

  const value: AuthContextValue = {
    user: currentUser,
    settings,
    isLoading: isLoading && authService.isAuthenticated(),
    login,
    logout,
    refreshToken,
    refreshUser,
    // 克隆相关
    isCloned,
    cloneSession,
    cloneIdentity,
    restoreIdentity,
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
