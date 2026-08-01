import { api } from '@mxsuite/shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AiProviderInfo {
  name: string;
  model: string;
  available: boolean;
  keySource: 'env' | 'db' | 'none';
}

export interface AiStatusResponse {
  providers: AiProviderInfo[];
  taskAssignments: Record<string, string>;
  yamlDefaults: Record<string, string>;
}

export interface TargetField {
  entity?: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/* ------------------------------------------------------------------ */
/*  Platform tenant API                                                */
/* ------------------------------------------------------------------ */

export const platformApi = {
  getTenant: (id: string) =>
    api.get<Record<string, unknown>>(`/admin/tenants/${id}`),

  updateTenant: (id: string, data: Record<string, unknown>) =>
    api.put(`/admin/tenants/${id}`, data),

  getAiStatus: () =>
    api.get<AiStatusResponse>('/admin/ai/status'),

  setAiKey: (provider: string, apiKey: string) =>
    api.put<{ provider: string; keySource: string }>('/admin/ai/keys', { provider, apiKey }),

  removeAiKey: (provider: string) =>
    api.delete<{ provider: string; keySource: string }>(`/admin/ai/keys/${provider}`),

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

  uploadLogo: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ logoUrl: string }>(`/admin/tenants/${id}/logo`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /* ---- Simulator helpers ---- */

  listTenants: () =>
    api.get<{ content: Array<{ id: string; name: string; slug: string; tenantType: string }> }>(
      '/admin/tenants', { params: { size: 200 } },
    ),

  createTenantWithOwner: (data: {
    name: string; slug: string;
    ownerEmail: string; ownerFirstName: string; ownerLastName: string;
    coachIds?: string[];
  }) => api.post('/admin/tenants/with-owner', data),

  createUser: (data: {
    email: string; password: string;
    firstName: string; lastName: string;
    role: string; tenantId: string;
  }) => api.post('/admin/users', data),

  createInvitation: (data: { email: string; role: string }, tenantId: string) =>
    api.post('/invitations', data, { headers: { 'X-Tenant-Id': tenantId } }),

  resetDemo: () =>
    api.delete<{ deletedOrganizations: number }>('/admin/tenants/reset-demo'),

  listCoaches: () =>
    api.get<Array<{ id: string; firstName: string; lastName: string; email: string; role: string }>>(
      '/admin/users/coaches',
    ),

  assignCoach: (tenantId: string, userId: string) =>
    api.post(`/admin/tenants/${tenantId}/coaches`, { userId }),

  listTenantCoaches: (tenantId: string) =>
    api.get<Array<{ id: string; firstName: string; lastName: string; email: string }>>(
      `/admin/tenants/${tenantId}/coaches`,
    ),

  createDecision: (data: {
    title: string;
    summary?: string;
    tenantId?: string;
    fieldContext?: string;
    options?: Array<{ label: string; description?: string; isRecommended?: boolean }>;
  }) => api.post('/migration/decisions', data),
};
