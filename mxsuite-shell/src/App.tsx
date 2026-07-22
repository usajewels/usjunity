import React, { lazy, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { AuthProvider, useAuth } from './store/AuthContext';
import { RemoteModuleLoader } from './components/RemoteModuleLoader';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';

// Lazy-load remote micro-frontend modules
const AdminApp = lazy(() => import('mxsuiteAdmin/AdminApp'));
const WorkspacesApp = lazy(() => import('mxsuiteWorkspaces/WorkspacesApp'));
const PlannerApp = lazy(() => import('mxsuitePlanner/PlannerApp'));
const ChatApp = lazy(() => import('mxsuiteChat/ChatApp'));
const OnboardingApp = lazy(() => import('mxsuiteOnboarding/OnboardingApp'));

const DEFAULT_THEME = {
  token: {
    colorPrimary: '#2d1854',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    borderRadius: 6,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    controlHeight: 36,
  },
  components: {
    Layout: { siderBg: '#1a0e3a', headerBg: '#ffffff', headerHeight: 56 },
    Menu: { darkItemBg: '#1a0e3a', darkItemSelectedBg: '#6b4fa0', darkSubMenuItemBg: '#1a0e3a', itemHeight: 44 },
    Table: { headerBg: '#ece4fc', headerSortActiveBg: '#e0d4f5', headerSortHoverBg: '#e0d4f5', rowHoverBg: '#f3eeff' },
    Tabs: { inkBarColor: '#2d1854', itemSelectedColor: '#2d1854' },
  },
};

function AdminGuard() {
  const { isPlatformAdmin } = useAuth();
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return <RemoteModuleLoader module={AdminApp} fallbackTitle="Admin module" />;
}

function FeatureGuard({ feature, features, children }: { feature?: string; features?: string[]; children: React.ReactNode }) {
  const { hasFeature } = useAuth();
  const allowed = features
    ? features.some(f => hasFeature(f))
    : feature ? hasFeature(feature) : false;
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ProtectedRoutes() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <AppLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="workspaces/*" element={
          <FeatureGuard feature="workspaces">
            <RemoteModuleLoader module={WorkspacesApp} fallbackTitle="Workspaces module" />
          </FeatureGuard>
        } />
        <Route path="plans/*" element={
          <FeatureGuard features={['projects', 'migration', 'my-onboarding']}>
            <RemoteModuleLoader module={PlannerApp} fallbackTitle="Planner module" />
          </FeatureGuard>
        } />
        <Route path="chat/*" element={<RemoteModuleLoader module={ChatApp} fallbackTitle="Chat module" />} />
        <Route path="onboarding/*" element={<Navigate to="/plans/my-onboarding" replace />} />
        <Route path="admin/*" element={<AdminGuard />} />
      </Routes>
    </AppLayout>
  );
}

function ThemedApp() {
  const { tenant } = useAuth();

  const theme = useMemo(() => {
    const tc = tenant?.themeConfig;
    if (!tc) return DEFAULT_THEME;

    const primary = tc.colorPrimary || '#2d1854';
    const siderBg = tc.siderBg || '#1a0e3a';

    return {
      token: {
        colorPrimary: primary,
        colorSuccess: tc.colorSuccess || '#52c41a',
        colorWarning: tc.colorWarning || '#faad14',
        colorError: tc.colorError || '#ff4d4f',
        borderRadius: tc.borderRadius ?? 6,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        controlHeight: 36,
      },
      components: {
        Layout: { siderBg, headerBg: tc.headerBg || '#ffffff', headerHeight: 56 },
        Menu: { darkItemBg: siderBg, darkItemSelectedBg: primary, itemHeight: 44 },
        Table: { headerBg: '#ece4fc', headerSortActiveBg: '#e0d4f5', headerSortHoverBg: '#e0d4f5', rowHoverBg: '#f3eeff' },
      },
    };
  }, [tenant?.themeConfig]);

  return (
    <ConfigProvider theme={theme}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </ConfigProvider>
  );
}

export default function App() {
  return (
    <ConfigProvider theme={DEFAULT_THEME}>
      <AuthProvider>
        <ThemedApp />
      </AuthProvider>
    </ConfigProvider>
  );
}
