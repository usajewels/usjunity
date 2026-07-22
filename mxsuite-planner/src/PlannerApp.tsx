import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@mxsuite/shared';
import PlanListPage from './pages/PlanListPage';
import PlanBuilderPage from './pages/PlanBuilderPage';
import RunHistoryPage from './pages/RunHistoryPage';
import MigrationLayout from './layouts/MigrationLayout';
import MigrationDashboardPage from './pages/migration/MigrationDashboardPage';
import MappingsPage from './pages/migration/MappingsPage';
import DecisionsPage from './pages/migration/DecisionsPage';
import ApprovalsPage from './pages/migration/ApprovalsPage';
import MigrationProjectsPage from './pages/migration/MigrationProjectsPage';
import GlobalMappingsPage from './pages/migration/GlobalMappingsPage';
import ReconciliationPage from './pages/migration/ReconciliationPage';
import TenantOnboardingLayout from './layouts/TenantOnboardingLayout';
import TenantOverviewPage from './pages/tenant-onboarding/TenantOverviewPage';
import TenantUploadPage from './pages/tenant-onboarding/TenantUploadPage';
import TenantMappingsPage from './pages/tenant-onboarding/TenantMappingsPage';
import TenantDecisionsPage from './pages/tenant-onboarding/TenantDecisionsPage';
import TenantStatusPage from './pages/tenant-onboarding/TenantStatusPage';
import TenantActivityPage from './pages/tenant-onboarding/TenantActivityPage';

export default function PlannerApp() {
  return (
    <AuthProvider>
    <Routes>
      <Route index element={<PlanListPage />} />
      <Route path=":projectId/plans/:planId" element={<PlanBuilderPage />} />
      <Route path=":projectId/plans/:planId/runs" element={<RunHistoryPage />} />
      <Route path="onboarding-projects" element={<MigrationLayout />}>
        <Route index element={<MigrationDashboardPage />} />
        <Route path="mappings" element={<GlobalMappingsPage />} />
        <Route path="projects" element={<MigrationProjectsPage />} />
        <Route path="projects/:projectId/mappings" element={<MappingsPage />} />
        <Route path="projects/:projectId/reconciliation" element={<ReconciliationPage />} />
        <Route path="decisions" element={<DecisionsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
      </Route>
      <Route path="my-onboarding" element={<TenantOnboardingLayout />}>
        <Route index element={<TenantOverviewPage />} />
        <Route path="upload" element={<TenantUploadPage />} />
        <Route path="mappings" element={<TenantMappingsPage />} />
        <Route path="decisions" element={<TenantDecisionsPage />} />
        <Route path="status" element={<TenantStatusPage />} />
        <Route path="activity" element={<TenantActivityPage />} />
      </Route>
    </Routes>
    </AuthProvider>
  );
}
