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
