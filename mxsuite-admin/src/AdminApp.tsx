import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Spin } from 'antd';
import TenantListPage from './pages/TenantListPage';
import TenantDetailPage from './pages/TenantDetailPage';
import UserListPage from './pages/UserListPage';
import InvitationListPage from './pages/InvitationListPage';
import ActivityLogPage from './pages/ActivityLogPage';
import LogViewerPage from './pages/LogViewerPage';

// Lazy-load analytics pages — recharts pulls in react-redux which causes
// duplicate-React issues if bundled eagerly into the federation expose chunk.
const AnalyticsDashboardPage = lazy(() => import('./pages/AnalyticsDashboardPage'));
const CoachPerformancePage = lazy(() => import('./pages/CoachPerformancePage'));

const AnalyticsSpinner = (
  <div style={{ textAlign: 'center', padding: 80 }}>
    <Spin size="large" tip="Loading analytics..." />
  </div>
);

export default function AdminApp() {
  return (
    <Routes>
      <Route path="tenants" element={<TenantListPage />} />
      <Route path="tenants/:id" element={<TenantDetailPage />} />
      <Route path="users" element={<UserListPage />} />
      <Route path="invitations" element={<InvitationListPage />} />
      <Route path="activity" element={<ActivityLogPage />} />
      <Route path="logs" element={<LogViewerPage />} />
      <Route path="analytics" element={<Suspense fallback={AnalyticsSpinner}><AnalyticsDashboardPage /></Suspense>} />
      <Route path="analytics/coaches" element={<Suspense fallback={AnalyticsSpinner}><CoachPerformancePage /></Suspense>} />
    </Routes>
  );
}
