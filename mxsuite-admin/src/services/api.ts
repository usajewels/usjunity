import { api } from '@mxsuite/shared';
import type { Tenant, User, AuditEvent, PaginatedResponse } from '@mxsuite/shared';

// Re-export shared types under the names pages already import
export type { Tenant, AuditEvent };
export type UserResponse = User;
export type Page<T> = PaginatedResponse<T>;

export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED';
  invitedBy: string;
  invitedByName: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
}

/* ------------------------------------------------------------------ */
/*  Tenant API                                                         */
/* ------------------------------------------------------------------ */

export interface CoachDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export const tenantApi = {
  list: (params?: { page?: number; size?: number; search?: string }) =>
    api.get<PaginatedResponse<Tenant>>('/admin/tenants', { params }),

  get: (id: string) =>
    api.get<Tenant>(`/admin/tenants/${id}`),

  create: (data: { name: string; slug: string; coachIds?: string[] }) =>
    api.post<Tenant>('/admin/tenants', data),

  createWithOwner: (data: {
    name: string; slug: string;
    ownerEmail: string; ownerFirstName: string; ownerLastName: string;
    coachIds?: string[];
  }) => api.post('/admin/tenants/with-owner', data),

  update: (id: string, data: { name?: string; slug?: string; active?: boolean; brandName?: string; logoUrl?: string; themeConfig?: Record<string, unknown>; featureConfig?: Record<string, unknown>; openToAllCoaches?: boolean }) =>
    api.put<Tenant>(`/admin/tenants/${id}`, data),

  uploadLogo: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ logoUrl: string }>(`/admin/tenants/${id}/logo`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  delete: (id: string) =>
    api.delete(`/admin/tenants/${id}`),
};

/* ------------------------------------------------------------------ */
/*  User API                                                           */
/* ------------------------------------------------------------------ */

export const userApi = {
  list: (params?: { page?: number; size?: number; tenantId?: string }) =>
    api.get<PaginatedResponse<User>>('/admin/users', { params }),

  get: (id: string) =>
    api.get<User>(`/admin/users/${id}`),

  create: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId: string;
  }) => api.post<User>('/admin/users', data),

  update: (id: string, data: { firstName?: string; lastName?: string; role?: string; active?: boolean }) =>
    api.put<User>(`/admin/users/${id}`, data),

  delete: (id: string) =>
    api.delete(`/admin/users/${id}`),
};

/* ------------------------------------------------------------------ */
/*  Invitation API                                                     */
/* ------------------------------------------------------------------ */

export const invitationApi = {
  list: (params?: { page?: number; size?: number; status?: string }) =>
    api.get<PaginatedResponse<Invitation>>('/invitations', { params }),

  create: (data: { email: string; role: string }, tenantId?: string) =>
    api.post<Invitation>('/invitations', data,
      tenantId ? { headers: { 'X-Tenant-Id': tenantId } } : undefined),

  cancel: (id: string) =>
    api.post<Invitation>(`/invitations/${id}/cancel`),

  resend: (id: string) =>
    api.post<Invitation>(`/invitations/${id}/resend`),

  counts: () =>
    api.get<Record<string, number>>('/invitations/counts'),
};

/* ------------------------------------------------------------------ */
/*  Audit API                                                          */
/* ------------------------------------------------------------------ */

export const auditApi = {
  list: (params?: { page?: number; size?: number; platformOnly?: boolean; tenantId?: string }) =>
    api.get<PaginatedResponse<AuditEvent>>('/audit', { params }),

  getByEntity: (type: string, id: string, params?: { page?: number; size?: number }) =>
    api.get<PaginatedResponse<AuditEvent>>(`/audit/entity/${type}/${id}`, { params }),
};

/* ------------------------------------------------------------------ */
/*  Onboarding Schema API                                              */
/* ------------------------------------------------------------------ */

