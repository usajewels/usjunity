import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authService, type UserData, type TenantData, type PlatformBranding, type FeatureConfig } from '../services/auth';
import { api } from '@mxsuite/shared';

const DEFAULT_FEATURE_CONFIG: FeatureConfig = {
  PLATFORM_ADMIN: ['projects', 'migration'],
  PLATFORM_SUPPORT: ['projects', 'migration'],
  TENANT_ADMIN: ['my-onboarding'],
  TENANT_USER: ['my-onboarding'],
};

interface AuthContextType {
  user: UserData | null;
  tenant: TenantData | null;
  platformBranding: PlatformBranding | null;
  isAuthenticated: boolean;
  isPlatformUser: boolean;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isDevLogin: boolean;
  hasFeature: (feature: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  devLogin: (email: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserData | null>(authService.getUser());
  const [tenant, setTenant] = useState<TenantData | null>(authService.getTenant());
  const [platformBranding, setPlatformBranding] = useState<PlatformBranding | null>(authService.getPlatformBranding());
  const [featureConfig, setFeatureConfig] = useState<FeatureConfig>(authService.getFeatureConfig() || DEFAULT_FEATURE_CONFIG);
  const [token, setToken] = useState<string | null>(authService.getToken());
  const [isDevLoginFlag, setIsDevLoginFlag] = useState(authService.isDevLogin());

  const isAuthenticated = !!token && !!user;
  const isPlatformUser = user?.role === 'PLATFORM_ADMIN' || user?.role === 'PLATFORM_SUPPORT';
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const isTenantAdmin = user?.role === 'TENANT_ADMIN';

  const hasFeature = useCallback((feature: string): boolean => {
    if (!user) return false;
    const config = featureConfig || DEFAULT_FEATURE_CONFIG;
    const features = config[user.role] || [];
    return features.includes(feature);
  }, [user, featureConfig]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authService.login(email, password);
    setToken(response.token);
    setUser(response.user);
    setTenant(response.tenant);
    if (response.platformBranding) setPlatformBranding(response.platformBranding);
    if (response.featureConfig) setFeatureConfig(response.featureConfig);
    setIsDevLoginFlag(!!response.devLogin);
  }, []);

  const devLogin = useCallback(async (email: string) => {
    const response = await authService.devLogin(email);
    setToken(response.token);
    setUser(response.user);
    setTenant(response.tenant);
    if (response.platformBranding) setPlatformBranding(response.platformBranding);
    if (response.featureConfig) setFeatureConfig(response.featureConfig);
    setIsDevLoginFlag(true);
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    setToken(null);
    setUser(null);
    setTenant(null);
    setPlatformBranding(null);
    setFeatureConfig(DEFAULT_FEATURE_CONFIG);
    setIsDevLoginFlag(false);
  }, []);

  useEffect(() => {
    if (token && !user) logout();
  }, [token, user, logout]);

  // Sync platform branding, feature config, and user preferences on every page load
  useEffect(() => {
    if (isAuthenticated) {
      authService.fetchPlatformBranding().then(branding => {
        if (branding) setPlatformBranding(branding);
      });
      authService.fetchFeatureConfig().then(config => {
        if (config) setFeatureConfig(config);
      });
      // Sync rememberLastPage preference to localStorage
      api.get<Record<string, unknown>>('/profile/preferences')
        .then(({ data }) => {
          if (data) {
            localStorage.setItem('mxsuite_remember_last_page', String(!!data.rememberLastPage));
          }
        })
        .catch(() => { /* ignore */ });
    }
  }, [isAuthenticated]);

  // Listen for platform branding updates from admin MFE
  useEffect(() => {
    const handleBrandingUpdate = () => {
      setPlatformBranding(authService.getPlatformBranding());
    };
    window.addEventListener('platform-branding-updated', handleBrandingUpdate);
    return () => window.removeEventListener('platform-branding-updated', handleBrandingUpdate);
  }, []);

  // Listen for feature config updates from admin MFE
  useEffect(() => {
    const handleFeatureConfigUpdate = () => {
      const config = authService.getFeatureConfig();
      if (config) setFeatureConfig(config);
    };
    window.addEventListener('feature-config-updated', handleFeatureConfigUpdate);
    return () => window.removeEventListener('feature-config-updated', handleFeatureConfigUpdate);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, tenant, platformBranding, isAuthenticated, isPlatformUser, isPlatformAdmin, isTenantAdmin,
      isDevLogin: isDevLoginFlag,
      hasFeature, login, devLogin, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
