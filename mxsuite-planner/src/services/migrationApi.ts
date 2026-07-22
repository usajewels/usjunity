import { api } from '@mxsuite/shared';
import type {
  MigrationProject, MigrationStats, MigrationBlueprint,
  FieldMappingEntryDto, SchemaNodeDto, MappingStatsDto, MappingStatus,
  SemanticDecisionDto, DecisionStatsDto, DecisionStatus,
  ApprovalRequestDto, ApprovalStatsDto, ApprovalStatus,
  ReconciliationReportDto,
  MappingVersionDto, MappingVersionDetailDto, MappingVersionDiffDto,
  FieldChangeHistoryDto,
} from '@mxsuite/shared';

export const migrationApi = {
  // Dashboard
  listProjects: (params?: any) =>
    api.get<{ content: MigrationProject[]; totalElements: number; totalPages: number }>('/migration/projects', { params }),

  getProject: (projectId: string) =>
    api.get<{ id: string; name: string; tenant?: { name: string } }>(`/projects/${projectId}`),

  getStats: () =>
    api.get<MigrationStats>('/migration/stats'),

  listBlueprints: () =>
    api.get<MigrationBlueprint[]>('/migration/blueprints'),

  advancePhase: (projectId: string) =>
    api.post<MigrationProject>(`/migration/projects/${projectId}/advance-phase`),

  updateMigration: (projectId: string, data: {
    sourceSystem?: string;
    targetSystem?: string;
    migrationPhase?: string;
    migrationStatus?: string;
  }) =>
    api.put<MigrationProject>(`/migration/projects/${projectId}`, data),

  // Field Mappings
  listMappings: (projectId: string, params?: { status?: MappingStatus; sourceEntity?: string; page?: number; size?: number }) =>
    api.get<{ content: FieldMappingEntryDto[]; totalElements: number; totalPages: number }>(
      `/projects/${projectId}/mappings`, { params }),

  getMapping: (projectId: string, mappingId: string) =>
    api.get<FieldMappingEntryDto>(`/projects/${projectId}/mappings/${mappingId}`),

  updateMapping: (projectId: string, mappingId: string, data: {
    targetEntity?: string; targetField?: string; coercion?: string;
    mappingStatus?: MappingStatus; customerComment?: string;
  }) =>
    api.put<FieldMappingEntryDto>(`/projects/${projectId}/mappings/${mappingId}`, data),

  approveMapping: (projectId: string, mappingId: string) =>
    api.post<FieldMappingEntryDto>(`/projects/${projectId}/mappings/${mappingId}/approve`),

  getMappingSchemaTree: (projectId: string) =>
    api.get<SchemaNodeDto[]>(`/projects/${projectId}/mappings/schema-tree`),

  getMappingStats: (projectId: string) =>
    api.get<MappingStatsDto>(`/projects/${projectId}/mappings/stats`),

  // Mapping Versions
  listVersions: (projectId: string, params?: { page?: number; size?: number; search?: string }) =>
    api.get<{ content: MappingVersionDto[]; totalElements: number }>(
      `/projects/${projectId}/versions`, { params }),

  getVersion: (projectId: string, versionId: string) =>
    api.get<MappingVersionDetailDto>(`/projects/${projectId}/versions/${versionId}`),

  compareVersions: (projectId: string, from: number, to: number) =>
    api.get<MappingVersionDiffDto[]>(`/projects/${projectId}/versions/compare`, {
      params: { from, to },
    }),

  updateVersionLabel: (projectId: string, versionId: string, label: string) =>
    api.put<MappingVersionDto>(`/projects/${projectId}/versions/${versionId}/label`, { label }),

  rollbackVersion: (projectId: string, targetVersion: number) =>
    api.post<MappingVersionDto>(`/projects/${projectId}/versions/rollback`, { targetVersion }),

  // Field change history
  getFieldChangeHistory: (projectId: string, mappingId: string, params?: { page?: number; size?: number }) =>
    api.get<{ content: FieldChangeHistoryDto[]; totalElements: number; totalPages: number }>(
      `/projects/${projectId}/mappings/${mappingId}/change-history`, { params }),

  // Semantic Decisions
  listDecisions: (params?: { status?: DecisionStatus; page?: number; size?: number }) =>
    api.get<{ content: SemanticDecisionDto[]; totalElements: number; totalPages: number }>(
      '/migration/decisions', { params }),

  getDecision: (id: string) =>
    api.get<SemanticDecisionDto>(`/migration/decisions/${id}`),

  updateDecision: (id: string, data: any) =>
    api.put<SemanticDecisionDto>(`/migration/decisions/${id}`, data),

  approveDecision: (id: string) =>
    api.post<SemanticDecisionDto>(`/migration/decisions/${id}/approve`),

  rejectDecision: (id: string) =>
    api.post<SemanticDecisionDto>(`/migration/decisions/${id}/reject`),

  getDecisionStats: () =>
    api.get<DecisionStatsDto>('/migration/decisions/stats'),

  // Approvals
  listApprovals: (params?: { status?: ApprovalStatus; page?: number; size?: number }) =>
    api.get<{ content: ApprovalRequestDto[]; totalElements: number; totalPages: number }>(
      '/migration/approvals', { params }),

  listProjectApprovals: (projectId: string) =>
    api.get<ApprovalRequestDto[]>(`/migration/approvals/project/${projectId}`),

  authorizeApproval: (id: string) =>
    api.post<ApprovalRequestDto>(`/migration/approvals/${id}/authorize`),

  rejectApproval: (id: string, reason?: string) =>
    api.post<ApprovalRequestDto>(`/migration/approvals/${id}/reject`, reason ? { reason } : {}),

  getApprovalStats: () =>
    api.get<ApprovalStatsDto>('/migration/approvals/stats'),

  // Reconciliation
  getLatestRecon: (projectId: string) =>
    api.get<ReconciliationReportDto>(`/migration/projects/${projectId}/reconciliation/latest`),

  listRecons: (projectId: string) =>
    api.get<ReconciliationReportDto[]>(`/migration/projects/${projectId}/reconciliation`),

  signOffRecon: (projectId: string, reportId: string, data: { signerName?: string; signerRole?: string }) =>
    api.post<ReconciliationReportDto>(`/migration/projects/${projectId}/reconciliation/${reportId}/sign-off`, data),

  // Audit trail — fetch history for a specific entity
  getEntityAudit: (entityType: string, entityId: string, params?: { page?: number; size?: number }) =>
    api.get<{ content: AuditEventDto[]; totalElements: number }>(
      `/audit/entity/${entityType}/${entityId}`, { params }),

  // Recent activity feed — all audit events for current tenant context
  getRecentActivity: (params?: { page?: number; size?: number }) =>
    api.get<{ content: AuditEventDto[]; totalElements: number }>('/audit', { params }),
};

export interface AuditEventDto {
  id: string;
  actorName: string;
  actorRole: string;
  platformAction: boolean;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  timestamp: string;
}

export const notificationApi = {
  list: (params?: { page?: number; size?: number }) =>
    api.get<{ content: AppNotification[]; totalElements: number }>('/notifications', { params }),

  getUnreadCount: () =>
    api.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    api.put<AppNotification>(`/notifications/${id}/read`),

  markAllRead: () =>
    api.put<{ updated: number }>('/notifications/read-all'),
};

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  read: boolean;
  createdAt: string;
}