export interface TargetField {
  entity?: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export const onboardingSchemaApi = {
  getSchema: (tenantId: string) =>
    api.get<{ targetSchema: TargetField[]; hasOnboarding: boolean }>(
      `/admin/tenants/${tenantId}/onboarding/schema`,
    ),

  updateSchema: (tenantId: string, targetSchema: TargetField[]) =>
    api.put<{ targetSchema: TargetField[] }>(
      `/admin/tenants/${tenantId}/onboarding/schema`,
      { targetSchema },
    ),

  getSchemaV2: (tenantId: string) =>
    api.get<Record<string, unknown>>(
      `/admin/tenants/${tenantId}/onboarding/schema/v2`,
    ),
};

/* ------------------------------------------------------------------ */
/*  Coach Onboarding Mappings API                                      */
/* ------------------------------------------------------------------ */

export type MappingStatus = 'MAPPED' | 'NEEDS_REVIEW' | 'CFV_PROPOSAL' | 'REJECTED' | 'UNMAPPED';

export interface OnboardingMapping {
  id: string;
  sourceEntity: string;
  sourceField: string;
  sampleValue?: string;
  targetEntity?: string;
  targetField?: string;
  coercion?: string;
  confidencePct?: number;
  mappingStatus: MappingStatus;
  customerComment?: string;
  createdAt: string;
}

export interface OnboardingMappingStats {
  total: number;
  mapped: number;
  needsReview: number;
  unmapped: number;
  rejected: number;
}

export interface PhaseTimeDto {
  phase: string;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number;
  active: boolean;
}

export const coachMappingApi = {
  getProject: (tenantId: string) =>
    api.get<{ hasProject: boolean; projectId?: string; projectName?: string; mappingStats?: OnboardingMappingStats }>(
      `/admin/tenants/${tenantId}/onboarding/project`,
    ),

  getPhaseTimes: (projectId: string) =>
    api.get<PhaseTimeDto[]>(`/migration/projects/${projectId}/phase-times`),

  listMappings: (tenantId: string, params?: { page?: number; size?: number }) =>
    api.get<PaginatedResponse<OnboardingMapping>>(
      `/admin/tenants/${tenantId}/onboarding/project/mappings`,
      { params },
    ),

  getStats: (tenantId: string) =>
    api.get<OnboardingMappingStats>(
      `/admin/tenants/${tenantId}/onboarding/project/mappings/stats`,
    ),

  updateMapping: (tenantId: string, mappingId: string, body: Record<string, unknown>) =>
    api.put<OnboardingMapping>(
      `/admin/tenants/${tenantId}/onboarding/project/mappings/${mappingId}`,
      body,
    ),

  approveMapping: (tenantId: string, mappingId: string) =>
    api.post<OnboardingMapping>(
      `/admin/tenants/${tenantId}/onboarding/project/mappings/${mappingId}/approve`,
    ),

  clearMappings: (tenantId: string) =>
    api.delete<{ cleared: number }>(
      `/admin/tenants/${tenantId}/onboarding/project/mappings`,
    ),
};

/* ------------------------------------------------------------------ */
/*  Coach Assignment API                                               */
/* ------------------------------------------------------------------ */

export const assignmentApi = {
  listCoaches: (tenantId: string) =>
    api.get<CoachDto[]>(`/admin/tenants/${tenantId}/coaches`),

  assignCoach: (tenantId: string, userId: string) =>
    api.post<CoachDto>(`/admin/tenants/${tenantId}/coaches`, { userId }),

  unassignCoach: (tenantId: string, userId: string) =>
    api.delete(`/admin/tenants/${tenantId}/coaches/${userId}`),

  listAvailableCoaches: () =>
    api.get<CoachDto[]>('/admin/users/coaches'),
};

/* ------------------------------------------------------------------ */
/*  Log Viewer API                                                     */
/* ------------------------------------------------------------------ */

export interface LogEntry {
  timestamp: string;
  thread: string;
  traceId: string | null;
  spanId: string | null;
  level: string;
  logger: string;
  message: string;
}

export interface LogPage {
  entries: LogEntry[];
  fileSize: number;
  fileName: string;
}

export interface LoggerInfo {
  name: string;
  configuredLevel: string | null;
  effectiveLevel: string | null;
}

export const logApi = {
  getLogs: (params?: { lines?: number; level?: string; search?: string }) =>
    api.get<LogPage>('/admin/logs', { params }),

  getLoggers: () =>
    api.get<LoggerInfo[]>('/admin/logs/loggers'),

  setLoggerLevel: (name: string, level: string | null) =>
    api.put(`/admin/logs/loggers/${encodeURIComponent(name)}`, { level }),
};

export default api;
