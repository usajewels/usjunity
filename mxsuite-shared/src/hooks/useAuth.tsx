import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { User, Tenant, AuthResponse, LoginRequest } from '../types';
import { apiClient } from '../api/client';

const TOKEN_KEY = 'mxsuite_token';
const USER_KEY = 'mxsuite_user';
const TENANT_KEY = 'mxsuite_tenant_id';
const TENANT_DATA_KEY = 'mxsuite_tenant';

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isPlatformUser: boolean;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.role === 'string' && typeof parsed.email === 'string') {
        return parsed;
      }
      localStorage.removeItem(USER_KEY);
      return null;
    } catch {
      localStorage.removeItem(USER_KEY);
      return null;
    }
  });
  const [tenant, setTenant] = useState<Tenant | null>(() => {
    const stored = localStorage.getItem(TENANT_DATA_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.id === 'string') {
        return parsed;
      }
      localStorage.removeItem(TENANT_DATA_KEY);
      return null;
    } catch {
      localStorage.removeItem(TENANT_DATA_KEY);
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));

  const isAuthenticated = !!token && !!user;
  const isPlatformUser = user?.role === 'PLATFORM_ADMIN' || user?.role === 'PLATFORM_SUPPORT';
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const isTenantAdmin = user?.role === 'TENANT_ADMIN';

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<AuthResponse>('/auth/login', { email, password } as LoginRequest);
    localStorage.setItem(TOKEN_KEY, response.token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
    localStorage.setItem(TENANT_KEY, response.user.tenantId);
    localStorage.setItem(TENANT_DATA_KEY, JSON.stringify(response.tenant));
    setToken(response.token);
    setUser(response.user);
    setTenant(response.tenant);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(TENANT_DATA_KEY);
    setToken(null);
    setUser(null);
    setTenant(null);
  }, []);

  useEffect(() => {
    if (token && !user) {
      logout();
    }
  }, [token, user, logout]);

  return (
    <AuthContext.Provider value={{
      user, tenant, isAuthenticated, isPlatformUser, isPlatformAdmin, isTenantAdmin,
      login, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
