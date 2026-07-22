import axios from 'axios';

const TOKEN_KEY = 'mxsuite_token';
const USER_KEY = 'mxsuite_user';
const TENANT_KEY = 'mxsuite_tenant_id';
const TENANT_DATA_KEY = 'mxsuite_tenant';
const PLATFORM_BRANDING_KEY = 'mxsuite_platform_branding';
const FEATURE_CONFIG_KEY = 'mxsuite_feature_config';
const DEV_LOGIN_KEY = 'mxsuite_dev_login';

export interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  avatarUrl?: string;
  title?: string;
  bio?: string;
}

export interface TenantData {
  id: string;
  name: string;
  slug: string;
  tenantType: string;
  brandName?: string;
  logoUrl?: string;
  themeConfig?: {
    colorPrimary?: string;
    colorSuccess?: string;
    colorWarning?: string;
    colorError?: string;
    borderRadius?: number;
    siderBg?: string;
    headerBg?: string;
  };
}

export interface PlatformBranding {
  brandName?: string;
  logoUrl?: string;
}

export type FeatureConfig = Record<string, string[]>;

interface AuthResponse {
  token: string;
  user: UserData;
  tenant: TenantData;
  platformBranding?: PlatformBranding;
  featureConfig?: FeatureConfig;
  devLogin?: boolean;
}

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const { data } = await axios.post<AuthResponse>('/api/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(TENANT_KEY, data.user.tenantId);
    localStorage.setItem(TENANT_DATA_KEY, JSON.stringify(data.tenant));
    if (data.platformBranding) localStorage.setItem(PLATFORM_BRANDING_KEY, JSON.stringify(data.platformBranding));
    if (data.featureConfig) localStorage.setItem(FEATURE_CONFIG_KEY, JSON.stringify(data.featureConfig));
    localStorage.setItem(DEV_LOGIN_KEY, String(!!data.devLogin));
    return data;
  },

  async devLogin(email: string): Promise<AuthResponse> {
    const { data } = await axios.post<AuthResponse>('/api/auth/dev/login', { email });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(TENANT_KEY, data.user.tenantId);
    localStorage.setItem(TENANT_DATA_KEY, JSON.stringify(data.tenant));
    if (data.platformBranding) localStorage.setItem(PLATFORM_BRANDING_KEY, JSON.stringify(data.platformBranding));
    if (data.featureConfig) localStorage.setItem(FEATURE_CONFIG_KEY, JSON.stringify(data.featureConfig));
    localStorage.setItem(DEV_LOGIN_KEY, 'true');
    return data;
  },

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(TENANT_DATA_KEY);
    localStorage.removeItem(PLATFORM_BRANDING_KEY);
    localStorage.removeItem(FEATURE_CONFIG_KEY);
    localStorage.removeItem(DEV_LOGIN_KEY);
  },

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  getUser(): UserData | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.role === 'string' && typeof parsed.email === 'string') {
        return parsed;
      }
      localStorage.removeItem(USER_KEY);
      return null;
    } catch {
      localStorage.removeItem(USER_KEY);
      return null;
    }
  },

  getTenant(): TenantData | null {
    const raw = localStorage.getItem(TENANT_DATA_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === 'string') {
        return parsed;
      }
      localStorage.removeItem(TENANT_DATA_KEY);
      return null;
    } catch {
      localStorage.removeItem(TENANT_DATA_KEY);
      return null;
    }
  },

  getPlatformBranding(): PlatformBranding | null {
    const raw = localStorage.getItem(PLATFORM_BRANDING_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  async fetchPlatformBranding(): Promise<PlatformBranding | null> {
    try {
      const { data } = await axios.get<PlatformBranding>('/api/auth/platform/branding');
      if (data) localStorage.setItem(PLATFORM_BRANDING_KEY, JSON.stringify(data));
      return data;
    } catch {
      return null;
    }
  },

  getFeatureConfig(): FeatureConfig | null {
    const raw = localStorage.getItem(FEATURE_CONFIG_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  async fetchFeatureConfig(): Promise<FeatureConfig | null> {
    try {
      const { data } = await axios.get<FeatureConfig>('/api/auth/platform/features');
      if (data) localStorage.setItem(FEATURE_CONFIG_KEY, JSON.stringify(data));
      return data;
    } catch {
      return null;
    }
  },

  isDevLogin(): boolean {
    return localStorage.getItem(DEV_LOGIN_KEY) === 'true';
  },

  isAuthenticated(): boolean {
    return !!this.getToken();
  },
};
